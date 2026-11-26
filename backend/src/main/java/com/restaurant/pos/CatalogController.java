package com.restaurant.pos;

import jakarta.validation.Valid;
import java.util.Map;
import java.util.UUID;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
public class CatalogController {
    private final CatalogService catalog;
    public CatalogController(CatalogService catalog) { this.catalog = catalog; }
    @GetMapping("/catalog")
    public Map<String, Object> catalog(@RequestParam UUID outletId) { return catalog.catalog(Actor.current(), outletId); }
    @GetMapping("/settings")
    public Map<String, Object> settings() { return catalog.settings(Actor.current()); }
    @DeleteMapping("/settings/masters/{kind}/{id}")
    public Map<String, Object> deleteMaster(@PathVariable String kind, @PathVariable UUID id, @RequestParam UUID outletId) {
        return catalog.deleteMaster(Actor.current(), kind, id, outletId);
    }
    @DeleteMapping("/settings/branches/{id}")
    public Map<String, Object> deleteBranch(@PathVariable UUID id) { return catalog.deleteBranch(Actor.current(), id); }
    @DeleteMapping("/settings/outlets/{id}")
    public Map<String, Object> deleteOutlet(@PathVariable UUID id) { return catalog.deleteOutlet(Actor.current(), id); }
    @PatchMapping("/settings/business")
    public Map<String, Object> business(@Valid @RequestBody CatalogDtos.Business input) { return catalog.business(Actor.current(), input); }
    @PostMapping("/settings/branches")
    public Map<String, Object> branch(@Valid @RequestBody CatalogDtos.Branch input) { return catalog.branch(Actor.current(), input); }
    @PutMapping("/settings/branches/{id}")
    public Map<String, Object> updateBranch(@PathVariable UUID id, @Valid @RequestBody CatalogDtos.Branch input) { return catalog.updateBranch(Actor.current(), id, input); }
    @PutMapping("/settings/items/prices")
    public Map<String, Object> updatePrices(@Valid @RequestBody CatalogDtos.OutletPrices input) { return catalog.updatePrices(Actor.current(), input); }
    @PostMapping("/settings/outlets")
    public Map<String, Object> createOutlet(@Valid @RequestBody CatalogDtos.Outlet input) { return catalog.outlet(Actor.current(), null, input); }
    @PutMapping("/settings/outlets/{id}")
    public Map<String, Object> updateOutlet(@PathVariable UUID id, @Valid @RequestBody CatalogDtos.Outlet input) { return catalog.outlet(Actor.current(), id, input); }
    @PostMapping("/settings/users")
    public Map<String, Object> createUser(@Valid @RequestBody CatalogDtos.CreateUser input) { return catalog.createUser(Actor.current(), input); }
    @PutMapping("/settings/users/{id}")
    public Map<String, Object> updateUser(@PathVariable UUID id, @Valid @RequestBody CatalogDtos.UpdateUser input) { return catalog.updateUser(Actor.current(), id, input); }
    @PostMapping("/settings/groups")
    public Map<String, Object> createGroup(@Valid @RequestBody CatalogDtos.Group input) { return catalog.group(Actor.current(), null, input); }
    @PutMapping("/settings/groups/{id}")
    public Map<String, Object> updateGroup(@PathVariable UUID id, @Valid @RequestBody CatalogDtos.Group input) { return catalog.group(Actor.current(), id, input); }
    @PostMapping("/settings/categories")
    public Map<String, Object> createCategory(@Valid @RequestBody CatalogDtos.Category input) { return catalog.category(Actor.current(), null, input); }
    @PutMapping("/settings/categories/{id}")
    public Map<String, Object> updateCategory(@PathVariable UUID id, @Valid @RequestBody CatalogDtos.Category input) { return catalog.category(Actor.current(), id, input); }
    @PostMapping("/settings/items")
    public Map<String, Object> createItem(@Valid @RequestBody CatalogDtos.Item input) { return catalog.item(Actor.current(), null, input); }
    @PutMapping("/settings/items/{id}")
    public Map<String, Object> updateItem(@PathVariable UUID id, @Valid @RequestBody CatalogDtos.Item input) { return catalog.item(Actor.current(), id, input); }
    @PostMapping("/settings/tables")
    public Map<String, Object> createTable(@Valid @RequestBody CatalogDtos.Table input) { return catalog.table(Actor.current(), null, input); }
    @PutMapping("/settings/tables/{id}")
    public Map<String, Object> updateTable(@PathVariable UUID id, @Valid @RequestBody CatalogDtos.Table input) { return catalog.table(Actor.current(), id, input); }
    @PostMapping("/settings/printers")
    public Map<String, Object> createPrinter(@Valid @RequestBody CatalogDtos.Printer input) { return catalog.printer(Actor.current(), null, input); }
    @PutMapping("/settings/printers/{id}")
    public Map<String, Object> updatePrinter(@PathVariable UUID id, @Valid @RequestBody CatalogDtos.Printer input) { return catalog.printer(Actor.current(), id, input); }
    @DeleteMapping("/settings/branches/{branch}/printer-assignments/{printer}")
    public Map<String, Object> removeBranchPrinterAssignment(@PathVariable UUID branch, @PathVariable UUID printer) {
        return catalog.removeBranchPrinterAssignment(Actor.current(), branch, printer);
    }

    @PutMapping("/settings/branches/{branch}/windows-printer-routes")
    public Map<String, Object> branchWindowsPrinterRoutes(@PathVariable UUID branch, @Valid @RequestBody CatalogDtos.BranchWindowsRoutes input) {
        return catalog.branchWindowsPrinterRoutes(Actor.current(), branch, input);
    }

    @PutMapping("/settings/windows-printer-routes")
    public Map<String, Object> windowsPrinterRoutes(@Valid @RequestBody CatalogDtos.WindowsRoutes input) {
        return catalog.windowsPrinterRoutes(Actor.current(), input);
    }
    @DeleteMapping("/settings/outlets/{outlet}/printer-assignments/{printer}")
    public Map<String, Object> removePrinterAssignment(@PathVariable UUID outlet, @PathVariable UUID printer) {
        return catalog.removePrinterAssignment(Actor.current(), outlet, printer);
    }
    @PutMapping("/settings/routes")
    public Map<String, Object> routes(@Valid @RequestBody CatalogDtos.Routes input) { return catalog.routes(Actor.current(), input); }
}
