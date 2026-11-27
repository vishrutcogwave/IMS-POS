package com.restaurant.pos;

import org.junit.jupiter.api.Test;
import java.time.Duration;
import java.time.Instant;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class OperationsReportTest {
    @Test void localDatesAreInclusiveAndHandleDst() {
        var india=ReportService.window("2026-11-18","2026-11-18","Asia/Kolkata");
        assertEquals(Instant.parse("2026-11-17T18:30:00Z"),india.start().toInstant());
        assertEquals(Instant.parse("2026-11-18T18:30:00Z"),india.end().toInstant());
        var dst=ReportService.window("2026-03-08","2026-03-08","America/New_York");
        assertEquals(23,Duration.between(dst.start().toInstant(),dst.end().toInstant()).toHours());
    }
    @Test void rejectsInvalidAndExcessiveDateRanges() {
        assertThrows(ApiException.class,() -> ReportService.window("2026-02-30","2026-03-01","UTC"));
        assertThrows(ApiException.class,() -> ReportService.window("2026-11-19","2026-11-18","UTC"));
        assertThrows(ApiException.class,() -> ReportService.window("2010-01-01","2020-01-10","UTC"));
        assertDoesNotThrow(() -> ReportService.window("2024-01-01","2024-12-31","UTC"));
    }
    @Test void csvQuotesDataAndDefusesFormulaPrefixesIncludingLeadingControlCharacters() {
        assertEquals("\"a,\"\"b\"\"\r\nc\"",ReportService.csvCell("a,\"b\"\r\nc"));
        for(String value:List.of("=HYPERLINK(\"https://bad.invalid\")","+1","-1","@SUM(1)","  =1","\t+1","\r=1","\ufeff=1"))
            assertTrue(ReportService.csvCell(value).startsWith("\"'"));
        assertEquals("\"Regular item\"",ReportService.csvCell("Regular item"));
        assertEquals("\"\"",ReportService.csvCell(null));
    }
    @Test void reportTypeIsWhitelistedBeforeSqlAndOutletAccessRequired() {
        TenantJdbc db=mock(TenantJdbc.class); OperationsSupport support=mock(OperationsSupport.class);
        Actor a=new Actor(UUID.randomUUID(),UUID.randomUUID(),"OWNER","Owner","owner@test.invalid"); UUID outlet=UUID.randomUUID();
        when(support.outlet(a,outlet)).thenReturn(Map.of("timezone","UTC"));
        ReportService reports=new ReportService(db,support);
        assertEquals(404,assertThrows(ApiException.class,() -> reports.report(a,outlet,"daily-sales; drop table bills","2026-11-18","2026-11-18",0,25)).status());
        verify(support).outlet(a,outlet); verifyNoInteractions(db);
    }
    @Test void allReportQueriesAreTenantAndOutletScopedAndHistoricalItemReportsUseSnapshots() {
        TenantJdbc db=mock(TenantJdbc.class); OperationsSupport support=mock(OperationsSupport.class);
        Actor a=new Actor(UUID.randomUUID(),UUID.randomUUID(),"OWNER","Owner","owner@test.invalid"); UUID outlet=UUID.randomUUID();
        when(support.outlet(a,outlet)).thenReturn(Map.of("timezone","UTC"));
        when(db.one(anyString(),any(Object[].class))).thenAnswer(call -> call.<String>getArgument(0).contains("count(*) as count")?Map.of("count",0L):Map.of());
        when(db.list(anyString(),any(Object[].class))).thenAnswer(call -> {
            String sql=call.getArgument(0); Object[] args=(Object[])call.getRawArguments()[1];
            if (sql.contains("from outlets o")) {
                assertEquals(a.tenantId(), args[2]);
                assertEquals(a.role(), args[3]);
                assertEquals(a.userId(), args[4]);
                assertTrue(sql.contains("from user_outlets"));
            } else {
                assertEquals(a.tenantId(),args[0]); assertEquals(outlet,args[1]);
            }
            assertTrue(sql.contains("tenant_id=s.tenant_id")); assertTrue(sql.contains("outlet_id=s.outlet_id"));
            assertFalse(sql.contains("join menu_items")); assertFalse(sql.contains("join categories")); return List.of();
        });
        ReportService reports=new ReportService(db,support);
        for(String type:List.of("daily-sales","item-sales","category-sales","outlet-sales","payments","payment-details","kot-register","nc-kots","kot-cancellations","bill-reprints","bill-cancellations","bill-modifications","table-activity","tax-settlement")) {
            var report=reports.report(a,outlet,type,"2026-11-18","2026-11-18",0,25);
            assertEquals(0L,report.get("totalElements")); assertEquals(List.of(),report.get("rows"));
        }
    }
    @Test void oversizedExportsAreRejectedNotSilentlyTruncated() {
        TenantJdbc db=mock(TenantJdbc.class); OperationsSupport support=mock(OperationsSupport.class);
        Actor a=new Actor(UUID.randomUUID(),UUID.randomUUID(),"OWNER","Owner","owner@test.invalid"); UUID outlet=UUID.randomUUID();
        when(support.outlet(a,outlet)).thenReturn(Map.of("timezone","UTC"));
        when(db.one(startsWith("select count(*)"),any(Object[].class))).thenReturn(Map.of("count",10001L));
        assertEquals(422,assertThrows(ApiException.class,() -> new ReportService(db,support).export(a,outlet,"kot-register","2026-11-18","2026-11-18")).status());
        verify(db,never()).list(anyString(),any(Object[].class));
    }
}
