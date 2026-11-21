package com.restaurant.pos;

import org.junit.jupiter.api.Test;
import java.math.BigDecimal;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class OperationsMoneyTest {
    private static BigDecimal n(String value) { return new BigDecimal(value); }
    static Map<String,Object> line(UUID id,int quantity,String price,String tax) {
        Map<String,Object> line=new LinkedHashMap<>(); line.put("id",id.toString()); line.put("quantity",quantity);
        line.put("unit_price",n(price)); line.put("tax_rate",n(tax)); line.put("name","Item"); return line;
    }
    @Test void remainderAllocationIsExactAndStable() {
        assertEquals(List.of(n("0.34"),n("0.33"),n("0.33")),OperationsMoney.allocate(n("1.00"),List.of(n("1"),n("1"),n("1"))));
        assertEquals(List.of(n("0.00"),n("0.01")),OperationsMoney.allocate(n("0.01"),List.of(n("0"),n("9"))));
        assertEquals(List.of(n("0.00"),n("0.00")),OperationsMoney.allocate(n("0"),List.of(n("0"),n("0"))));
    }
    @Test void priceUsesExactDecimalsAndDiscountBeforeTax() {
        List<Map<String,Object>> priced=OperationsMoney.price(List.of(line(UUID.randomUUID(),3,"19.99","5.00")),n("0.02"));
        assertEquals(Map.of("subtotal",n("59.97"),"discount",n("0.02"),"tax",n("3.00"),"total",n("62.95")),OperationsMoney.totals(priced));
    }
    @Test void invalidMoneyAndExcessiveDiscountFailWithoutRoundingClientAmounts() {
        assertThrows(ApiException.class,() -> OperationsMoney.money(n("1.001")));
        assertThrows(ApiException.class,() -> OperationsMoney.money(n("-1")));
        assertThrows(ApiException.class,() -> OperationsMoney.money(n("10000000000")));
        assertThrows(ApiException.class,() -> OperationsMoney.price(List.of(line(UUID.randomUUID(),1,"1.00","5.00")),n("1.01")));
        assertThrows(ApiException.class,() -> OperationsMoney.allocate(n("0.01"),List.of(n("0"))));
    }
    @Test void quantitySplittingPreservesEveryOriginalCent() {
        UUID first=UUID.randomUUID(),second=UUID.randomUUID();
        List<Map<String,Object>> priced=OperationsMoney.price(List.of(line(first,3,"0.11","5.00"),line(second,2,"14.99","18.00")),n("2.03"));
        var requested=List.of(new OperationsDtos.BillGroup(List.of(new OperationsDtos.BillPart(first,1),new OperationsDtos.BillPart(second,1))),
                new OperationsDtos.BillGroup(List.of(new OperationsDtos.BillPart(first,2),new OperationsDtos.BillPart(second,1))));
        List<List<Map<String,Object>>> groups=BillingService.split(priced,requested);
        assertEquals(OperationsMoney.totals(priced),OperationsMoney.totals(groups.stream().flatMap(Collection::stream).toList()));
        assertEquals(2,groups.size());
    }
    @Test void distinctLineIdsNeverCoalesceSameMenuItemWithDifferentModifiers() {
        UUID first=UUID.randomUUID(),second=UUID.randomUUID();
        var a=line(first,1,"10.00","5.00"); a.put("modifiers",List.of(Map.of("name","Extra cheese","price",n("2.00"))));
        var b=line(second,1,"10.00","5.00"); b.put("modifiers",List.of());
        var groups=BillingService.split(OperationsMoney.price(List.of(a,b),n("0.00")),List.of(
                new OperationsDtos.BillGroup(List.of(new OperationsDtos.BillPart(first,1))),new OperationsDtos.BillGroup(List.of(new OperationsDtos.BillPart(second,1)))));
        assertNotEquals(groups.get(0).get(0).get("id"),groups.get(1).get(0).get("id"));
        assertNotEquals(groups.get(0).get(0).get("modifiers"),groups.get(1).get(0).get("modifiers"));
    }
    @Test void rejectsMissingExcessForeignAndRepeatedSplitItems() {
        UUID id=UUID.randomUUID(); var priced=OperationsMoney.price(List.of(line(id,2,"10.00","5.00")),n("0.00"));
        for(var parts:List.of(List.of(new OperationsDtos.BillPart(id,1)),List.of(new OperationsDtos.BillPart(id,3)),
                List.of(new OperationsDtos.BillPart(UUID.randomUUID(),2)),List.of(new OperationsDtos.BillPart(id,1),new OperationsDtos.BillPart(id,1))))
            assertThrows(ApiException.class,() -> BillingService.split(priced,List.of(new OperationsDtos.BillGroup(parts))));
        assertThrows(ApiException.class,() -> BillingService.split(priced,List.of()));
    }
    @Test void randomizedSplitConservesSubtotalDiscountTaxAndTotal() {
        Random random=new Random(2701);
        for(int test=0;test<500;test++) {
            UUID id=UUID.randomUUID(); int quantity=2+random.nextInt(30); BigDecimal price=BigDecimal.valueOf(random.nextInt(10000),2);
            BigDecimal subtotal=price.multiply(BigDecimal.valueOf(quantity)); BigDecimal discount=subtotal.multiply(BigDecimal.valueOf(random.nextInt(101))).divide(n("100"),2,java.math.RoundingMode.DOWN);
            var priced=OperationsMoney.price(List.of(line(id,quantity,price.toPlainString(),"18.00")),discount);
            int first=1+random.nextInt(quantity-1);
            var groups=BillingService.split(priced,List.of(new OperationsDtos.BillGroup(List.of(new OperationsDtos.BillPart(id,first))),new OperationsDtos.BillGroup(List.of(new OperationsDtos.BillPart(id,quantity-first)))));
            assertEquals(OperationsMoney.totals(priced),OperationsMoney.totals(groups.stream().flatMap(Collection::stream).toList()));
            for(var group:groups) assertTrue(OperationsMoney.amount(group.get(0).get("total")).signum()>=0);
        }
    }
}
