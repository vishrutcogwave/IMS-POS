package com.restaurant.pos;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Max;
import java.time.LocalDate;
import java.time.ZoneId;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.sql.Timestamp;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/platform")
public class PlatformController {
    private static final ZoneId SUBSCRIPTION_ZONE = ZoneId.of("Asia/Kolkata");
    private final TenantJdbc db;
    private final AuthService auth;
    private final String email;
    private final String password;
    private final AuthService.LoginThrottle throttle = new AuthService.LoginThrottle();

    public PlatformController(TenantJdbc db, AuthService auth,
                              @Value("${app.platform-admin-email:}") String email,
                              @Value("${app.platform-admin-password:}") String password) {
        this.db = db;
        this.auth = auth;
        this.email = email;
        this.password = password;
        if ((!email.isBlank() || !password.isBlank()) && (email.isBlank() || password.length() < 32)) {
            throw new IllegalStateException("Set a platform administrator email and a random password of at least 32 characters.");
        }
    }

    record Login(@NotBlank @Email @Size(max = 254) String email, @NotBlank @Size(max = 256) String password) {}
    record Provision(
            @NotBlank @Size(max=160) String businessName,
            @NotBlank @Pattern(regexp="[a-z0-9][a-z0-9-]{1,62}[a-z0-9]") String slug,
            @NotBlank @Size(max=120) String name,
            @NotBlank @Email @Size(max=254) String email,
            @NotBlank @Size(min=12,max=72) String password,
            @jakarta.validation.constraints.NotNull @Min(1) @Max(1000) Integer maxBranches,
            @jakarta.validation.constraints.NotNull @Min(1) @Max(10000) Integer maxUsers,
            LocalDate startsOn, LocalDate endsOn) {}
    record DeleteRestaurant(@NotBlank @Size(max=64) String confirmSlug) {}
    record Subscription(@NotBlank @Size(max = 80) String plan,
                        @NotBlank @Pattern(regexp = "ACTIVE|TRIAL|SUSPENDED") String status,
                        LocalDate startsOn,
                        Instant expiresAt,
                        @Min(1) @Max(1000) Integer maxBranches,
                        @Min(1) @Max(10000) Integer maxUsers,
                        @NotBlank @Size(max = 500) String reason) {}

    @PostMapping("/login")
    Map<String, String> login(@Valid @RequestBody Login credentials, HttpServletRequest request) {
        throttle.take("platform:" + request.getRemoteAddr(), 8);
        boolean passwordMatches = AuthService.constantTime(password, credentials.password());
        if (password.isBlank() || !passwordMatches || !email.equalsIgnoreCase(credentials.email())) {
            throw new ApiException(401, "Invalid platform administrator credentials.");
        }
        String token = AuthService.randomToken();
        db.update("delete from platform_sessions where expires_at<=now()");
        db.update("insert into platform_sessions(token_hash,expires_at) values (?,now()+interval '2 hours')", hash(token));
        return Map.of("token", token);
    }

    @PostMapping("/logout")
    Map<String, Boolean> logout(@RequestHeader(value = "Authorization", required = false) String authorization) {
        db.update("delete from platform_sessions where token_hash=?", session(authorization));
        return Map.of("ok", true);
    }

    @PostMapping("/tenants")
    Map<String, Object> provision(@RequestHeader(value = "Authorization", required = false) String authorization,
                                  @Valid @RequestBody Provision input) {
        session(authorization);
        if (input.startsOn() != null && input.endsOn() != null && input.endsOn().isBefore(input.startsOn())) {
            throw new ApiException(422, "Check the subscription dates.",
                    Map.of("endsOn", "The end date must be on or after the start date."));
        }
        Instant expiry = input.endsOn() == null ? null : input.endsOn().plusDays(1).atStartOfDay(SUBSCRIPTION_ZONE).toInstant();
        var owner = new AuthDtos.Onboard(input.businessName(),input.slug(),input.name(),input.email(),input.password());
        return Map.of("id", auth.provision(owner, input.maxBranches(), input.maxUsers(), input.startsOn(), expiry), "slug", input.slug());
    }

    @GetMapping("/tenants")
    List<Map<String, Object>> tenants(@RequestHeader(value = "Authorization", required = false) String authorization) {
        session(authorization);
        return db.list("""
            select id, slug, name, subscription_plan as plan, subscription_status as status,
                   subscription_expires_at as expires_at, subscription_starts_on as starts_on,
                   subscription_max_branches as max_branches, subscription_max_users as max_users, is_demo,
                   case when subscription_expires_at<=now() then 'EXPIRED'
                        when subscription_status='SUSPENDED' then 'SUSPENDED'
                        when subscription_starts_on>(now() at time zone 'Asia/Kolkata')::date then 'SCHEDULED'
                        else subscription_status end as access_status
            from tenants order by name, id
            """);
    }

    @DeleteMapping("/tenants/{id}")
    Map<String, Boolean> delete(@RequestHeader(value = "Authorization", required = false) String authorization,
                                @PathVariable UUID id, @Valid @RequestBody DeleteRestaurant input) {
        session(authorization);
        return db.asTenant(id, () -> {
            var restaurant = db.one("select slug from tenants where id=? for update", id);
            if (!restaurant.get("slug").equals(input.confirmSlug())) {
                throw new ApiException(422, "The Property ID does not match.",
                        Map.of("confirmSlug", "Enter the exact Property ID shown in the confirmation."));
            }
            // Delete dependents before their parents, under the restaurant's row security context.
            for (String table : List.of(
                    "platform_audit", "platform_subscription_history", "print_jobs", "print_pc_pairings", "print_pcs",
                    "audit_log", "request_keys", "payments", "bill_items", "bills", "kot_items", "kots",
                    "order_items", "orders", "category_routes", "printers", "restaurant_tables",
                    "menu_items", "categories", "menu_groups", "menu_units", "menu_taxes",
                    "nc_departments", "stewards", "document_counters", "branch_bill_counters",
                    "branch_printer_settings", "user_outlets", "auth_sessions", "users", "outlets", "branches")) {
                db.update("delete from " + table + " where tenant_id=?", id);
            }
            db.update("delete from tenants where id=?", id);
            return Map.of("deleted", true);
        });
    }

    @GetMapping("/tenants/{id}/history")
    List<Map<String, Object>> history(@RequestHeader(value = "Authorization", required = false) String authorization,
                                     @PathVariable UUID id) {
        session(authorization);
        return db.list("""
            select id, operator_email, reason, previous_value, new_value, changed_at
            from platform_subscription_history where tenant_id=? order by id desc limit 50
            """, id);
    }

    @PutMapping("/tenants/{id}")
    Map<String, Object> update(@RequestHeader(value = "Authorization", required = false) String authorization,
                               @PathVariable UUID id, @Valid @RequestBody Subscription value) {
        session(authorization);
        if ("TRIAL".equals(value.status()) && value.expiresAt() == null) {
            throw new ApiException(422, "Trial subscriptions require an expiry date.");
        }
        if (value.startsOn() != null && value.expiresAt() != null &&
            !value.expiresAt().isAfter(value.startsOn().atStartOfDay(SUBSCRIPTION_ZONE).toInstant())) {
            throw new ApiException(422, "Expiry must be after the subscription start.");
        }
        Timestamp expiry = value.expiresAt() == null ? null : Timestamp.from(value.expiresAt());
        return db.one("""
            with previous as materialized (
                select id, subscription_plan as plan, subscription_status as status,
                       subscription_expires_at as expires_at, subscription_starts_on as starts_on,
                       subscription_max_branches as max_branches, subscription_max_users as max_users from tenants where id=? for update
            ), changed as (
                update tenants t
                set subscription_plan=?, subscription_status=?, subscription_expires_at=?,
                    subscription_starts_on=?, subscription_max_branches=?, subscription_max_users=?
                from previous p where t.id=p.id
                returning t.id, t.subscription_plan as plan, t.subscription_status as status,
                          t.subscription_expires_at as expires_at, t.subscription_starts_on as starts_on,
                          t.subscription_max_branches as max_branches, t.subscription_max_users as max_users
            ), logged as (
                insert into platform_subscription_history(tenant_id,operator_email,reason,previous_value,new_value)
                select c.id, ?, ?, to_jsonb(p)-'id', to_jsonb(c)-'id'
                from changed c join previous p using(id)
                returning tenant_id
            )
            select c.* from changed c join logged l on l.tenant_id=c.id
            """, id, value.plan().strip(), value.status(), expiry, value.startsOn(), value.maxBranches(), value.maxUsers(), email, value.reason().strip());
    }

    String session(String authorization) {
        if (!password.isBlank() && authorization != null && authorization.matches("Bearer [A-Za-z0-9_-]{43}")) {
            String hash = hash(authorization.substring(7));
            if (!db.list("select 1 from platform_sessions where token_hash=? and expires_at>now()", hash).isEmpty()) return hash;
        }
        throw new ApiException(401, "Sign in as a platform administrator.");
    }

    String operatorEmail() { return email; }

    private String hash(String token) {
        return AuthService.sha256(email + "\n" + password + "\n" + token);
    }
}
