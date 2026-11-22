package com.restaurant.pos;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/platform")
public class PlatformOperationsController {
    private final PlatformController platform;
    private final TenantJdbc db;
    private final PasswordEncoder passwords;

    public PlatformOperationsController(PlatformController platform, TenantJdbc db, PasswordEncoder passwords) {
        this.platform = platform;
        this.db = db;
        this.passwords = passwords;
    }

    record Contact(@NotBlank @Email @Size(max = 254) String email, @NotBlank @Size(max = 40) String phone) {}
    record Profile(@NotBlank @Size(max = 160) String name, @NotNull @Size(max = 500) String address,
                   @NotNull @Size(max = 40) String phone, @NotNull @Size(max = 80) String taxNumber) {}
    record Account(@Email @Size(max = 254) String username, Boolean active, boolean resetPassword,
                   @NotBlank @Size(max = 500) String reason) {}

    @GetMapping("/contact")
    Map<String, Object> contact(@RequestHeader(value = "Authorization", required = false) String token) {
        platform.session(token);
        return db.one("select email, phone from platform_contact where singleton");
    }

    @PutMapping("/contact")
    Map<String, Object> contact(@RequestHeader(value = "Authorization", required = false) String token,
                                @Valid @RequestBody Contact value) {
        platform.session(token);
        return db.one("""
            with updated as (
                update platform_contact set email=?, phone=? where singleton returning email, phone
            ), logged as (
                insert into platform_audit(operator_email,action,reason)
                select ?, 'CONTACT_UPDATE', 'Updated platform support details' from updated returning id
            )
            select updated.* from updated cross join logged
            """, value.email().strip(), value.phone().strip(), platform.operatorEmail());
    }

    @GetMapping("/tenants/{tenant}/profile")
    Map<String, Object> profile(@RequestHeader(value = "Authorization", required = false) String token,
                                @PathVariable UUID tenant) {
        platform.session(token);
        return db.asTenant(tenant, () -> db.one("""
            select id, name, slug, receipt_address as address, phone, tax_number, created_at,
                   (select count(*) from branches where tenant_id=t.id) as branch_count,
                   (select count(*) from outlets where tenant_id=t.id) as outlet_count,
                   (select count(*) from users where tenant_id=t.id) as user_count
            from tenants t where id=?
            """, tenant));
    }

    @PutMapping("/tenants/{tenant}/profile")
    Map<String, Object> profile(@RequestHeader(value = "Authorization", required = false) String token,
                                @PathVariable UUID tenant, @Valid @RequestBody Profile value) {
        platform.session(token);
        return db.asTenant(tenant, () -> {
            Map<String, Object> result = db.one("""
                update tenants set name=?,receipt_address=?,phone=?,tax_number=? where id=? returning id, name
                """, value.name().strip(), value.address().strip(), value.phone().strip(), value.taxNumber().strip(), tenant);
            audit(tenant, tenant, "RESTAURANT_UPDATE", "Updated restaurant profile");
            return result;
        });
    }

    @GetMapping("/tenants/{tenant}/accounts")
    List<Map<String, Object>> accounts(@RequestHeader(value = "Authorization", required = false) String token,
                                       @PathVariable UUID tenant) {
        platform.session(token);
        return db.asTenant(tenant, () -> db.list("""
            select id, email as username, name, role, active from users
            where tenant_id=? order by name, id
            """, tenant));
    }

    @PutMapping("/tenants/{tenant}/accounts/{user}")
    Map<String, Object> account(@RequestHeader(value = "Authorization", required = false) String token,
                                @PathVariable UUID tenant, @PathVariable UUID user,
                                @Valid @RequestBody Account value) {
        platform.session(token);
        boolean rename = value.username() != null;
        boolean changeStatus = value.active() != null;
        if ((rename ? 1 : 0) + (changeStatus ? 1 : 0) + (value.resetPassword() ? 1 : 0) != 1 ||
                (rename && value.username().isBlank())) {
            throw new ApiException(422, "Choose exactly one account change.");
        }
        return db.asTenant(tenant, () -> {
            db.one("select id from tenants where id=? for update", tenant);
            Map<String, Object> current = db.one("select role from users where tenant_id=? and id=? for update", tenant, user);
            if (Boolean.FALSE.equals(value.active()) && "OWNER".equals(current.get("role")) &&
                    db.list("select id from users where tenant_id=? and id<>? and role='OWNER' and active limit 1", tenant, user).isEmpty()) {
                throw new ApiException(422, "The restaurant needs at least one active owner.");
            }
            String action;
            String temporary = null;
            if (rename) {
                String username = AuthService.normalizeEmail(value.username());
                if (!db.list("select id from users where tenant_id=? and email=? and id<>?", tenant, username, user).isEmpty()) {
                    throw new ApiException(409, "That username is already in use for this restaurant.");
                }
                db.update("update users set email=? where tenant_id=? and id=?", username, tenant, user);
                action = "ACCOUNT_USERNAME";
            } else if (changeStatus) {
                db.update("update users set active=? where tenant_id=? and id=?", value.active(), tenant, user);
                action = value.active() ? "ACCOUNT_ENABLE" : "ACCOUNT_DISABLE";
            } else {
                temporary = AuthService.randomToken();
                db.update("update users set password_hash=? where tenant_id=? and id=?", passwords.encode(temporary), tenant, user);
                action = "ACCOUNT_PASSWORD_RESET";
            }
            db.update("delete from auth_sessions where tenant_id=? and user_id=?", tenant, user);
            audit(tenant, user, action, value.reason().strip());
            return temporary == null ? Map.of("ok", true) : Map.of("temporaryPassword", temporary);
        });
    }

    @GetMapping("/audit")
    List<Map<String, Object>> audit(@RequestHeader(value = "Authorization", required = false) String token,
                                    @RequestParam(required = false) UUID tenant,
                                    @RequestParam(required = false) UUID subject) {
        platform.session(token);
        return db.list("""
            with entries as (
                select 'operation-' || id as id, tenant_id, subject_id, operator_email, action, reason, changed_at
                from platform_audit
                union all
                select 'subscription-' || id, tenant_id, tenant_id, operator_email, 'SUBSCRIPTION_UPDATE', reason, changed_at
                from platform_subscription_history
            )
            select e.*, t.name as restaurant from entries e left join tenants t on t.id=e.tenant_id
            where (cast(? as uuid) is null or e.tenant_id=?) and (cast(? as uuid) is null or e.subject_id=?)
            order by e.changed_at desc, e.id desc limit 200
            """, tenant, tenant, subject, subject);
    }

    private void audit(UUID tenant, UUID subject, String action, String reason) {
        db.update("insert into platform_audit(tenant_id,subject_id,operator_email,action,reason) values (?,?,?,?,?)",
                tenant, subject, platform.operatorEmail(), action, reason);
    }
}
