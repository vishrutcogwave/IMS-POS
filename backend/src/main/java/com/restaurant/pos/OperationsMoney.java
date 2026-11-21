package com.restaurant.pos;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.math.RoundingMode;
import java.util.*;

/** All monetary rounding and remainder decisions are made once, before snapshot persistence. */
final class OperationsMoney {
    static final BigDecimal ZERO = new BigDecimal("0.00");
    private OperationsMoney() {}

    static BigDecimal amount(Object value) {
        return value == null ? ZERO : new BigDecimal(value.toString()).setScale(2, RoundingMode.UNNECESSARY);
    }
    static BigDecimal money(BigDecimal value) {
        if (value == null || value.signum() < 0 || value.compareTo(new BigDecimal("9999999999.99")) > 0)
            throw new ApiException(422, "Monetary amount is outside the supported range");
        try { return value.setScale(2, RoundingMode.UNNECESSARY); }
        catch (ArithmeticException ex) { throw new ApiException(422, "Monetary amounts must have at most two decimal places"); }
    }
    static BigDecimal tax(BigDecimal net, BigDecimal rate) {
        return net.multiply(rate).divide(new BigDecimal("100"), 2, RoundingMode.HALF_UP);
    }
    /** Largest-remainder allocation, with input order as the deterministic tie breaker. */
    static List<BigDecimal> allocate(BigDecimal total, List<BigDecimal> weights) {
        BigInteger cents = money(total).movePointRight(2).toBigIntegerExact();
        List<BigInteger> units = weights.stream().map(OperationsMoney::money).map(v -> v.movePointRight(2).toBigIntegerExact()).toList();
        BigInteger sum = units.stream().reduce(BigInteger.ZERO, BigInteger::add);
        if (sum.signum() == 0) {
            if (cents.signum() != 0) throw new ApiException(422, "Cannot allocate a discount against a zero subtotal");
            return new ArrayList<>(Collections.nCopies(weights.size(), ZERO));
        }
        List<BigInteger> shares = new ArrayList<>();
        List<BigInteger> remainders = new ArrayList<>();
        BigInteger assigned = BigInteger.ZERO;
        for (BigInteger unit : units) {
            BigInteger[] division = cents.multiply(unit).divideAndRemainder(sum);
            shares.add(division[0]); remainders.add(division[1]); assigned = assigned.add(division[0]);
        }
        List<Integer> order = new ArrayList<>();
        for (int i=0; i<weights.size(); i++) order.add(i);
        order.sort((a,b) -> { int c = remainders.get(b).compareTo(remainders.get(a)); return c != 0 ? c : Integer.compare(a,b); });
        int left = cents.subtract(assigned).intValueExact();
        for (int i=0; i<left; i++) { int index=order.get(i); shares.set(index, shares.get(index).add(BigInteger.ONE)); }
        return shares.stream().map(v -> new BigDecimal(v,2)).toList();
    }

    static List<Map<String,Object>> price(List<Map<String,Object>> lines, BigDecimal discount) {
        List<BigDecimal> bases = lines.stream().map(line -> amount(line.get("unit_price")).multiply(new BigDecimal(line.get("quantity").toString()))).toList();
        BigDecimal subtotal = bases.stream().reduce(ZERO, BigDecimal::add);
        if (money(discount).compareTo(subtotal) > 0) throw new ApiException(422, "Discount exceeds active item subtotal");
        List<BigDecimal> discounts=allocate(discount,bases);
        List<Map<String,Object>> result=new ArrayList<>();
        for (int i=0;i<lines.size();i++) {
            Map<String,Object> line=new LinkedHashMap<>(lines.get(i));
            BigDecimal base=bases.get(i), off=discounts.get(i), tax=tax(base.subtract(off),amount(line.get("tax_rate")));
            line.put("subtotal",base); line.put("discount",off); line.put("tax",tax); line.put("total",money(base.subtract(off).add(tax)));
            result.add(line);
        }
        return result;
    }

    static Map<String,Object> totals(List<Map<String,Object>> lines) {
        Map<String,Object> result=new LinkedHashMap<>();
        for(String key:List.of("subtotal","discount","tax","total")) {
            result.put(key,money(lines.stream().map(line -> amount(line.get(key))).reduce(ZERO,BigDecimal::add)));
        }
        return result;
    }
}
