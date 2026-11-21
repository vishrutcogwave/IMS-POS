package com.restaurant.pos;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.function.Supplier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

@Component
public class TenantJdbc {
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    private final TransactionTemplate transactions;
    private final ThreadLocal<UUID> context = new ThreadLocal<>();

    public TenantJdbc(JdbcTemplate jdbc, ObjectMapper mapper, PlatformTransactionManager manager) {
        this.jdbc = jdbc; this.mapper = mapper; this.transactions = new TransactionTemplate(manager);
        this.transactions.setTimeout(30);
    }

    @PostConstruct
    void verifyRuntimeRole() {
        Boolean unsafe = jdbc.queryForObject("select coalesce(bool_or(rolsuper or rolbypassrls), true) from pg_roles where rolname in (current_user, session_user)", Boolean.class);
        if (!Boolean.FALSE.equals(unsafe)) {
            throw new IllegalStateException("Runtime database role must not be superuser or BYPASSRLS. Use a separate restricted application role.");
        }
        if (!"on".equals(jdbc.queryForObject("show row_security", String.class))) {
            throw new IllegalStateException("PostgreSQL row_security must be enabled.");
        }
    }

    public JdbcTemplate jdbc() { return jdbc; }
    public <T> T tx(Actor a, Supplier<T> work) { return asTenant(a.tenantId(), work); }
    public <T> T asTenant(UUID id, Supplier<T> work) {
        Objects.requireNonNull(id, "Tenant required");
        UUID existing = context.get();
        if (existing != null) {
            if (!existing.equals(id)) throw new IllegalStateException("Cannot switch tenant within a transaction.");
            if (!TransactionSynchronizationManager.isActualTransactionActive()) throw new IllegalStateException("Tenant context without transaction.");
            return work.get();
        }
        if (TransactionSynchronizationManager.isActualTransactionActive()) {
            throw new IllegalStateException("Tenant transaction must be entered before any other transaction.");
        }
        return transactions.execute(status -> {
            context.set(id);
            try {
                jdbc.queryForObject("select set_config('app.tenant_id', ?, true)", String.class, id.toString());
                return work.get();
            } finally { context.remove(); }
        });
    }

    public List<Map<String, Object>> list(String sql, Object... args) {
        return jdbc.query(sql, (rs, row) -> row(rs), args);
    }
    public Map<String, Object> one(String sql, Object... args) {
        List<Map<String, Object>> rows = list(sql, args);
        if (rows.isEmpty()) throw new ApiException(404, "Resource not found.");
        if (rows.size() != 1) throw new IllegalStateException("Expected one row.");
        return rows.get(0);
    }
    public int update(String sql, Object... args) { return jdbc.update(sql, args); }
    public String json(Object value) {
        try { return mapper.writeValueAsString(value); }
        catch (JsonProcessingException ex) { throw new IllegalArgumentException("Invalid JSON value."); }
    }

    private Map<String, Object> row(ResultSet rs) throws SQLException {
        Map<String, Object> row = new LinkedHashMap<>();
        for (int i = 1; i <= rs.getMetaData().getColumnCount(); i++) {
            String type = rs.getMetaData().getColumnTypeName(i);
            Object value;
            if ("jsonb".equals(type) || "json".equals(type)) {
                String raw = rs.getString(i);
                try { value = raw == null ? null : mapper.readValue(raw, Object.class); }
                catch (JsonProcessingException ex) { throw new SQLException("Invalid stored JSON", ex); }
            } else { value = normalize(rs.getObject(i)); }
            row.put(rs.getMetaData().getColumnLabel(i), value);
        }
        return row;
    }
    private Object normalize(Object value) throws SQLException {
        if (value instanceof UUID id) return id.toString();
        if (value instanceof Timestamp time) return time.toInstant().toString();
        if (value instanceof OffsetDateTime time) return time.toInstant().toString();
        if (value instanceof java.sql.Date date) return date.toLocalDate().toString();
        if (value instanceof java.sql.Array array) {
            try {
                Object raw = array.getArray();
                List<Object> result = new ArrayList<>();
                for (int i = 0; i < java.lang.reflect.Array.getLength(raw); i++) result.add(normalize(java.lang.reflect.Array.get(raw, i)));
                return result;
            } finally { array.free(); }
        }
        return value;
    }

    public void outlet(Actor a, UUID outletId) {
        if (!a.tenantId().equals(context.get())) throw new IllegalStateException("Outlet checks require a tenant transaction.");
        // Serialize outlet configuration with operational writes to prevent routing/setup races.
        jdbc.queryForList("select pg_advisory_xact_lock(hashtextextended(?,0))", a.tenantId() + ":operations:" + outletId);
        one("select o.id from outlets o where o.tenant_id=? and o.id=? and (?='OWNER' or exists (select 1 from user_outlets u where u.tenant_id=o.tenant_id and u.user_id=? and u.outlet_id=o.id))",
                a.tenantId(), outletId, a.role(), a.userId());
    }
    public void audit(Actor a, UUID outletId, String action, String entityType, UUID entityId, String reason, Object details) {
        if (!a.tenantId().equals(context.get())) throw new IllegalStateException("Audit requires a tenant transaction.");
        if (outletId != null) outlet(a, outletId);
        update("insert into audit_log(id,tenant_id,outlet_id,user_id,action,entity_type,entity_id,reason,details) values (?,?,?,?,?,?,?,?,?::jsonb)",
                UUID.randomUUID(), a.tenantId(), outletId, a.userId(), action, entityType, entityId,
                reason == null ? "" : reason, json(details == null ? Map.of() : details));
    }
}
