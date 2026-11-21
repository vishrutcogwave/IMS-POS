package com.restaurant.pos;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class OperationsPrintingSafetyTest {
    TenantJdbc db; OperationsSupport support; PrintingService service; Actor actor; UUID outlet,jobId,token,printer;
    @BeforeEach void setup() {
        db=mock(TenantJdbc.class); support=mock(OperationsSupport.class); service=new PrintingService(db,support);
        actor=new Actor(UUID.randomUUID(),UUID.randomUUID(),"KITCHEN","Agent","agent@test.invalid"); outlet=UUID.randomUUID(); jobId=UUID.randomUUID(); token=UUID.randomUUID(); printer=UUID.randomUUID();
    }
    Map<String,Object> claimedJob() {
        return new LinkedHashMap<>(Map.of("id",jobId.toString(),"outlet_id",outlet.toString(),"printer_id",printer.toString(),"claimed_by",actor.userId().toString(),"claim_token",token.toString(),"status","CLAIMED"));
    }
    @Test void acknowledgementRequiresUnforgeableTokenAndOriginalClaimant() {
        when(support.job(actor,jobId,true)).thenReturn(claimedJob());
        assertEquals(403,assertThrows(ApiException.class,() -> service.ack(actor,jobId,new OperationsDtos.Ack(UUID.randomUUID(),"PRINTED",""))).status());
        var otherOwner=claimedJob(); otherOwner.put("claimed_by",UUID.randomUUID().toString()); when(support.job(actor,jobId,true)).thenReturn(otherOwner);
        assertEquals(403,assertThrows(ApiException.class,() -> service.ack(actor,jobId,new OperationsDtos.Ack(token,"PRINTED",""))).status());
        verify(db,never()).update(anyString(),any(Object[].class));
    }
    @Test void expiredClaimCannotBeFalselyMarkedPrinted() {
        when(support.job(actor,jobId,true)).thenReturn(claimedJob());
        when(db.one(startsWith("select claimed_at"),any(Object[].class))).thenReturn(Map.of("stale",true));
        when(support.job(actor,jobId,false)).thenReturn(Map.of("status","UNCERTAIN"));
        assertEquals("UNCERTAIN",service.ack(actor,jobId,new OperationsDtos.Ack(token,"PRINTED","")).get("status"));
        verify(db).update(startsWith("update print_jobs set status=?"),eq("UNCERTAIN"),anyString(),eq(actor.tenantId()),eq(outlet),eq(jobId),eq(actor.userId()),eq(token));
    }
    @Test void claimingIsScopedToOneAssignedOutletAndEnabledAliases() {
        when(db.list(startsWith("select outlet_id from user_outlets"),any(Object[].class))).thenReturn(List.of(Map.of("outlet_id",outlet.toString())));
        when(db.list(startsWith("select device_key from printers"),any(Object[].class))).thenReturn(List.of(Map.of("device_key","kitchen")));
        when(db.list(startsWith("select j.id from print_jobs"),any(Object[].class))).thenAnswer(call -> {
            String sql=call.getArgument(0); Object[] args=(Object[])call.getRawArguments()[1];
            assertTrue(sql.contains("for update of j skip locked")); assertTrue(sql.contains("limit 1 for update"));
            assertTrue(sql.contains("j.tenant_id=?")); assertTrue(sql.contains("j.outlet_id=?")); assertTrue(sql.contains("p.device_key in (?)"));
            assertArrayEquals(new Object[]{actor.tenantId(),actor.tenantId(),outlet,"kitchen"},args); return List.of();
        });
        assertEquals(List.of(),service.claim(actor,new OperationsDtos.Claim(outlet,List.of("kitchen"))).get("jobs"));
        assertEquals(403,assertThrows(ApiException.class,() -> service.claim(actor,new OperationsDtos.Claim(outlet,List.of("other-outlet-alias")))).status());
    }
    @Test void broadAccountsCannotRunLowPrivilegePrintAgent() {
        Actor owner=new Actor(actor.tenantId(),actor.userId(),"OWNER","Owner","owner@test.invalid");
        assertEquals(403,assertThrows(ApiException.class,() -> service.claim(owner,new OperationsDtos.Claim(outlet,List.of("kitchen")))).status());
        when(db.list(startsWith("select outlet_id from user_outlets"),any(Object[].class))).thenReturn(List.of(Map.of("outlet_id",outlet.toString()),Map.of("outlet_id",UUID.randomUUID().toString())));
        assertEquals(403,assertThrows(ApiException.class,() -> service.claim(actor,new OperationsDtos.Claim(outlet,List.of("kitchen")))).status());
    }
    @Test void retriesRequireExplicitDuplicateAcknowledgementAndTerminalFailure() {
        assertEquals(422,assertThrows(ApiException.class,() -> service.retry(actor,jobId,"Try again")).status());
        when(support.job(actor,jobId,true)).thenReturn(claimedJob());
        assertEquals(409,assertThrows(ApiException.class,() -> service.retry(actor,jobId,"I acknowledge possible duplicate output")).status());
        verify(db,never()).update(anyString(),any(Object[].class));
    }
}
