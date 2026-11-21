package com.restaurant.pos;

import java.math.BigDecimal;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Currency;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

@Service
public class CatalogService {
    private final TenantJdbc db;
    private final AuthService auth;
    private final PasswordEncoder passwords;
    public CatalogService(TenantJdbc db, AuthService auth, PasswordEncoder passwords) {
        this.db = db; this.auth = auth; this.passwords = passwords;
    }

    public Map<String, Object> catalog(Actor actor, UUID outletId) {
        if (!actor.can("ORDER") && !actor.can("BILL") && !actor.can("KITCHEN") && !actor.can("PRINT")) {
            throw new ApiException(403, "You do not have permission to view this catalog.");
        }
        return db.tx(actor, () -> catalogInside(actor, outletId));
    }
    private Map<String, Object> catalogInside(Actor actor, UUID outletId) {
        db.outlet(actor, outletId);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("outlet", db.one("select o.*,b.name as branch_name from outlets o join branches b on b.tenant_id=o.tenant_id and b.id=o.branch_id where o.tenant_id=? and o.id=?", actor.tenantId(), outletId));
        result.put("categories", db.list("select * from categories where tenant_id=? and outlet_id=? order by sort_order,name", actor.tenantId(), outletId));
        result.put("items", db.list("select * from menu_items where tenant_id=? and outlet_id=? order by name", actor.tenantId(), outletId));
        result.put("tables", db.list("select t.*,o.id as active_order_id,o.status as order_status from restaurant_tables t left join orders o on o.tenant_id=t.tenant_id and o.outlet_id=t.outlet_id and o.table_id=t.id and o.status in ('OPEN','BILL_PENDING') where t.tenant_id=? and t.outlet_id=? order by t.section,t.name", actor.tenantId(), outletId));
        result.put("printers", db.list("select * from printers where tenant_id=? and outlet_id=? order by name", actor.tenantId(), outletId));
        result.put("routes", db.list("select r.*,c.name as category_name,p.name as printer_name from category_routes r join categories c on c.tenant_id=r.tenant_id and c.outlet_id=r.outlet_id and c.id=r.category_id join printers p on p.tenant_id=r.tenant_id and p.outlet_id=r.outlet_id and p.id=r.printer_id where r.tenant_id=? and r.outlet_id=? order by c.sort_order,c.name", actor.tenantId(), outletId));
        return result;
    }

    public Map<String, Object> settings(Actor actor) {
        actor.require("SETTINGS");
        return db.tx(actor, () -> {
            List<Map<String, Object>> outlets = auth.accessibleOutlets(actor);
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("tenant", db.one("select id,slug,name,receipt_address,tax_number,phone,receipt_footer from tenants where id=?", actor.tenantId()));
            result.put("branches", db.list("select b.* from branches b where b.tenant_id=? and (?='OWNER' or exists (select 1 from outlets o join user_outlets u on u.tenant_id=o.tenant_id and u.outlet_id=o.id and u.user_id=? where o.tenant_id=b.tenant_id and o.branch_id=b.id)) order by b.name", actor.tenantId(), actor.role(), actor.userId()));
            result.put("outlets", outlets);
            result.put("users", visibleUsers(actor));
            for (String kind : List.of("categories", "items", "tables", "printers", "routes")) result.put(kind, new ArrayList<Map<String, Object>>());
            for (Map<String, Object> outlet : outlets) {
                Map<String, Object> catalog = catalogInside(actor, UUID.fromString(outlet.get("id").toString()));
                for (String kind : List.of("categories", "items", "tables", "printers", "routes")) {
                    @SuppressWarnings("unchecked") List<Map<String, Object>> target = (List<Map<String, Object>>) result.get(kind);
                    @SuppressWarnings("unchecked") List<Map<String, Object>> rows = (List<Map<String, Object>>) catalog.get(kind);
                    target.addAll(rows);
                }
            }
            return result;
        });
    }

    private List<Map<String, Object>> visibleUsers(Actor actor) {
        return db.list("select u.id,u.tenant_id,u.name,u.email,u.role,u.active,u.created_at,coalesce((select jsonb_agg(x.outlet_id order by x.outlet_id) from user_outlets x where x.tenant_id=u.tenant_id and x.user_id=u.id),'[]'::jsonb) as outlet_ids from users u where u.tenant_id=? and (?='OWNER' or (u.role<>'OWNER' and exists (select 1 from user_outlets x where x.tenant_id=u.tenant_id and x.user_id=u.id) and not exists (select 1 from user_outlets x where x.tenant_id=u.tenant_id and x.user_id=u.id and not exists (select 1 from user_outlets mine where mine.tenant_id=x.tenant_id and mine.user_id=? and mine.outlet_id=x.outlet_id)))) order by u.name",
                actor.tenantId(), actor.role(), actor.userId());
    }
    private Map<String, Object> user(Actor actor, UUID id) {
        return db.one("select u.id,u.tenant_id,u.name,u.email,u.role,u.active,u.created_at,coalesce((select jsonb_agg(x.outlet_id order by x.outlet_id) from user_outlets x where x.tenant_id=u.tenant_id and x.user_id=u.id),'[]'::jsonb) as outlet_ids from users u where u.tenant_id=? and u.id=?", actor.tenantId(), id);
    }

    public Map<String, Object> business(Actor actor, CatalogDtos.Business input) {
        actor.require("SETTINGS"); owner(actor);
        return db.tx(actor, () -> {
            db.update("update tenants set name=?,receipt_address=?,tax_number=?,phone=?,receipt_footer=? where id=?",
                    input.name().strip(), input.receiptAddress().strip(), input.taxNumber().strip(), input.phone().strip(), input.receiptFooter().strip(), actor.tenantId());
            db.audit(actor, null, "BUSINESS_UPDATE", "TENANT", actor.tenantId(), "", Map.of());
            return db.one("select * from tenants where id=?", actor.tenantId());
        });
    }
    public Map<String, Object> branch(Actor actor, CatalogDtos.Branch input) {
        actor.require("SETTINGS"); owner(actor);
        return db.tx(actor, () -> {
            UUID id = UUID.randomUUID();
            db.update("insert into branches(id,tenant_id,name,address) values (?,?,?,?)", id, actor.tenantId(), input.name().strip(), input.address().strip());
            db.audit(actor, null, "BRANCH_CREATE", "BRANCH", id, "", Map.of());
            return db.one("select * from branches where tenant_id=? and id=?", actor.tenantId(), id);
        });
    }
    public Map<String, Object> outlet(Actor actor, UUID id, CatalogDtos.Outlet input) {
        actor.require("SETTINGS");
        unique(input.serviceModes(), "service modes"); unique(input.paymentMethods(), "payment methods");
        ZoneId.of(input.timezone()); Currency.getInstance(input.currency());
        if (!"INR".equals(input.currency())) throw new ApiException(422, "This restaurant edition currently supports INR only.");
        if (id == null) owner(actor);
        return db.tx(actor, () -> {
            UUID saved = id == null ? UUID.randomUUID() : id;
            Map<String, Object> previous = null;
            if (id != null) {
                previous = lockOutlet(actor, id);
                if (!"OWNER".equals(actor.role()) && !input.branchId().toString().equals(previous.get("branch_id"))) throw new ApiException(403, "Only an owner can move an outlet between branches.");
                List<Map<String, Object>> active = db.list("select service_mode from orders where tenant_id=? and outlet_id=? and status in ('OPEN','BILL_PENDING')", actor.tenantId(), id);
                for (Map<String, Object> order : active) if (!input.serviceModes().contains(order.get("service_mode"))) throw new ApiException(409, "A service mode cannot be removed while it has active orders.");
                if (!active.isEmpty() && (!input.currency().equals(previous.get("currency"))
                        || !input.timezone().equals(previous.get("timezone"))
                        || !input.paymentMethods().equals(previous.get("payment_methods")))) {
                    throw new ApiException(409, "Finish active orders before changing currency, timezone or payment methods.");
                }
            }
            db.one("select id from branches where tenant_id=? and id=?", actor.tenantId(), input.branchId());
            if (id == null) {
                db.update("insert into outlets(id,tenant_id,branch_id,name,service_modes,payment_methods,currency,timezone) values (?,?,?,?,?::text[],?::text[],?,?)",
                        saved, actor.tenantId(), input.branchId(), input.name().strip(), textArray(input.serviceModes()), textArray(input.paymentMethods()), input.currency(), input.timezone());
            } else {
                db.update("update outlets set branch_id=?,name=?,service_modes=?::text[],payment_methods=?::text[],currency=?,timezone=? where tenant_id=? and id=?",
                        input.branchId(), input.name().strip(), textArray(input.serviceModes()), textArray(input.paymentMethods()), input.currency(), input.timezone(), actor.tenantId(), id);
            }
            db.audit(actor, saved, id == null ? "OUTLET_CREATE" : "OUTLET_UPDATE", "OUTLET", saved, "", Map.of());
            return db.one("select * from outlets where tenant_id=? and id=?", actor.tenantId(), saved);
        });
    }

    public Map<String, Object> createUser(Actor actor, CatalogDtos.CreateUser input) {
        actor.require("USERS"); AuthService.validatePassword(input.password());
        String hash = passwords.encode(input.password());
        return db.tx(actor, () -> {
            // Serialize membership/role edits and last-owner checks per tenant.
            db.one("select id from tenants where id=? for update", actor.tenantId());
            validateAssignments(actor, input.role(), input.outletIds());
            UUID id = UUID.randomUUID();
            db.update("insert into users(id,tenant_id,name,email,password_hash,role) values (?,?,?,?,?,?)",
                    id, actor.tenantId(), input.name().strip(), AuthService.normalizeEmail(input.email()), hash, input.role());
            assign(actor, id, input.outletIds());
            db.audit(actor, null, "USER_CREATE", "USER", id, "", Map.of("role", input.role(), "outletIds", input.outletIds()));
            return user(actor, id);
        });
    }
    public Map<String, Object> updateUser(Actor actor, UUID id, CatalogDtos.UpdateUser input) {
        actor.require("USERS");
        return db.tx(actor, () -> {
            db.one("select id from tenants where id=? for update", actor.tenantId());
            Map<String, Object> before = db.one("select id,role,active from users where tenant_id=? and id=? for update", actor.tenantId(), id);
            validateAssignments(actor, input.role(), input.outletIds());
            List<UUID> oldAssignments = db.list("select outlet_id from user_outlets where tenant_id=? and user_id=?", actor.tenantId(), id).stream().map(row -> UUID.fromString(row.get("outlet_id").toString())).toList();
            if (!"OWNER".equals(actor.role())) {
                if ("OWNER".equals(before.get("role")) || oldAssignments.isEmpty()) throw new ApiException(403, "This user can only be managed by an owner.");
                for (UUID outlet : oldAssignments) db.outlet(actor, outlet);
            }
            if (actor.userId().equals(id) && (!input.role().equals(before.get("role")) || !input.active()
                    || !new HashSet<>(oldAssignments).equals(new HashSet<>(input.outletIds())))) {
                throw new ApiException(409, "You cannot change your own role, access or active status.");
            }
            if ("OWNER".equals(before.get("role")) && Boolean.TRUE.equals(before.get("active"))
                    && (!"OWNER".equals(input.role()) || !input.active())) {
                Number count = (Number) db.one("select count(*) as count from users where tenant_id=? and role='OWNER' and active=true", actor.tenantId()).get("count");
                if (count.longValue() <= 1) throw new ApiException(409, "At least one active owner is required.");
            }
            db.update("update users set name=?,email=?,role=?,active=? where tenant_id=? and id=?",
                    input.name().strip(), AuthService.normalizeEmail(input.email()), input.role(), input.active(), actor.tenantId(), id);
            db.update("delete from user_outlets where tenant_id=? and user_id=?", actor.tenantId(), id);
            assign(actor, id, input.outletIds());
            auth.revoke(actor.tenantId(), id);
            db.audit(actor, null, "USER_UPDATE", "USER", id, "All sessions revoked", Map.of("role", input.role(), "active", input.active(), "outletIds", input.outletIds()));
            return user(actor, id);
        });
    }
    private void validateAssignments(Actor actor, String role, List<UUID> outlets) {
        if ("OWNER".equals(role)) owner(actor);
        unique(outlets, "outlet assignments");
        if (!"OWNER".equals(role) && outlets.isEmpty()) throw new ApiException(422, "Non-owner users need at least one assigned outlet.");
        for (UUID id : outlets) db.outlet(actor, id);
    }
    private void assign(Actor actor, UUID user, List<UUID> outlets) {
        for (UUID outlet : outlets) db.update("insert into user_outlets(tenant_id,user_id,outlet_id) values (?,?,?)", actor.tenantId(), user, outlet);
    }

    public Map<String, Object> category(Actor actor, UUID id, CatalogDtos.Category input) {
        actor.require("SETTINGS");
        return db.tx(actor, () -> {
            lockOutlet(actor, input.outletId());
            UUID saved = id == null ? UUID.randomUUID() : id;
            if (id == null) db.update("insert into categories(id,tenant_id,outlet_id,name,department,sort_order) values (?,?,?,?,?,?)",
                    saved, actor.tenantId(), input.outletId(), input.name().strip(), input.department().strip(), input.sortOrder());
            else {
                entity(actor, "categories", id, input.outletId(), true);
                db.update("update categories set name=?,department=?,sort_order=? where tenant_id=? and outlet_id=? and id=?",
                        input.name().strip(), input.department().strip(), input.sortOrder(), actor.tenantId(), input.outletId(), id);
            }
            db.audit(actor, input.outletId(), id == null ? "CATEGORY_CREATE" : "CATEGORY_UPDATE", "CATEGORY", saved, "", Map.of());
            return entity(actor, "categories", saved, input.outletId(), false);
        });
    }
    public Map<String, Object> item(Actor actor, UUID id, CatalogDtos.Item input) {
        actor.require("SETTINGS");
        List<Map<String, Object>> variants = options(input.variants()), modifiers = options(input.modifiers());
        BigDecimal highestBase = input.price();
        for (CatalogDtos.Option variant : input.variants()) highestBase = highestBase.max(variant.price());
        BigDecimal maxUnit = highestBase;
        for (CatalogDtos.Option modifier : input.modifiers()) maxUnit = maxUnit.add(modifier.price());
        if (maxUnit.compareTo(new BigDecimal("9999999999.99")) > 0) throw new ApiException(422, "Combined item and modifier price exceeds the supported amount.");
        return db.tx(actor, () -> {
            lockOutlet(actor, input.outletId());
            entity(actor, "categories", input.categoryId(), input.outletId(), false);
            UUID saved = id == null ? UUID.randomUUID() : id;
            if (id == null) db.update("insert into menu_items(id,tenant_id,outlet_id,category_id,name,description,price,tax_rate,available,vegetarian,variants,modifiers) values (?,?,?,?,?,?,?,?,?,?,?::jsonb,?::jsonb)",
                    saved, actor.tenantId(), input.outletId(), input.categoryId(), input.name().strip(), input.description().strip(), input.price(), input.taxRate(), input.available(), input.vegetarian(), db.json(variants), db.json(modifiers));
            else {
                entity(actor, "menu_items", id, input.outletId(), true);
                db.update("update menu_items set category_id=?,name=?,description=?,price=?,tax_rate=?,available=?,vegetarian=?,variants=?::jsonb,modifiers=?::jsonb where tenant_id=? and outlet_id=? and id=?",
                        input.categoryId(), input.name().strip(), input.description().strip(), input.price(), input.taxRate(), input.available(), input.vegetarian(), db.json(variants), db.json(modifiers), actor.tenantId(), input.outletId(), id);
            }
            db.audit(actor, input.outletId(), id == null ? "ITEM_CREATE" : "ITEM_UPDATE", "MENU_ITEM", saved, "", Map.of());
            return entity(actor, "menu_items", saved, input.outletId(), false);
        });
    }
    static List<Map<String, Object>> options(List<CatalogDtos.Option> options) {
        Set<String> names = new HashSet<>();
        List<Map<String, Object>> normalized = new ArrayList<>();
        for (CatalogDtos.Option option : options) {
            String name = option.name().strip();
            if (name.isEmpty() || !names.add(name.toLowerCase(Locale.ROOT))) throw new ApiException(422, "Variant and modifier names must be nonblank and unique.");
            if (option.price() == null || option.price().signum() < 0 || option.price().scale() > 2
                    || option.price().compareTo(new BigDecimal("9999999999.99")) > 0) throw new ApiException(422, "Invalid variant or modifier price.");
            normalized.add(Map.of("name", name, "price", option.price()));
        }
        return normalized;
    }

    public Map<String, Object> table(Actor actor, UUID id, CatalogDtos.Table input) {
        actor.require("SETTINGS");
        return db.tx(actor, () -> {
            lockOutlet(actor, input.outletId());
            UUID saved = id == null ? UUID.randomUUID() : id;
            if (id == null) db.update("insert into restaurant_tables(id,tenant_id,outlet_id,name,section,seats) values (?,?,?,?,?,?)",
                    saved, actor.tenantId(), input.outletId(), input.name().strip(), input.section().strip(), input.seats());
            else {
                entity(actor, "restaurant_tables", id, input.outletId(), true);
                if (!db.list("select id from orders where tenant_id=? and outlet_id=? and table_id=? and status in ('OPEN','BILL_PENDING')", actor.tenantId(), input.outletId(), id).isEmpty()) {
                    throw new ApiException(409, "An occupied table cannot be edited. Settle or transfer its order first.");
                }
                db.update("update restaurant_tables set name=?,section=?,seats=? where tenant_id=? and outlet_id=? and id=?",
                        input.name().strip(), input.section().strip(), input.seats(), actor.tenantId(), input.outletId(), id);
            }
            db.audit(actor, input.outletId(), id == null ? "TABLE_CREATE" : "TABLE_UPDATE", "TABLE", saved, "", Map.of());
            return entity(actor, "restaurant_tables", saved, input.outletId(), false);
        });
    }

    public Map<String, Object> printer(Actor actor, UUID id, CatalogDtos.Printer input) {
        actor.require("SETTINGS");
        if (input.paperWidth() != 58 && input.paperWidth() != 80) throw new ApiException(422, "Paper width must be 58 or 80 mm.");
        boolean kot = List.of("KOT", "BOTH").contains(input.documentType());
        boolean bill = List.of("BILL", "BOTH").contains(input.documentType());
        if ((input.isFallback() && (!kot || !input.enabled())) || (input.isReceipt() && (!bill || !input.enabled()))) {
            throw new ApiException(422, "Fallback and receipt printers must be enabled and support their document type.");
        }
        return db.tx(actor, () -> {
            lockOutlet(actor, input.outletId());
            UUID saved = id == null ? UUID.randomUUID() : id;
            if (id != null) {
                Map<String, Object> before = entity(actor, "printers", id, input.outletId(), true);
                if ((!kot || !input.enabled()) && !db.list("select category_id from category_routes where tenant_id=? and outlet_id=? and printer_id=?", actor.tenantId(), input.outletId(), id).isEmpty()) {
                    throw new ApiException(409, "Reassign kitchen routes before disabling this printer or removing KOT support.");
                }
                boolean hasPending = !db.list("select id from print_jobs where tenant_id=? and outlet_id=? and printer_id=? and status in ('PENDING','CLAIMED','FAILED','UNCERTAIN') limit 1", actor.tenantId(), input.outletId(), id).isEmpty();
                if (hasPending && (!input.enabled() || !input.deviceKey().equals(before.get("device_key")) || !input.documentType().equals(before.get("document_type")))) {
                    throw new ApiException(409, "Resolve outstanding print jobs before changing this device or its capabilities.");
                }
            }
            // Replace the singleton mapping rather than rely on a unique-index failure.
            if (input.isFallback()) db.update("update printers set is_fallback=false where tenant_id=? and outlet_id=? and is_fallback=true and id<>?", actor.tenantId(), input.outletId(), saved);
            if (input.isReceipt()) db.update("update printers set is_receipt=false where tenant_id=? and outlet_id=? and is_receipt=true and id<>?", actor.tenantId(), input.outletId(), saved);
            if (id == null) db.update("insert into printers(id,tenant_id,outlet_id,name,device_key,document_type,paper_width,copies,enabled,is_fallback,is_receipt,template) values (?,?,?,?,?,?,?,?,?,?,?,?)",
                    saved, actor.tenantId(), input.outletId(), input.name().strip(), input.deviceKey(), input.documentType(), input.paperWidth(), input.copies(), input.enabled(), input.isFallback(), input.isReceipt(), input.template());
            else db.update("update printers set name=?,device_key=?,document_type=?,paper_width=?,copies=?,enabled=?,is_fallback=?,is_receipt=?,template=? where tenant_id=? and outlet_id=? and id=?",
                    input.name().strip(), input.deviceKey(), input.documentType(), input.paperWidth(), input.copies(), input.enabled(), input.isFallback(), input.isReceipt(), input.template(), actor.tenantId(), input.outletId(), id);
            db.audit(actor, input.outletId(), id == null ? "PRINTER_CREATE" : "PRINTER_UPDATE", "PRINTER", saved, "", Map.of());
            return entity(actor, "printers", saved, input.outletId(), false);
        });
    }
    public Map<String, Object> routes(Actor actor, CatalogDtos.Routes input) {
        actor.require("SETTINGS");
        return db.tx(actor, () -> {
            lockOutlet(actor, input.outletId());
            Set<UUID> seen = new HashSet<>();
            for (CatalogDtos.Route route : input.routes()) {
                if (!seen.add(route.categoryId())) throw new ApiException(422, "Each category can have only one kitchen route.");
                entity(actor, "categories", route.categoryId(), input.outletId(), false);
                Map<String, Object> printer = entity(actor, "printers", route.printerId(), input.outletId(), true);
                if (!Boolean.TRUE.equals(printer.get("enabled")) || !List.of("KOT", "BOTH").contains(printer.get("document_type"))) throw new ApiException(422, "Kitchen routes require an enabled KOT-capable printer.");
            }
            db.update("delete from category_routes where tenant_id=? and outlet_id=?", actor.tenantId(), input.outletId());
            for (CatalogDtos.Route route : input.routes()) db.update("insert into category_routes(tenant_id,outlet_id,category_id,printer_id) values (?,?,?,?)", actor.tenantId(), input.outletId(), route.categoryId(), route.printerId());
            db.audit(actor, input.outletId(), "ROUTES_UPDATE", "OUTLET", input.outletId(), "", Map.of("routes", input.routes()));
            return Map.of("ok", true);
        });
    }

    private Map<String, Object> lockOutlet(Actor actor, UUID id) {
        db.outlet(actor, id);
        return db.one("select * from outlets where tenant_id=? and id=? for update", actor.tenantId(), id);
    }
    private Map<String, Object> entity(Actor actor, String table, UUID id, UUID outlet, boolean lock) {
        // Only internal hard-coded identifiers are accepted; never concatenate user SQL.
        if (!Set.of("categories", "menu_items", "restaurant_tables", "printers").contains(table)) throw new IllegalArgumentException("Unknown catalog entity");
        return db.one("select * from " + table + " where tenant_id=? and outlet_id=? and id=?" + (lock ? " for update" : ""), actor.tenantId(), outlet, id);
    }
    private static void owner(Actor actor) {
        if (!"OWNER".equals(actor.role())) throw new ApiException(403, "Only an owner can perform this organization-wide action.");
    }
    private static void unique(List<?> values, String label) {
        if (new HashSet<>(values).size() != values.size()) throw new ApiException(422, "Duplicate " + label + " are not allowed.");
    }
    private static String textArray(List<String> values) {
        // Values have been restricted to fixed enum strings at the JSON boundary.
        return "{" + String.join(",", values) + "}";
    }
}
