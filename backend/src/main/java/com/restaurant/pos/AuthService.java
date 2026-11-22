package com.restaurant.pos;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseCookie;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

@Service
public class AuthService {
    public static final String COOKIE = "hearth_session";
    private static final Duration LIFETIME = Duration.ofHours(12);
    private static final SecureRandom RANDOM = new SecureRandom();
    private final TenantJdbc db;
    private final PasswordEncoder passwords;
    private final String onboardingKey;
    private final boolean secureCookies;
    private final Duration inactivity;
    private final String dummyHash;
    private final LoginThrottle throttle = new LoginThrottle();

    public AuthService(TenantJdbc db, PasswordEncoder passwords,
            @Value("${app.onboarding-key:}") String onboardingKey,
            @Value("${app.cookie-secure:true}") boolean secureCookies,
            @Value("${app.session-idle-minutes:30}") long idleMinutes) {
        this.db = db; this.passwords = passwords; this.onboardingKey = onboardingKey;
        this.secureCookies = secureCookies;
        if (!onboardingKey.isEmpty() && onboardingKey.getBytes(StandardCharsets.UTF_8).length < 32) {
            throw new IllegalStateException("APP_ONBOARDING_KEY must contain at least 32 bytes when enabled.");
        }
        if (idleMinutes < 5 || idleMinutes > 720) throw new IllegalStateException("Session idle timeout must be between 5 and 720 minutes.");
        this.inactivity = Duration.ofMinutes(idleMinutes);
        this.dummyHash = passwords.encode(randomToken());
    }

    public record Session(Actor actor, String csrfToken, String tokenHash) {}
    public record LoginResult(Map<String, Object> body, String cookie) {}

    public LoginResult login(AuthDtos.Login input, String ip) {
        String email = normalizeEmail(input.email());
        String key = sha256(ip + "\n" + input.tenantSlug() + "\n" + email);
        throttle.take("ip:" + sha256(ip), 100);
        throttle.take("identity:" + key, 5);
        if (!passwordLength(input.password(), 1)) throw invalidLogin();
        List<Map<String, Object>> tenants = db.list("select id from tenants where slug=?", input.tenantSlug());
        if (tenants.isEmpty()) { passwords.matches(input.password(), dummyHash); throw invalidLogin(); }
        UUID tenant = UUID.fromString(tenants.get(0).get("id").toString());
        LoginResult result = db.asTenant(tenant, () -> {
            List<Map<String, Object>> users = db.list("select id,name,email,role,password_hash,active,permitted_actions from users where tenant_id=? and email=? for update", tenant, email);
            Map<String, Object> user = users.isEmpty() ? null : users.get(0);
            boolean matches = passwords.matches(input.password(), user == null ? dummyHash : user.get("password_hash").toString());
            if (user == null || !matches || !Boolean.TRUE.equals(user.get("active"))) throw invalidLogin();
            requireSubscription(tenant);
            UUID userId = UUID.fromString(user.get("id").toString());
            Actor actor = new Actor(tenant, userId, user.get("role").toString(), user.get("name").toString(), email, Actor.storedPermissions(user.get("permitted_actions")));
            String token = randomToken(), csrf = randomToken();
            Instant now = Instant.now();
            db.update("delete from auth_sessions where tenant_id=? and user_id=? and (expires_at<=? or created_at<=?)",
                    tenant, userId, Timestamp.from(now), Timestamp.from(now.minus(LIFETIME)));
            // Bound concurrent sessions per user without affecting another tenant.
            db.update("delete from auth_sessions where tenant_id=? and user_id=? and id in (select id from auth_sessions where tenant_id=? and user_id=? order by created_at desc offset 9)", tenant, userId, tenant, userId);
            db.update("insert into auth_sessions(id,tenant_id,user_id,token_hash,csrf_token,expires_at) values (?,?,?,?,?,?)",
                    UUID.randomUUID(), tenant, userId, sha256(token), csrf, Timestamp.from(now.plus(inactivity)));
            return new LoginResult(envelope(actor, csrf), sessionCookie(token, LIFETIME));
        });
        throttle.clear("identity:" + key);
        return result;
    }

    public Session resolve(String token) {
        if (token == null || !token.matches("[A-Za-z0-9_-]{43}")) return null;
        String hash = sha256(token);
        // The only unauthenticated session lookup is by the hash of an opaque 256-bit token.
        List<Map<String, Object>> sessions = db.list("select tenant_id,user_id,csrf_token from auth_sessions where token_hash=? and expires_at>now() and created_at>now()-interval '12 hours'", hash);
        if (sessions.isEmpty()) return null;
        Map<String, Object> session = sessions.get(0);
        UUID tenant = UUID.fromString(session.get("tenant_id").toString());
        UUID user = UUID.fromString(session.get("user_id").toString());
        return db.asTenant(tenant, () -> {
            List<Map<String, Object>> users = db.list("select name,email,role,permitted_actions from users where tenant_id=? and id=? and active=true", tenant, user);
            if (users.isEmpty()) {
                db.update("delete from auth_sessions where token_hash=? and tenant_id=? and user_id=?", hash, tenant, user);
                return null;
            }
            requireSubscription(tenant);
            int renewed = db.update("update auth_sessions set expires_at=least(created_at+interval '12 hours', now()+(? * interval '1 minute')) where token_hash=? and tenant_id=? and user_id=? and expires_at>now() and created_at>now()-interval '12 hours'",
                    inactivity.toMinutes(), hash, tenant, user);
            if (renewed != 1) return null;
            Map<String, Object> details = users.get(0);
            return new Session(new Actor(tenant, user, details.get("role").toString(), details.get("name").toString(), details.get("email").toString(), Actor.storedPermissions(details.get("permitted_actions"))), session.get("csrf_token").toString(), hash);
        });
    }

    private void requireSubscription(UUID tenant) {
        if (!db.list("""
                select id from tenants where id=? and
                (subscription_status='SUSPENDED' or subscription_expires_at<=now()
                 or subscription_starts_on>(now() at time zone 'UTC')::date)
                """, tenant).isEmpty()) {
            throw new ApiException(403, "This restaurant subscription is currently unavailable. Contact your platform administrator.");
        }
    }

    public Map<String, Object> envelope(Actor actor, String csrf) {
        return db.tx(actor, () -> {
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("user", Map.of("id", actor.userId(), "name", actor.name(), "email", actor.email(), "role", actor.role(), "permissions", actor.permissions()));
            result.put("tenant", db.one("select id,slug,name,receipt_address,tax_number,phone,receipt_footer from tenants where id=?", actor.tenantId()));
            result.put("outlets", accessibleOutlets(actor));
            result.put("csrfToken", csrf);
            return result;
        });
    }

    public List<Map<String, Object>> accessibleOutlets(Actor actor) {
        return db.list("select o.*,b.name as branch_name from outlets o join branches b on b.tenant_id=o.tenant_id and b.id=o.branch_id where o.tenant_id=? and (?='OWNER' or exists (select 1 from user_outlets u where u.tenant_id=o.tenant_id and u.outlet_id=o.id and u.user_id=?)) order by b.name,o.name",
                actor.tenantId(), actor.role(), actor.userId());
    }
    public void logout(Actor actor, String hash) {
        db.tx(actor, () -> db.update("delete from auth_sessions where token_hash=? and tenant_id=? and user_id=?", hash, actor.tenantId(), actor.userId()));
    }
    public void profile(Actor actor, AuthDtos.Profile input) {
        db.tx(actor, () -> {
            db.update("update users set name=? where tenant_id=? and id=?", input.name().strip(), actor.tenantId(), actor.userId());
            db.audit(actor, null, "PROFILE_UPDATE", "USER", actor.userId(), "", Map.of());
            return null;
        });
    }
    public void password(Actor actor, AuthDtos.Password input) {
        validatePassword(input.newPassword());
        if (!passwordLength(input.currentPassword(), 1)) throw new ApiException(400, "Current password is incorrect.");
        db.tx(actor, () -> {
            Map<String, Object> user = db.one("select password_hash from users where tenant_id=? and id=? for update", actor.tenantId(), actor.userId());
            if (!passwords.matches(input.currentPassword(), user.get("password_hash").toString())) throw new ApiException(400, "Current password is incorrect.");
            db.update("update users set password_hash=? where tenant_id=? and id=?", passwords.encode(input.newPassword()), actor.tenantId(), actor.userId());
            revoke(actor.tenantId(), actor.userId());
            db.audit(actor, null, "PASSWORD_CHANGE", "USER", actor.userId(), "All sessions revoked", Map.of());
            return null;
        });
    }
    public void revoke(UUID tenant, UUID user) {
        db.update("delete from auth_sessions where tenant_id=? and user_id=?", tenant, user);
    }
    public Map<String, Object> onboard(AuthDtos.Onboard input, String suppliedKey, String ip) {
        throttle.take("onboard:" + sha256(ip), 20);
        if (onboardingKey.isEmpty() || !constantTime(onboardingKey, suppliedKey)) throw new ApiException(403, "Onboarding is not authorized.");
        provision(input);
        return Map.of("slug", input.slug());
    }

    /** Internal bootstrap, deliberately not exposed as an unauthenticated tenant switch. */
    UUID provision(AuthDtos.Onboard input) {
        return provision(input, null, null);
    }

    UUID provision(AuthDtos.Onboard input, Integer maxBranches, Integer maxUsers) {
        if (!passwordLength(input.password(), 12)) {
            throw new ApiException(400, "Check the password and try again.",
                    Map.of("password", "Use at least 12 characters and no more than 72 UTF-8 bytes. Accented letters and emoji may use several bytes."));
        }
        UUID tenant = UUID.randomUUID(), owner = UUID.randomUUID(), branch = UUID.randomUUID(), outlet = UUID.randomUUID();
        String passwordHash = passwords.encode(input.password());
        return db.asTenant(tenant, () -> {
            if (db.update("insert into tenants(id,slug,name,subscription_max_branches,subscription_max_users) values (?,?,?,?,?) on conflict (slug) do nothing",
                    tenant, input.slug(), input.businessName().strip(), maxBranches, maxUsers) == 0) {
                throw new ApiException(409, "This Property ID is already in use.",
                        Map.of("slug", "Choose a different Property ID."));
            }
            db.update("insert into branches(id,tenant_id,name) values (?,?,?)", branch, tenant, "Main branch");
            String outletName = input.businessName().strip();
            if (outletName.length() > 110) outletName = outletName.substring(0, 110);
            db.update("insert into outlets(id,tenant_id,branch_id,name) values (?,?,?,?)", outlet, tenant, branch, outletName + " Dining");
            db.update("insert into users(id,tenant_id,email,name,password_hash,role) values (?,?,?,?,?,'OWNER')", owner, tenant, normalizeEmail(input.email()), input.name().strip(), passwordHash);
            db.update("insert into user_outlets(tenant_id,user_id,outlet_id) values (?,?,?)", tenant, owner, outlet);
            Actor actor = new Actor(tenant, owner, "OWNER", input.name().strip(), normalizeEmail(input.email()));
            db.audit(actor, outlet, "TENANT_ONBOARD", "TENANT", tenant, "", Map.of("slug", input.slug()));
            return tenant;
        });
    }

    public String clearCookie() { return sessionCookie("", Duration.ZERO); }
    private String sessionCookie(String value, Duration age) {
        return ResponseCookie.from(COOKIE, value).httpOnly(true).secure(secureCookies)
                .sameSite("Strict").path("/api").maxAge(age).build().toString();
    }
    public static String normalizeEmail(String value) { return value.strip().toLowerCase(Locale.ROOT); }
    public static void validatePassword(String password) {
        if (!passwordLength(password, 12)) throw new ApiException(400, "Password must contain at least 12 characters and at most 72 UTF-8 bytes.");
    }
    static boolean passwordLength(String password, int minimum) {
        return password != null && password.codePointCount(0, password.length()) >= minimum
                && password.getBytes(StandardCharsets.UTF_8).length <= 72 && !password.isBlank() && password.indexOf('\0') < 0;
    }
    static String randomToken() {
        byte[] bytes = new byte[32]; RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }
    static String sha256(String value) { return HexFormat.of().formatHex(digest(value)); }
    private static byte[] digest(String value) {
        try { return MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)); }
        catch (NoSuchAlgorithmException ex) { throw new IllegalStateException(ex); }
    }
    public static boolean constantTime(String expected, String supplied) {
        if (expected == null || supplied == null || supplied.length() > 4096) return false;
        return MessageDigest.isEqual(digest(expected), digest(supplied));
    }
    private ApiException invalidLogin() { return new ApiException(401, "Invalid restaurant, email or password."); }

    /** Fixed-size, process-local cooldown. No passwords or unbounded client strings are retained. */
    static final class LoginThrottle {
        private record Attempt(int count, long until) {}
        private final Map<String, Attempt> entries = new HashMap<>();
        synchronized void take(String key, int limit) {
            long now = System.currentTimeMillis();
            Attempt attempt = entries.get(key);
            if (attempt != null && attempt.until <= now) { entries.remove(key); attempt = null; }
            if (attempt == null) {
                if (entries.size() >= 10000) entries.entrySet().removeIf(entry -> entry.getValue().until <= now);
                if (entries.size() >= 10000) throw new ApiException(429, "Too many sign-in attempts. Try again in 15 minutes.");
                attempt = new Attempt(0, now + Duration.ofMinutes(15).toMillis());
            }
            if (attempt.count >= limit) throw new ApiException(429, "Too many sign-in attempts. Try again in 15 minutes.");
            entries.put(key, new Attempt(attempt.count + 1, attempt.until));
        }
        synchronized void clear(String key) { entries.remove(key); }
    }
}
