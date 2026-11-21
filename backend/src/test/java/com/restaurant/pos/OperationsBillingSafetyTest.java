package com.restaurant.pos;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import java.math.BigDecimal;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class OperationsBillingSafetyTest {
    TenantJdbc db; OperationsSupport support; PrintingService printing; BillingService service; Actor actor;
    UUID billId,orderId,outlet; Map<String,Object> bill;
    @BeforeEach void setup() {
        db=mock(TenantJdbc.class); support=mock(OperationsSupport.class); printing=mock(PrintingService.class);
        service=new BillingService(db,support,mock(OrderService.class),printing);
        actor=new Actor(UUID.randomUUID(),UUID.randomUUID(),"OWNER","Owner","owner@test.invalid"); billId=UUID.randomUUID(); orderId=UUID.randomUUID(); outlet=UUID.randomUUID();
        bill=new LinkedHashMap<>(Map.of("id",billId.toString(),"order_id",orderId.toString(),"outlet_id",outlet.toString(),"status","OPEN","version",0,"total",new BigDecimal("100.00")));
        when(support.bill(actor,billId,true)).thenReturn(bill);
        when(support.order(actor,orderId,true)).thenReturn(Map.of("id",orderId.toString(),"outlet_id",outlet.toString(),"status","BILL_PENDING"));
        when(support.outlet(actor,outlet)).thenReturn(Map.of("payment_methods",List.of("CASH","CARD","UPI")));
    }
    private OperationsDtos.Payment payment(String method,String amount,String reference) { return new OperationsDtos.Payment(method,new BigDecimal(amount),reference); }
    @Test void incorrectOrUnsupportedPaymentAllocationCannotSettle() {
        for(var payment:List.of(payment("CASH","99.99",""),payment("CASH","100.01",""),payment("CRYPTO","100.00","external"),payment("CARD","100.00",""),payment("UPI","100.00"," ")))
            assertEquals(422,assertThrows(ApiException.class,() -> service.settle(actor,billId,new OperationsDtos.Settle(0,List.of(payment),null))).status());
        verify(db,never()).update(anyString(),any(Object[].class)); verifyNoInteractions(printing);
    }
    @Test void splitTenderAndCashChangeAreValidatedIndependently() {
        var parts=List.of(payment("CASH","30.00",""),payment("UPI","70.00","txn-123"));
        assertEquals(422,assertThrows(ApiException.class,() -> service.settle(actor,billId,new OperationsDtos.Settle(0,parts,new BigDecimal("29.99")))).status());
        assertEquals(422,assertThrows(ApiException.class,() -> service.settle(actor,billId,new OperationsDtos.Settle(0,List.of(payment("UPI","100.00","txn-123")),new BigDecimal("1.00")))).status());
        verify(db,never()).update(anyString(),any(Object[].class));
    }
    @Test void missingReceiptPrinterCannotCommitSettlement() {
        when(printing.receiptPrinter(actor,outlet)).thenThrow(new ApiException(422,"Receipt printer required"));
        assertEquals(422,assertThrows(ApiException.class,() -> service.settle(actor,billId,new OperationsDtos.Settle(0,List.of(payment("CASH","100.00","")),new BigDecimal("120.00")))).status());
        verify(db,never()).update(anyString(),any(Object[].class));
    }
    @Test void paidBillsRejectSecondSettlementAndRefundFabrication() {
        bill.put("status","PAID");
        assertEquals(409,assertThrows(ApiException.class,() -> service.settle(actor,billId,new OperationsDtos.Settle(0,List.of(payment("CASH","100.00","")),null))).status());
        assertEquals(409,assertThrows(ApiException.class,() -> service.cancel(actor,billId,new OperationsDtos.Cancel(0,"Refund request"))).status());
        verify(db,never()).update(anyString(),any(Object[].class));
    }
    @Test void unpaidSiblingCannotReopenOrderAfterAnyOtherSiblingWasPaid() {
        when(db.list(startsWith("select * from bills"),any(Object[].class))).thenReturn(List.of(bill,Map.of("status","PAID")));
        assertEquals(409,assertThrows(ApiException.class,() -> service.cancel(actor,billId,new OperationsDtos.Cancel(0,"Correct split"))).status());
        verify(db,never()).update(anyString(),any(Object[].class));
    }
    @Test void splitBillCannotBeModifiedInIsolation() {
        when(db.list(startsWith("select * from bills"),any(Object[].class))).thenReturn(List.of(bill,Map.of("status","OPEN")));
        assertEquals(409,assertThrows(ApiException.class,() -> service.modify(actor,billId,new OperationsDtos.ModifyBill(0,"Discount correction",BigDecimal.ONE))).status());
        verify(db,never()).update(anyString(),any(Object[].class));
    }
}
