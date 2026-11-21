package com.restaurant.pos;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import java.math.BigDecimal;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class OperationsOrderSafetyTest {
    TenantJdbc db; OperationsSupport support; PrintingService printing; OrderService service;
    Actor actor; UUID orderId,outlet,lineId,category; Map<String,Object> order;
    @BeforeEach void setup() {
        db=mock(TenantJdbc.class); support=mock(OperationsSupport.class); printing=mock(PrintingService.class); service=new OrderService(db,support,printing);
        actor=new Actor(UUID.randomUUID(),UUID.randomUUID(),"OWNER","Owner","owner@test.invalid"); orderId=UUID.randomUUID(); outlet=UUID.randomUUID(); lineId=UUID.randomUUID(); category=UUID.randomUUID();
        order=new LinkedHashMap<>(Map.of("id",orderId.toString(),"outlet_id",outlet.toString(),"version",3,"status","OPEN","discount",BigDecimal.ZERO));
        when(support.order(actor,orderId,true)).thenReturn(order);
    }
    Map<String,Object> line(UUID id,UUID category,int sent) {
        Map<String,Object> line=OperationsMoneyTest.line(id,2,"25.00","5.00"); line.put("category_id",category.toString()); line.put("sent_quantity",sent); line.put("cancelled",false); return line;
    }
    @Test void routingFailureNeverWritesPartialKotOrSentQuantities() {
        UUID secondCategory=UUID.randomUUID(); var first=line(lineId,category,0); var second=line(UUID.randomUUID(),secondCategory,0);
        when(support.lines(actor,order,true)).thenReturn(List.of(first,second));
        when(printing.route(actor,outlet,category)).thenReturn(Map.of("id",UUID.randomUUID().toString()));
        when(support.snapshot(actor,outlet,first)).thenReturn(first);
        when(printing.route(actor,outlet,secondCategory)).thenReturn(null);
        assertEquals(422,assertThrows(ApiException.class,() -> service.send(actor,orderId,new OperationsDtos.Version(3))).status());
        verify(db,never()).update(anyString(),any(Object[].class)); verify(support,never()).number(any(),any(),anyString());
        verify(printing,never()).enqueue(any(),any(),any(),anyString(),any(),any(),any());
    }
    @Test void staleVersionsRejectBeforeMenuOrLineChanges() {
        assertEquals(409,assertThrows(ApiException.class,() -> service.editItem(actor,orderId,lineId,new OperationsDtos.EditItem(2,3,""))).status());
        verify(support,never()).line(any(),anyMap(),any()); verify(db,never()).update(anyString(),any(Object[].class));
    }
    @Test void sentLinesCannotBeEditedOrCancelledIndividually() {
        when(support.line(actor,order,lineId)).thenReturn(line(lineId,category,2));
        assertEquals(409,assertThrows(ApiException.class,() -> service.editItem(actor,orderId,lineId,new OperationsDtos.EditItem(3,3,""))).status());
        assertEquals(409,assertThrows(ApiException.class,() -> service.cancelItem(actor,orderId,lineId,new OperationsDtos.Cancel(3,"Guest changed mind"))).status());
        verify(db,never()).update(anyString(),any(Object[].class));
    }
    @Test void sentPartialLineCannotSilentlyGenerateDeltaTicket() {
        when(support.lines(actor,order,true)).thenReturn(List.of(line(lineId,category,1)));
        assertEquals(409,assertThrows(ApiException.class,() -> service.send(actor,orderId,new OperationsDtos.Version(3))).status());
        verify(db,never()).update(anyString(),any(Object[].class));
    }
    @Test void billPendingOrderCannotChangeCart() {
        order.put("status","BILL_PENDING");
        assertEquals(409,assertThrows(ApiException.class,() -> service.add(actor,orderId,new OperationsDtos.AddItem(3,UUID.randomUUID(),1,"",List.of(),""))).status());
        verify(support,never()).menu(any(),any(),any()); verify(db,never()).update(anyString(),any(Object[].class));
    }
    @Test void duplicateOrUnknownModifiersRejectWithoutWriting() {
        UUID menuId=UUID.randomUUID();
        when(support.menu(actor,outlet,menuId)).thenReturn(Map.of("id",menuId.toString(),"available",true,"price",new BigDecimal("10.00"),"variants",List.of(),"modifiers",List.of(Map.of("name","Extra","price",new BigDecimal("2.00")))));
        for(List<String> modifiers:List.of(List.of("Extra","Extra"),List.of("Unknown")))
            assertEquals(422,assertThrows(ApiException.class,() -> service.add(actor,orderId,new OperationsDtos.AddItem(3,menuId,1,"",modifiers,""))).status());
        verify(db,never()).update(anyString(),any(Object[].class));
    }
    @Test void changedDiscountRequiresPermissionButSameDiscountDoesNot() {
        Actor cashier=new Actor(actor.tenantId(),actor.userId(),"CASHIER","Cashier","cashier@test.invalid");
        when(support.order(cashier,orderId,true)).thenReturn(order);
        assertEquals(403,assertThrows(ApiException.class,() -> service.edit(cashier,orderId,new OperationsDtos.EditOrder(3,null,null,new BigDecimal("1.00")))).status());
        verify(db,never()).update(anyString(),any(Object[].class));
    }
}
