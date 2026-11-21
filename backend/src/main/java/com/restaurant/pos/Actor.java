package com.restaurant.pos;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;

/** Identity is constructed only after an opaque session has been authenticated. */
public record Actor(UUID tenantId, UUID userId, String role, String name, String email) {
    private static final List<String> ADMIN = List.of("DASHBOARD", "ORDER", "DISCOUNT", "TRANSFER",
            "KITCHEN", "BILL", "CANCEL", "REPORT", "SETTINGS", "USERS", "PRINT");
    private static final Map<String, List<String>> PERMISSIONS = Map.of(
            "OWNER", ADMIN, "MANAGER", ADMIN,
            "CASHIER", List.of("DASHBOARD", "ORDER", "BILL", "PRINT"),
            "WAITER", List.of("ORDER", "TRANSFER", "PRINT"),
            "KITCHEN", List.of("KITCHEN", "PRINT"),
            "ACCOUNTANT", List.of("DASHBOARD", "REPORT", "PRINT"));

    public static Actor current() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !authentication.isAuthenticated()
                || !(authentication.getPrincipal() instanceof Actor actor)) {
            throw new ApiException(401, "Sign in to continue.");
        }
        return actor;
    }

    public List<String> permissions() { return PERMISSIONS.getOrDefault(role, List.of()); }
    public boolean can(String permission) { return permissions().contains(permission); }
    public void require(String permission) {
        if (!can(permission)) throw new ApiException(403, "You do not have permission for this action.");
    }
}
