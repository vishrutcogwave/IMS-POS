package com.restaurant.pos;

import jakarta.validation.Valid;
import com.restaurant.pos.CatalogDtos.Option;
import jakarta.validation.Validator;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.util.*;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/settings")
public class MenuMastersController {
    private final TenantJdbc db;
    private final CatalogService catalog;
    private final Validator validator;

    public MenuMastersController(TenantJdbc db, CatalogService catalog, Validator validator) {
        this.db = db;
        this.catalog = catalog;
        this.validator = validator;
    }

    record Master(@NotNull UUID outletId, @NotBlank @Size(max=80) String name,
                  @DecimalMin("0") @DecimalMax("100") @Digits(integer=3,fraction=2) BigDecimal rate) {}
    record NamedMaster(@NotNull UUID outletId, @NotBlank @Size(max=120) String name, @NotNull Boolean active) {}

    @PostMapping("/nc-departments")
    Map<String,Object> createNcDepartment(@Valid @RequestBody NamedMaster value) {
        return saveNamedMaster(Actor.current(), null, value, "nc_departments", "NC_DEPARTMENT");
    }

    @PutMapping("/nc-departments/{id}")
    Map<String,Object> updateNcDepartment(@PathVariable UUID id, @Valid @RequestBody NamedMaster value) {
        return saveNamedMaster(Actor.current(), id, value, "nc_departments", "NC_DEPARTMENT");
    }

    @PostMapping("/stewards")
    Map<String,Object> createSteward(@Valid @RequestBody NamedMaster value) {
        return saveNamedMaster(Actor.current(), null, value, "stewards", "STEWARD");
    }

    @PutMapping("/stewards/{id}")
    Map<String,Object> updateSteward(@PathVariable UUID id, @Valid @RequestBody NamedMaster value) {
        return saveNamedMaster(Actor.current(), id, value, "stewards", "STEWARD");
    }

    private Map<String,Object> saveNamedMaster(Actor actor, UUID id, NamedMaster value, String table, String entity) {
        actor.require("SETTINGS");
        return db.tx(actor, () -> {
            UUID outlet = value.outletId();
            db.outlet(actor, outlet);
            db.one("select id from outlets where tenant_id=? and id=? for update", actor.tenantId(), outlet);
            UUID steward = id == null ? UUID.randomUUID() : id;
            String name = value.name().strip();
            if (!db.list("select id from " + table + " where tenant_id=? and outlet_id=? and lower(name)=lower(?) and id<>?",
                    actor.tenantId(), outlet, name, steward).isEmpty()) {
                throw new ApiException(409, "This name is already used in the selected outlet.", Map.of("name", "Enter a unique steward name."));
            }
            Map<String,Object> row = id == null
                    ? db.one("insert into " + table + "(id,tenant_id,outlet_id,name,active) values (?,?,?,?,?) returning id,outlet_id,name,active",
                            steward, actor.tenantId(), outlet, name, value.active())
                    : db.one("update " + table + " set name=?,active=? where tenant_id=? and outlet_id=? and id=? returning id,outlet_id,name,active",
                            name, value.active(), actor.tenantId(), outlet, id);
            db.audit(actor, outlet, entity + (id == null ? "_CREATE" : "_UPDATE"), entity, steward, "", row);
            return row;
        });
    }
    record Import(@NotNull UUID outletId, @NotNull @Size(min=1,max=200) List<@NotNull ImportRow> rows) {}
    record ImportRow(@Min(2) @Max(201) int row,
                     @NotBlank @Size(max=140) String name, @NotBlank @Size(max=100) String category,
                     @Size(max=100) String group, @NotBlank @Size(max=100) String department, @NotNull @Size(max=4000) String description,
                     @NotNull @DecimalMin("0") @Digits(integer=10,fraction=2) BigDecimal price,
                     @Size(max=80) String unit, @Size(max=80) String tax,
                     @NotNull @DecimalMin("0") @DecimalMax("100") @Digits(integer=3,fraction=2) BigDecimal taxRate,
                     @NotNull Boolean available, @NotNull Boolean vegetarian,
                     @NotNull @Size(max=30) List<@NotNull @Valid Option> variants,
                     @NotNull @Size(max=30) List<@NotNull @Valid Option> modifiers) {}
    record Issue(int row, String field, String message) {}
    record Preview(int items, List<String> groups, List<String> categories, List<String> units, List<String> taxes, List<Issue> issues) {}

    @PostMapping("/menu-masters/{kind}")
    Map<String,Object> create(@PathVariable String kind, @Valid @RequestBody Master value) {
        return save(Actor.current(), kind, null, value);
    }

    @PutMapping("/menu-masters/{kind}/{id}")
    Map<String,Object> update(@PathVariable String kind, @PathVariable UUID id, @Valid @RequestBody Master value) {
        return save(Actor.current(), kind, id, value);
    }

    private Map<String,Object> save(Actor actor, String kind, UUID id, Master value) {
        actor.require("SETTINGS");
        return db.tx(actor, () -> {
            db.outlet(actor, value.outletId());
            return saveMaster(actor, value.outletId(), kind, id, value.name().strip(), value.rate());
        });
    }

    private Map<String,Object> saveMaster(Actor actor, UUID outlet, String kind, UUID id, String name, BigDecimal rate) {
        String table = switch (kind) {
            case "units" -> "menu_units";
            case "taxes" -> "menu_taxes";
            default -> throw new ApiException(404, "Menu master not found.");
        };
        UUID newId = id == null ? UUID.randomUUID() : id;
        if (!db.list("select id from " + table + " where tenant_id=? and outlet_id=? and lower(name)=lower(?) and id<>?",
                actor.tenantId(), outlet, name, newId).isEmpty()) {
            throw new ApiException(409, "This name is already used in the selected outlet.", Map.of("name", "Choose a unique name."));
        }
        Map<String,Object> record;
        if ("units".equals(kind)) {
            record = id == null
                    ? db.one("insert into menu_units(id,tenant_id,outlet_id,name) values (?,?,?,?) returning id,outlet_id,name",
                            newId, actor.tenantId(), outlet, name)
                    : db.one("update menu_units set name=? where tenant_id=? and outlet_id=? and id=? returning id,outlet_id,name",
                            name, actor.tenantId(), outlet, id);
        } else {
            if (rate == null) throw new ApiException(422, "Enter a tax rate.", Map.of("rate", "Enter a percentage from 0 to 100."));
            record = id == null
                    ? db.one("insert into menu_taxes(id,tenant_id,outlet_id,name,rate) values (?,?,?,?,?) returning id,outlet_id,name,rate",
                            newId, actor.tenantId(), outlet, name, rate)
                    : db.one("update menu_taxes set name=?,rate=? where tenant_id=? and outlet_id=? and id=? returning id,outlet_id,name,rate",
                            name, rate, actor.tenantId(), outlet, id);
            if (id != null) db.update("update menu_items set tax_rate=? where tenant_id=? and outlet_id=? and tax_id=?",
                    rate, actor.tenantId(), outlet, id);
        }
        db.audit(actor, outlet, id == null ? "MENU_MASTER_CREATE" : "MENU_MASTER_UPDATE", table.toUpperCase(Locale.ROOT), newId, "", Map.of());
        return record;
    }

    @PostMapping("/items/import/preview")
    Preview preview(@Valid @RequestBody Import input) {
        Actor actor = Actor.current();
        actor.require("SETTINGS");
        return db.tx(actor, () -> {
            db.outlet(actor, input.outletId());
            return inspect(actor, input);
        });
    }

    @PostMapping("/items/import/confirm")
    Map<String,Object> confirm(@Valid @RequestBody Import input) {
        Actor actor = Actor.current();
        actor.require("SETTINGS");
        return db.tx(actor, () -> {
            UUID outlet = input.outletId();
            db.outlet(actor, outlet);
            Preview checked = inspect(actor, input);
            if (!checked.issues().isEmpty()) throw new ApiException(422, "The item import contains errors. Run preview again and fix the indicated rows.");
            var categories = index(actor, outlet, "categories");
            var groups = index(actor, outlet, "menu_groups");
            var units = index(actor, outlet, "menu_units");
            var taxes = index(actor, outlet, "menu_taxes");
            for (ImportRow row : input.rows()) {
                UUID category = id(categories.computeIfAbsent(key(row.category()), unused -> {
                    String groupName = importGroup(row);
                    UUID groupId = id(groups.computeIfAbsent(key(groupName), ignored ->
                            catalog.group(actor, null, new CatalogDtos.Group(outlet, groupName))));
                    return catalog.category(actor, null, new CatalogDtos.Category(outlet, row.category().strip(),
                            row.department().strip(), 0, groupId));
                }));
                UUID unit = key(row.unit()).isEmpty() ? null : id(units.computeIfAbsent(key(row.unit()), unused ->
                        saveMaster(actor, outlet, "units", null, row.unit().strip(), null)));
                UUID tax = key(row.tax()).isEmpty() ? null : id(taxes.computeIfAbsent(key(row.tax()), unused ->
                        saveMaster(actor, outlet, "taxes", null, row.tax().strip(), row.taxRate())));
                catalog.item(actor, null, new CatalogDtos.Item(outlet, category, row.name().strip(), row.description(),
                        row.price(), row.taxRate(), row.available(), row.vegetarian(), row.variants(), row.modifiers(), unit, tax));
            }
            return Map.of("imported", input.rows().size());
        });
    }

    private Preview inspect(Actor actor, Import input) {
        UUID outlet = input.outletId();
        var categories = index(actor, outlet, "categories");
        var units = index(actor, outlet, "menu_units");
        var taxes = index(actor, outlet, "menu_taxes");
        var items = index(actor, outlet, "menu_items");
        var groups = index(actor, outlet, "menu_groups");
        Map<String,String> newGroups = new LinkedHashMap<>();
        Map<String,String> plannedGroups = new HashMap<>();
        Set<String> itemNames = new HashSet<>(items.keySet());
        Map<String,String> newCategories = new LinkedHashMap<>();
        Map<String,String> newUnits = new LinkedHashMap<>();
        Map<String,String> newTaxes = new LinkedHashMap<>();
        Map<String,BigDecimal> plannedRates = new HashMap<>();
        Map<String,String> plannedDepartments = new HashMap<>();
        List<Issue> issues = new ArrayList<>();
        for (ImportRow row : input.rows()) {
            var violations = validator.validate(row);
            for (var violation : violations) issues.add(new Issue(row.row(), violation.getPropertyPath().toString(), violation.getMessage()));
            if (!violations.isEmpty()) continue;
            if (!itemNames.add(key(row.name()))) issues.add(new Issue(row.row(), "name", "This item name already exists in the outlet or in the workbook."));
            String category = key(row.category());
            if (!categories.containsKey(category)) {
                newCategories.putIfAbsent(category, row.category().strip());
                String groupName = importGroup(row);
                String previousGroup = plannedGroups.putIfAbsent(category, key(groupName));
                if (previousGroup != null && !previousGroup.equals(key(groupName))) {
                    issues.add(new Issue(row.row(), "group", "Use one group per category."));
                }
                if (!groups.containsKey(key(groupName))) newGroups.putIfAbsent(key(groupName), groupName);
                String previous = plannedDepartments.putIfAbsent(category, key(row.department()));
                if (previous != null && !previous.equals(key(row.department()))) issues.add(new Issue(row.row(), "department", "Use one kitchen department per new category."));
            }
            else if (!key(row.group()).isEmpty()) {
                Map<String,Object> group = groups.get(key(row.group()));
                if (group == null || !group.get("id").equals(categories.get(category).get("group_id"))) {
                    issues.add(new Issue(row.row(), "group", "This category already belongs to a different group in this outlet."));
                }
            }
            String unit = key(row.unit());
            if (!unit.isEmpty() && !units.containsKey(unit)) newUnits.putIfAbsent(unit, row.unit().strip());
            String tax = key(row.tax());
            if (!tax.isEmpty()) {
                BigDecimal rate;
                if (taxes.containsKey(tax)) {
                    rate = (BigDecimal) taxes.get(tax).get("rate");
                } else {
                    newTaxes.putIfAbsent(tax, row.tax().strip());
                    rate = plannedRates.putIfAbsent(tax, row.taxRate());
                }
                if (rate != null && rate.compareTo(row.taxRate()) != 0) issues.add(new Issue(row.row(), "taxRate", "The rate must match the other rows or the existing tax master."));
            }
            try {
                CatalogService.options(row.variants());
                CatalogService.options(row.modifiers());
                BigDecimal highest = row.variants().stream().map(CatalogDtos.Option::price).reduce(row.price(), BigDecimal::max);
                BigDecimal modifiers = row.modifiers().stream().map(CatalogDtos.Option::price).reduce(BigDecimal.ZERO, BigDecimal::add);
                if (highest.add(modifiers).compareTo(new BigDecimal("9999999999.99")) > 0) {
                    issues.add(new Issue(row.row(), "price", "The item price plus modifiers exceeds the supported amount."));
                }
            } catch (ApiException error) { issues.add(new Issue(row.row(), "options", error.getMessage())); }
        }
        return new Preview(input.rows().size(), List.copyOf(newGroups.values()), List.copyOf(newCategories.values()), List.copyOf(newUnits.values()), List.copyOf(newTaxes.values()), issues);
    }

    private Map<String,Map<String,Object>> index(Actor actor, UUID outlet, String table) {
        String columns = switch (table) {
            case "menu_taxes" -> "id,name,rate";
            case "categories" -> "id,name,group_id";
            default -> "id,name";
        };
        Map<String,Map<String,Object>> result = new LinkedHashMap<>();
        for (var record : db.list("select " + columns + " from " + table + " where tenant_id=? and outlet_id=? order by name,id",
                actor.tenantId(), outlet)) result.putIfAbsent(key((String) record.get("name")), record);
        return result;
    }

    private static String importGroup(ImportRow row) { return key(row.group()).isEmpty() ? "General" : row.group().strip(); }
    private static UUID id(Map<String,Object> row) { return UUID.fromString(row.get("id").toString()); }
    private static String key(String value) { return value == null ? "" : value.strip().toLowerCase(Locale.ROOT); }
}
