package com.restaurant.pos;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import java.math.BigDecimal;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Supplier;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class OperationsIdempotencyTest {
    private TenantJdbc db;
    private OperationsIdempotency keys;
    private Actor actor;
    @BeforeEach void setUp() {
        db=mock(TenantJdbc.class); actor=new Actor(UUID.randomUUID(),UUID.randomUUID(),"OWNER","Owner","owner@test.invalid");
        keys=new OperationsIdempotency(db,new ObjectMapper()); when(db.jdbc()).thenReturn(mock(JdbcTemplate.class));
        when(db.tx(eq(actor),any())).thenAnswer(call -> ((Supplier<?>)call.getArgument(1)).get());
    }
    @Test void stableHashSortsObjectKeysNormalizesNumbersAndIncludesEndpoint() {
        Map<String,Object> left=new LinkedHashMap<>(); left.put("b",List.of(Map.of("quantity",1))); left.put("a",new BigDecimal("1.00"));
        Map<String,Object> right=new LinkedHashMap<>(); right.put("a",1); right.put("b",List.of(Map.of("quantity",1)));
        assertEquals(keys.hash("POST /orders",left),keys.hash("POST /orders",right));
        assertNotEquals(keys.hash("POST /orders",left),keys.hash("POST /bills",left));
        assertNotEquals(keys.hash("POST /orders",left),keys.hash("POST /orders",Map.of("a",2,"b",List.of(Map.of("quantity",1)))));
    }
    @Test void exactSavedResponseIsReplayedWithoutSideEffectsAndAccessRechecked() {
        String key=UUID.randomUUID().toString(),endpoint="POST /orders/abc/send"; Map<String,Object> body=Map.of("version",1);
        Map<String,Object> response=Map.of("version",2,"total",new BigDecimal("14.00"));
        when(db.list(startsWith("select operation,request_hash,response"),any(Object[].class)))
                .thenReturn(List.of(Map.of("operation",endpoint,"request_hash",keys.hash(endpoint,body),"response",response)));
        AtomicInteger access=new AtomicInteger();
        Object result=keys.execute(actor,key,endpoint,body,true,access::incrementAndGet,() -> { fail("Replay must not repeat writes"); return null; });
        assertSame(response,result); assertEquals(1,access.get()); verify(db,never()).update(anyString(),any(Object[].class));
        verify(db.jdbc()).queryForList(contains("pg_advisory_xact_lock"),any(Object[].class));
    }
    @Test void reusedKeyWithChangedRequestIsAConflict() {
        String endpoint="POST /orders/abc/send";
        when(db.list(startsWith("select operation,request_hash,response"),any(Object[].class)))
                .thenReturn(List.of(Map.of("operation",endpoint,"request_hash",keys.hash(endpoint,Map.of("version",1)),"response",Map.of())));
        ApiException error=assertThrows(ApiException.class,() -> keys.execute(actor,UUID.randomUUID().toString(),endpoint,Map.of("version",2),true,() -> {},() -> Map.of()));
        assertEquals(409,error.status()); verify(db,never()).update(anyString(),any(Object[].class));
    }
    @Test void firstResponseUsesPersistedNormalization() {
        Object normalized=Map.of("total",14.0);
        when(db.one(startsWith("select response from request_keys"),any(Object[].class))).thenReturn(Map.of("response",normalized));
        when(db.json(any())).thenReturn("{\"total\":14.00}");
        Object result=keys.execute(actor,UUID.randomUUID().toString(),"POST /bill",Map.of(),true,() -> {},() -> Map.of("total",new BigDecimal("14.00")));
        assertSame(normalized,result); verify(db).update(startsWith("insert into request_keys"),any(Object[].class));
    }
    @Test void malformedMissingKeysAndRevokedOutletNeverRunWork() {
        assertEquals(400,assertThrows(ApiException.class,() -> keys.execute(actor,null,"POST /send",Map.of(),true,() -> {},() -> Map.of())).status());
        assertThrows(ApiException.class,() -> keys.execute(actor,"not-a-uuid","POST /send",Map.of(),true,() -> {},() -> Map.of()));
        AtomicInteger work=new AtomicInteger();
        assertThrows(ApiException.class,() -> keys.execute(actor,UUID.randomUUID().toString(),"POST /send",Map.of(),true,() -> {throw new ApiException(404,"Outlet revoked");},work::incrementAndGet));
        assertEquals(0,work.get());
    }
}
