package com.restaurant.pos;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import jakarta.validation.ValidatorFactory;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Supplier;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.AbstractPlatformTransactionManager;
import org.springframework.transaction.support.DefaultTransactionStatus;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class FoundationTest {
    private Actor actor(String role) { return new Actor(UUID.randomUUID(), UUID.randomUUID(), role, "Alex", "alex@example.test"); }
    @AfterEach void clearIdentity() { SecurityContextHolder.clearContext(); }

    @Test void rolesAreExplicitAndUnknownRolesFailClosed() {
        assertEquals(11, actor("OWNER").permissions().size());
        assertEquals(11, actor("MANAGER").permissions().size());
        assertTrue(actor("WAITER").can("TRANSFER"));
        assertFalse(actor("CASHIER").can("CANCEL"));
        assertFalse(actor("KITCHEN").can("ORDER"));
        assertFalse(actor("ACCOUNTANT").can("BILL"));
        assertThrows(ApiException.class, () -> actor("ADMIN").require("SETTINGS"));
    }
    @Test void currentRejectsAnonymousAndNonActorPrincipals() {
        assertThrows(ApiException.class, Actor::current);
        SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken("owner", null, List.of()));
        assertThrows(ApiException.class, Actor::current);
        Actor owner = actor("OWNER");
        SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(owner, null, List.of()));
        assertSame(owner, Actor.current());
    }
    @Test void bcryptLimitUsesUtf8BytesNotJavaCharacters() {
        assertDoesNotThrow(() -> AuthService.validatePassword("x".repeat(72)));
        assertThrows(ApiException.class, () -> AuthService.validatePassword("x".repeat(73)));
        assertDoesNotThrow(() -> AuthService.validatePassword("é".repeat(36)));
        assertThrows(ApiException.class, () -> AuthService.validatePassword("é".repeat(37)));
        assertThrows(ApiException.class, () -> AuthService.validatePassword("short"));
        assertThrows(ApiException.class, () -> AuthService.validatePassword(" ".repeat(12)));
        assertThrows(ApiException.class, () -> AuthService.validatePassword("abcde\0fghijklm"));
    }
    @Test void opaqueTokensHave256BitsAndOnlyHashesAreLookupKeys() {
        String first = AuthService.randomToken(), second = AuthService.randomToken();
        assertTrue(first.matches("[A-Za-z0-9_-]{43}"));
        assertNotEquals(first, second);
        assertTrue(AuthService.sha256(first).matches("[a-f0-9]{64}"));
        assertNotEquals(first, AuthService.sha256(first));
        assertEquals(AuthService.sha256(first), AuthService.sha256(first));
    }
    @Test void csrfComparisonRejectsMissingPrefixAndOversizedValues() {
        String csrf = AuthService.randomToken();
        assertTrue(AuthService.constantTime(csrf, csrf));
        assertFalse(AuthService.constantTime(csrf, null));
        assertFalse(AuthService.constantTime(csrf, csrf.substring(1)));
        assertFalse(AuthService.constantTime(csrf, "x".repeat(5000)));
        assertFalse(AuthService.constantTime(csrf, AuthService.randomToken()));
    }
    @Test void failedLoginCooldownIsBoundedPerKey() {
        AuthService.LoginThrottle throttle = new AuthService.LoginThrottle();
        for (int i = 0; i < 5; i++) throttle.take("restaurant:user:ip", 5);
        assertEquals(429, assertThrows(ApiException.class, () -> throttle.take("restaurant:user:ip", 5)).status());
        assertDoesNotThrow(() -> throttle.take("different:key", 5));
        throttle.clear("restaurant:user:ip");
        assertDoesNotThrow(() -> throttle.take("restaurant:user:ip", 5));
    }
    @Test void throttleRefusesGrowthBeyondCapacity() {
        AuthService.LoginThrottle throttle = new AuthService.LoginThrottle();
        for (int i = 0; i < 10000; i++) throttle.take("key:" + i, 5);
        assertEquals(429, assertThrows(ApiException.class, () -> throttle.take("overflow", 5)).status());
    }
    @Test void originComparisonNormalizesDefaultPortsButNotSiblingHosts() {
        assertEquals(SessionFilter.canonicalOrigin("https://example.test"), SessionFilter.canonicalOrigin("https://example.test:443/path"));
        assertNotEquals(SessionFilter.canonicalOrigin("https://example.test"), SessionFilter.canonicalOrigin("https://example.test.evil.test"));
        assertThrows(IllegalArgumentException.class, () -> SessionFilter.canonicalOrigin("null"));
        assertThrows(IllegalArgumentException.class, () -> SessionFilter.canonicalOrigin("https://user@example.test"));
    }

    @Test void jsonLoginIsPublicButRejectsCrossOrigin() throws Exception {
        AuthService auth = mock(AuthService.class);
        SessionFilter filter = new SessionFilter(auth, new ObjectMapper(), "http://localhost:5173");
        MockHttpServletRequest request = write("/api/auth/login");
        request.addHeader("Origin", "https://evil.test");
        MockHttpServletResponse response = new MockHttpServletResponse();
        AtomicBoolean called = new AtomicBoolean();
        filter.doFilter(request, response, (req, res) -> called.set(true));
        assertEquals(403, response.getStatus()); assertFalse(called.get());
        verifyNoInteractions(auth);
    }
    @Test void sameOriginJsonLoginNeedsNoSessionOrCsrf() throws Exception {
        AuthService auth = mock(AuthService.class);
        SessionFilter filter = new SessionFilter(auth, new ObjectMapper(), "http://localhost:5173");
        MockHttpServletRequest request = write("/api/auth/login");
        request.addHeader("Origin", "http://localhost:5173");
        MockHttpServletResponse response = new MockHttpServletResponse();
        AtomicBoolean called = new AtomicBoolean();
        filter.doFilter(request, response, (req, res) -> called.set(true));
        assertTrue(called.get()); verifyNoInteractions(auth);
    }
    @Test void contentTypeCannotBeUsedToSubmitBrowserFormLogin() throws Exception {
        SessionFilter filter = new SessionFilter(mock(AuthService.class), new ObjectMapper(), "http://localhost:5173");
        MockHttpServletRequest request = write("/api/auth/login");
        request.setContentType("application/x-www-form-urlencoded");
        MockHttpServletResponse response = new MockHttpServletResponse();
        filter.doFilter(request, response, (req, res) -> fail("Form request must not reach login"));
        assertEquals(415, response.getStatus());
    }
    @Test void writeRequiresCorrectCsrfEvenWithValidSession() throws Exception {
        AuthService auth = mock(AuthService.class); Actor owner = actor("OWNER");
        when(auth.resolve("opaque")).thenReturn(new AuthService.Session(owner, "expected", "hash"));
        SessionFilter filter = new SessionFilter(auth, new ObjectMapper(), "http://localhost:5173");
        MockHttpServletRequest request = write("/api/settings/business");
        request.setCookies(new jakarta.servlet.http.Cookie(AuthService.COOKIE, "opaque"));
        request.addHeader("X-CSRF-Token", "wrong");
        MockHttpServletResponse response = new MockHttpServletResponse();
        filter.doFilter(request, response, (req, res) -> fail("Invalid CSRF must not reach controller"));
        assertEquals(403, response.getStatus());
        assertNull(SecurityContextHolder.getContext().getAuthentication());
    }
    @Test void verifiedIdentityIsAvailableOnlyDuringFilterChain() throws Exception {
        AuthService auth = mock(AuthService.class); Actor owner = actor("OWNER");
        when(auth.resolve("opaque")).thenReturn(new AuthService.Session(owner, "expected", "hash"));
        SessionFilter filter = new SessionFilter(auth, new ObjectMapper(), "http://localhost:5173");
        MockHttpServletRequest request = write("/api/settings/business");
        request.setCookies(new jakarta.servlet.http.Cookie(AuthService.COOKIE, "opaque"));
        request.addHeader("X-CSRF-Token", "expected");
        request.addHeader("X-Tenant-Id", UUID.randomUUID().toString());
        request.addHeader("X-Role", "OWNER");
        MockHttpServletResponse response = new MockHttpServletResponse();
        filter.doFilter(request, response, (req, res) -> assertSame(owner, Actor.current()));
        assertEquals(200, response.getStatus());
        assertNull(SecurityContextHolder.getContext().getAuthentication());
        assertEquals("no-store", response.getHeader("Cache-Control"));
    }
    @Test void spoofedIdentityHeadersDoNotAuthenticate() throws Exception {
        SessionFilter filter = new SessionFilter(mock(AuthService.class), new ObjectMapper(), "http://localhost:5173");
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/auth/me");
        request.addHeader("X-Tenant-Id", UUID.randomUUID().toString()); request.addHeader("X-Role", "OWNER");
        MockHttpServletResponse response = new MockHttpServletResponse();
        filter.doFilter(request, response, (req, res) -> fail("Headers must not establish identity"));
        assertEquals(401, response.getStatus());
        assertTrue(response.getContentAsString().contains("requestId"));
    }
    private MockHttpServletRequest write(String path) {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", path);
        request.setContentType("application/json"); return request;
    }

    @Test void tenantContextIsTransactionalAndNestedSwitchingIsRejected() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        TenantJdbc db = new TenantJdbc(jdbc, new ObjectMapper(), new TestTransactions());
        UUID tenant = UUID.randomUUID();
        assertEquals("ok", db.asTenant(tenant, () -> {
            assertTrue(TransactionSynchronizationManager.isActualTransactionActive());
            assertEquals("same", db.asTenant(tenant, () -> "same"));
            assertThrows(IllegalStateException.class, () -> db.asTenant(UUID.randomUUID(), () -> "wrong"));
            return "ok";
        }));
        assertFalse(TransactionSynchronizationManager.isActualTransactionActive());
        verify(jdbc, times(1)).queryForObject("select set_config('app.tenant_id', ?, true)", String.class, tenant.toString());
        assertEquals("next", db.asTenant(UUID.randomUUID(), () -> "next"));
    }
    @Test void failedTenantWorkDoesNotLeakItsContext() {
        TenantJdbc db = new TenantJdbc(mock(JdbcTemplate.class), new ObjectMapper(), new TestTransactions());
        assertThrows(ApiException.class, () -> db.asTenant(UUID.randomUUID(), () -> { throw new ApiException(409, "Rollback"); }));
        assertFalse(TransactionSynchronizationManager.isActualTransactionActive());
        assertEquals(7, db.asTenant(UUID.randomUUID(), () -> 7));
    }
    @Test void superuserOrBypassRlsStartupFailsClosed() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForObject(contains("rolsuper"), eq(Boolean.class))).thenReturn(true);
        TenantJdbc db = new TenantJdbc(jdbc, new ObjectMapper(), new TestTransactions());
        assertThrows(IllegalStateException.class, db::verifyRuntimeRole);
    }
    @Test void rowSecurityMustBeOnEvenForRestrictedRole() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForObject(contains("rolsuper"), eq(Boolean.class))).thenReturn(false);
        when(jdbc.queryForObject("show row_security", String.class)).thenReturn("off");
        TenantJdbc db = new TenantJdbc(jdbc, new ObjectMapper(), new TestTransactions());
        assertThrows(IllegalStateException.class, db::verifyRuntimeRole);
    }
    @Test void managerCannotChangeOrganizationWideSettings() {
        TenantJdbc db = mock(TenantJdbc.class);
        CatalogService catalog = new CatalogService(db, mock(AuthService.class), mock(PasswordEncoder.class));
        assertEquals(403, assertThrows(ApiException.class, () -> catalog.business(actor("MANAGER"), new CatalogDtos.Business("Name", "", "", "", ""))).status());
        verifyNoInteractions(db);
    }
    @Test void managerCannotCreateAnOwner() {
        TenantJdbc db = mock(TenantJdbc.class);
        when(db.tx(any(), any())).thenAnswer(invocation -> ((Supplier<?>) invocation.getArgument(1)).get());
        CatalogService catalog = new CatalogService(db, mock(AuthService.class), mock(PasswordEncoder.class));
        CatalogDtos.CreateUser input = new CatalogDtos.CreateUser("Owner", "owner@example.test", "LongEnoughPassword", "OWNER", List.of());
        assertEquals(403, assertThrows(ApiException.class, () -> catalog.createUser(actor("MANAGER"), input)).status());
        verify(db, never()).update(anyString(), any(Object[].class));
    }
    @Test void duplicateOrNegativeMenuOptionsAreRejected() {
        assertThrows(ApiException.class, () -> CatalogService.options(List.of(new CatalogDtos.Option("Large", BigDecimal.TEN), new CatalogDtos.Option(" large ", BigDecimal.ONE))));
        assertThrows(ApiException.class, () -> CatalogService.options(List.of(new CatalogDtos.Option("Large", new BigDecimal("-1")))));
        assertThrows(ApiException.class, () -> CatalogService.options(List.of(new CatalogDtos.Option("Large", new BigDecimal("1.001")))));
        assertEquals("Large", CatalogService.options(List.of(new CatalogDtos.Option(" Large ", BigDecimal.TEN))).get(0).get("name"));
    }
    @Test void dtoValidationRejectsDeviceUrlsAndUnboundedCatalogInputs() {
        try (ValidatorFactory factory = Validation.buildDefaultValidatorFactory()) {
            Validator validator = factory.getValidator();
            assertFalse(validator.validate(new CatalogDtos.Printer(UUID.randomUUID(), "Printer", "http://host/exec", "KOT", 80, 1, true, true, false, "STANDARD")).isEmpty());
            assertFalse(validator.validate(new CatalogDtos.Table(UUID.randomUUID(), "T1", "Dining", 0)).isEmpty());
            assertFalse(validator.validate(new CatalogDtos.Category(UUID.randomUUID(), "x".repeat(101), "Kitchen", 0)).isEmpty());
            assertFalse(validator.validate(new CatalogDtos.Option("Choice", new BigDecimal("1.001"))).isEmpty());
        }
    }
    private static class TestTransactions extends AbstractPlatformTransactionManager {
        @Override protected Object doGetTransaction() { return new Object(); }
        @Override protected void doBegin(Object transaction, TransactionDefinition definition) {}
        @Override protected void doCommit(DefaultTransactionStatus status) {}
        @Override protected void doRollback(DefaultTransactionStatus status) {}
    }
}
