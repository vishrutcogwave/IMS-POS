package com.restaurant.pos;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;

/** Identity is constructed only after an opaque session has been authenticated. */
public record Actor(UUID tenantId, UUID userId, String role, String name, String email, List<String> permittedActions) {
    public Actor(UUID tenantId, UUID userId, String role, String name, String email) {
        this(tenantId, userId, role, name, email, null);
    }

    public Actor {
        permittedActions = permittedActions == null ? null : List.copyOf(permittedActions);
    }
    private static final List<String> PRINT_ADMIN = List.of("PRINT_JOBS", "PRINT_TEST", "PRINT_RETRY", "PRINT_BILL",
            "REPRINT_KOT", "REPRINT_NC_KOT", "REPRINT_BILL");
    private static final List<String> ADMIN = List.of("DASHBOARD", "ORDER", "DISCOUNT", "TRANSFER",
            "KITCHEN", "BILL", "CANCEL", "REPORT", "SETTINGS", "USERS", "PRINT");
    private static final Map<String, List<String>> PERMISSIONS = Map.of(
            "OWNER", withPrint(ADMIN), "MANAGER", withPrint(ADMIN),
            "CASHIER", List.of("DASHBOARD", "ORDER", "BILL", "PRINT", "PRINT_JOBS", "PRINT_BILL", "REPRINT_BILL"),
            "WAITER", List.of("ORDER", "TRANSFER", "PRINT", "PRINT_JOBS", "REPRINT_KOT", "REPRINT_NC_KOT"),
            "KITCHEN", List.of("KITCHEN", "PRINT", "PRINT_JOBS", "REPRINT_KOT", "REPRINT_NC_KOT"),
            "ACCOUNTANT", List.of("DASHBOARD", "REPORT", "PRINT", "PRINT_JOBS", "PRINT_TEST", "PRINT_BILL", "REPRINT_BILL"));

    private static List<String> withPrint(List<String> base) {
        var result = new java.util.ArrayList<>(base);
        result.addAll(PRINT_ADMIN);
        return List.copyOf(result);
    }

    public static Actor current() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !authentication.isAuthenticated()
                || !(authentication.getPrincipal() instanceof Actor actor)) {
            throw new ApiException(401, "Sign in to continue.");
        }
        return actor;
    }

    public static List<String> rolePermissions(String role) { return PERMISSIONS.getOrDefault(role, List.of()); }
    public List<String> permissions() {
        List<String> defaults = rolePermissions(role);
        if (permittedActions == null) return defaults;
        var result = new java.util.ArrayList<>(defaults.stream().filter(permittedActions::contains).toList());
        // PRINT is reserved for the paired local agent. It is intentionally not an
        // owner-editable permission; user-driven queue actions have specific grants.
        if (!"OWNER".equals(role) && defaults.contains("PRINT") && !result.contains("PRINT")) result.add("PRINT");
        return List.copyOf(result);
    }

    static List<String> storedPermissions(Object value) {
        return value instanceof List<?> values ? values.stream().map(String::valueOf).toList() : null;
    }
    public boolean can(String permission) { return permissions().contains(permission); }
    public void require(String permission) {
        if (!can(permission)) throw new ApiException(403, "You do not have permission for this action.");
    }
}
