package com.restaurant.pos;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

/** Opt-in local sample catalog only. Never creates orders, payments, metrics or print successes. */
@Component
@ConditionalOnProperty(name="app.seed-demo", havingValue="true")
public class DemoSeeder implements ApplicationRunner {
    private final TenantJdbc db;
    private final PasswordEncoder passwords;
    private final String password;
    public DemoSeeder(TenantJdbc db, PasswordEncoder passwords, @Value("${app.demo-password:}") String password) {
        this.db = db; this.passwords = passwords; this.password = password;
        try { AuthService.validatePassword(password); }
        catch (ApiException ex) { throw new IllegalStateException("APP_SEED_DEMO requires DEMO_PASSWORD with at least 12 characters and at most 72 UTF-8 bytes."); }
    }
    @Override public void run(ApplicationArguments args) {
        seed("saffron", "Saffron House", "Saffron Owner", "24 Garden Road, Bengaluru", false);
        seed("coastal", "Coastal Table", "Coastal Owner", "8 Ocean Promenade, Kochi", true);
    }
    private void seed(String slug, String name, String ownerName, String address, boolean coastal) {
        // Existing tenants (including real restaurants with these slugs) are never altered or reset.
        if (!db.list("select id from tenants where slug=?", slug).isEmpty()) return;
        UUID tenant = UUID.randomUUID(), owner = UUID.randomUUID(), branch = UUID.randomUUID(), outlet = UUID.randomUUID();
        String hash = passwords.encode(password);
        db.asTenant(tenant, () -> {
            int inserted = db.update("insert into tenants(id,slug,name,receipt_address,receipt_footer,is_demo) values (?,?,?,?,?,true) on conflict(slug) do nothing",
                    tenant, slug, name, address, "Good food. Warm company. See you again soon.");
            if (inserted == 0) return null;
            db.update("insert into branches(id,tenant_id,name,address) values (?,?,?,?)", branch, tenant, coastal ? "Seafront" : "Garden District", address);
            db.update("insert into outlets(id,tenant_id,branch_id,name,service_modes) values (?,?,?,?,ARRAY['DINE_IN','TAKEAWAY','DELIVERY'])", outlet, tenant, branch, coastal ? "The Verandah" : "Main Dining");
            db.update("insert into users(id,tenant_id,email,name,password_hash,role) values (?,?,?,?,?,'OWNER')", owner, tenant, "owner@" + slug + ".test", ownerName, hash);
            db.update("insert into user_outlets(tenant_id,user_id,outlet_id) values (?,?,?)", tenant, owner, outlet);
            UUID kitchen = UUID.randomUUID(), receipt = UUID.randomUUID();
            db.update("insert into printers(id,tenant_id,outlet_id,name,device_key,document_type,is_fallback) values (?,?,?,?,'kitchen','KOT',true)", kitchen, tenant, outlet, "Kitchen Pass");
            db.update("insert into printers(id,tenant_id,outlet_id,name,device_key,document_type,is_receipt) values (?,?,?,?,'receipt','BILL',true)", receipt, tenant, outlet, "Front Counter");
            UUID starters = category(tenant, outlet, "Small plates", "Hot kitchen", 10, kitchen);
            UUID mains = category(tenant, outlet, "House favourites", "Hot kitchen", 20, kitchen);
            UUID breads = category(tenant, outlet, coastal ? "Rice & sides" : "Breads & sides", "Hot kitchen", 30, kitchen);
            UUID drinks = category(tenant, outlet, "Sips & sweets", "Beverages & desserts", 40, kitchen);
            if (coastal) {
                item(tenant, outlet, starters, "Crisp banana flower bites", "Banana blossom, curry leaf and a bright coconut dip.", "220", true, List.of(), List.of());
                item(tenant, outlet, starters, "Pepper prawn roast", "Coastal prawns, cracked pepper and slow-roasted shallots.", "390", false, List.of(), List.of());
                item(tenant, outlet, starters, "Plantain chips & chutney", "Thin-cut plantain with house tamarind chutney.", "120", true, List.of(), List.of());
                item(tenant, outlet, mains, "Malabar fish curry", "Day's fish in a gently spiced coconut and tamarind broth.", "420", false, List.of(), List.of(option("Extra fish", "160")));
                item(tenant, outlet, mains, "Vegetable moilee", "Seasonal vegetables, coconut milk and fragrant whole spices.", "310", true, List.of(), List.of());
                item(tenant, outlet, mains, "Coastal chicken roast", "Slow-roasted chicken with curry leaves and toasted spice.", "380", false, List.of(), List.of());
                item(tenant, outlet, breads, "Steamed matta rice", "A bowl of Kerala's nutty red rice.", "110", true, List.of(option("Regular", "110"), option("Large", "160")), List.of());
                item(tenant, outlet, breads, "Appam basket", "Three soft-centred, lace-edged rice appams.", "130", true, List.of(), List.of());
                item(tenant, outlet, drinks, "Tender coconut cooler", "Coconut water, lime and a little mint.", "150", true, List.of(), List.of());
                item(tenant, outlet, drinks, "Filter coffee", "Freshly brewed South Indian coffee.", "100", true, List.of(), List.of());
                item(tenant, outlet, drinks, "Jaggery payasam", "Warm rice pudding with jaggery and toasted cashews.", "170", true, List.of(), List.of());
                item(tenant, outlet, drinks, "Lime soda", "Fresh lime, chilled soda and your choice of sweet or salt.", "110", true, List.of(), List.of());
            } else {
                item(tenant, outlet, starters, "Paneer tikka", "Charred cottage cheese, peppers and a cooling mint chutney.", "280", true, List.of(), List.of(option("Extra paneer", "70")));
                item(tenant, outlet, starters, "Tandoori chicken", "Yogurt-marinated chicken, finished in the tandoor.", "340", false, List.of(option("Half", "340"), option("Full", "620")), List.of());
                item(tenant, outlet, starters, "Crispy corn", "Golden corn tossed with lime, chilli and fresh coriander.", "190", true, List.of(), List.of());
                item(tenant, outlet, mains, "Dal makhani", "Black lentils, slow cooked overnight with tomato and cream.", "260", true, List.of(), List.of(option("Extra butter", "25")));
                item(tenant, outlet, mains, "Paneer butter masala", "Cottage cheese in our silky tomato and cashew gravy.", "320", true, List.of(), List.of(option("Extra paneer", "70")));
                item(tenant, outlet, mains, "Hyderabadi biryani", "Dum-cooked basmati rice with whole spices and raita.", "310", true, List.of(option("Vegetable", "310")), List.of(option("Extra raita", "40")));
                item(tenant, outlet, mains, "Butter chicken", "Tender tandoori chicken in a rich tomato gravy.", "380", false, List.of(), List.of());
                item(tenant, outlet, breads, "Garlic naan", "Tandoor-baked bread brushed with garlic butter.", "80", true, List.of(), List.of());
                item(tenant, outlet, breads, "Jeera rice", "Steamed basmati, toasted cumin and ghee.", "160", true, List.of(option("Regular", "160"), option("Large", "240")), List.of());
                item(tenant, outlet, drinks, "Mango lassi", "Thick yogurt and ripe mango, served chilled.", "150", true, List.of(), List.of());
                item(tenant, outlet, drinks, "Masala chai", "Fresh ginger, cardamom and a comforting cup of tea.", "90", true, List.of(), List.of());
                item(tenant, outlet, drinks, "Gulab jamun", "Two warm dumplings in a delicate rose syrup.", "140", true, List.of(), List.of(option("Vanilla ice cream", "60")));
            }
            for (int number = 1; number <= 12; number++) {
                String section = number <= 8 ? "Main dining" : (coastal ? "Verandah" : "Garden terrace");
                db.update("insert into restaurant_tables(id,tenant_id,outlet_id,name,section,seats) values (?,?,?,?,?,?)",
                        UUID.randomUUID(), tenant, outlet, String.format("T%02d", number), section, number <= 2 ? 2 : number >= 11 ? 6 : 4);
            }
            Actor actor = new Actor(tenant, owner, "OWNER", ownerName, "owner@" + slug + ".test");
            db.audit(actor, outlet, "DEMO_CATALOG_SEED", "TENANT", tenant, "Opt-in local sample catalog", Map.of());
            return null;
        });
    }
    private UUID category(UUID tenant, UUID outlet, String name, String department, int order, UUID printer) {
        UUID id = UUID.randomUUID();
        db.update("insert into menu_groups(id,tenant_id,outlet_id,name) values (?,?,?,'General') on conflict do nothing",
                UUID.randomUUID(), tenant, outlet);
        db.update("""
                insert into categories(id,tenant_id,outlet_id,name,department,sort_order,group_id)
                select ?,?,?,?,?,?,id from menu_groups where tenant_id=? and outlet_id=? and lower(name)='general'
                """, id, tenant, outlet, name, department, order, tenant, outlet);
        db.update("insert into category_routes(tenant_id,outlet_id,category_id,printer_id) values (?,?,?,?)", tenant, outlet, id, printer);
        return id;
    }
    private Map<String, Object> option(String name, String price) { return Map.of("name", name, "price", new BigDecimal(price)); }
    private void item(UUID tenant, UUID outlet, UUID category, String name, String description, String price,
            boolean vegetarian, List<Map<String, Object>> variants, List<Map<String, Object>> modifiers) {
        db.update("insert into menu_items(id,tenant_id,outlet_id,category_id,name,description,price,tax_rate,vegetarian,variants,modifiers) values (?,?,?,?,?,?,?,5,?,?::jsonb,?::jsonb)",
                UUID.randomUUID(), tenant, outlet, category, name, description, new BigDecimal(price), vegetarian, db.json(variants), db.json(modifiers));
    }
}
