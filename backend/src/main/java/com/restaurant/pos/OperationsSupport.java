package com.restaurant.pos;

import org.springframework.stereotype.Component;
import java.math.BigDecimal;
import java.util.*;

@Component
public class OperationsSupport {
    final TenantJdbc db;
    public OperationsSupport(TenantJdbc db) { this.db=db; }
    static UUID id(Object value) { return UUID.fromString(value.toString()); }
    static UUID id(Map<String,Object> row) { return id(row.get("id")); }
    static String text(Object value) { return value == null ? "" : value.toString(); }
    static int integer(Object value) { return ((Number)value).intValue(); }
    @SuppressWarnings("unchecked")
    static Map<String,Object> object(Object value) { return new LinkedHashMap<>((Map<String,Object>)value); }
    @SuppressWarnings("unchecked")
    static List<Map<String,Object>> objects(Object value) { return value == null ? List.of() : (List<Map<String,Object>>)value; }
    static void reason(String reason) { if(reason==null || reason.isBlank() || reason.length()>2000) throw new ApiException(422,"A reason is required (maximum 2000 characters)"); }
    static void version(Map<String,Object> row, Integer version) {
        if(version==null || integer(row.get("version"))!=version) throw new ApiException(409,"The record changed. Refresh before trying again.");
    }
    static void open(Map<String,Object> order) { if(!Set.of("DRAFT","OPEN").contains(text(order.get("status")))) throw new ApiException(409,"Only a draft or open order can be edited"); }
    public Map<String,Object> outlet(Actor a,UUID outlet) {
        db.outlet(a,outlet);
        return db.one("select * from outlets where tenant_id=? and id=?",a.tenantId(),outlet);
    }
    // A single outlet advisory lock precedes order/table/bill/KOT row locks. This also
    // serializes table creation and transfer, including an initially empty target table.
    void lockOutlet(Actor a,UUID outlet) {
        db.outlet(a,outlet);
        db.jdbc().queryForList("select pg_advisory_xact_lock(hashtextextended(?,0))",a.tenantId()+":operations:"+outlet);
    }
    public Map<String,Object> order(Actor a,UUID id,boolean lock) {
        Map<String,Object> row=db.one("select * from orders where tenant_id=? and id=?",a.tenantId(),id);
        UUID outlet=id(row.get("outlet_id")); db.outlet(a,outlet);
        if(lock) { lockOutlet(a,outlet); row=db.one("select * from orders where tenant_id=? and outlet_id=? and id=? for update",a.tenantId(),outlet,id); }
        return row;
    }
    public Map<String,Object> bill(Actor a,UUID id,boolean lock) {
        Map<String,Object> row=db.one("select * from bills where tenant_id=? and id=?",a.tenantId(),id);
        UUID outlet=id(row.get("outlet_id")); db.outlet(a,outlet);
        Map<String,Object> order=order(a,id(row.get("order_id")),lock);
        if(!outlet.equals(id(order.get("outlet_id")))) throw new ApiException(404,"Bill not found");
        if(lock) row=db.one("select * from bills where tenant_id=? and outlet_id=? and order_id=? and id=? for update",a.tenantId(),outlet,id(order),id);
        return row;
    }
    public Map<String,Object> kot(Actor a,UUID id,boolean lock) {
        Map<String,Object> row=db.one("select * from kots where tenant_id=? and id=?",a.tenantId(),id);
        UUID outlet=id(row.get("outlet_id")); db.outlet(a,outlet);
        Map<String,Object> order=order(a,id(row.get("order_id")),lock);
        if(!outlet.equals(id(order.get("outlet_id")))) throw new ApiException(404,"Ticket not found");
        if(lock) row=db.one("select * from kots where tenant_id=? and outlet_id=? and order_id=? and id=? for update",a.tenantId(),outlet,id(order),id);
        return row;
    }
    public Map<String,Object> printer(Actor a,UUID id) {
        Map<String,Object> row=db.one("select * from printers where tenant_id=? and id=?",a.tenantId(),id);
        db.outlet(a,id(row.get("outlet_id"))); return row;
    }
    public Map<String,Object> job(Actor a,UUID id,boolean lock) {
        Map<String,Object> row=db.one("select * from print_jobs where tenant_id=? and id=?",a.tenantId(),id);
        UUID outlet=id(row.get("outlet_id")); db.outlet(a,outlet);
        if(lock) row=db.one("select * from print_jobs where tenant_id=? and outlet_id=? and id=? for update",a.tenantId(),outlet,id);
        return row;
    }
    List<Map<String,Object>> lines(Actor a,Map<String,Object> order,boolean active) {
        UUID outlet=id(order.get("outlet_id")); db.outlet(a,outlet);
        return db.list("select i.* from order_items i join orders o on o.tenant_id=i.tenant_id and o.id=i.order_id where i.tenant_id=? and o.tenant_id=? and o.outlet_id=? and i.order_id=?"+(active?" and not i.cancelled":"")+" order by i.id",a.tenantId(),a.tenantId(),outlet,id(order));
    }
    Map<String,Object> line(Actor a,Map<String,Object> order,UUID lineId) {
        UUID outlet=id(order.get("outlet_id")); db.outlet(a,outlet);
        return db.one("select i.* from order_items i join orders o on o.tenant_id=i.tenant_id and o.id=i.order_id where i.tenant_id=? and o.tenant_id=? and o.outlet_id=? and i.order_id=? and i.id=? for update of i",a.tenantId(),a.tenantId(),outlet,id(order),lineId);
    }
    void bump(Actor a,Map<String,Object> order) {
        db.update("update orders set version=version+1,updated_at=now() where tenant_id=? and outlet_id=? and id=?",a.tenantId(),id(order.get("outlet_id")),id(order));
    }
    String number(Actor a,UUID outlet,String kind) {
        db.outlet(a,outlet);
        Map<String,Object> row=db.one("insert into document_counters(tenant_id,outlet_id,kind,value) values(?,?,?,1) on conflict(tenant_id,outlet_id,kind) do update set value=document_counters.value+1 where document_counters.tenant_id=? and document_counters.outlet_id=? returning value",a.tenantId(),outlet,kind,a.tenantId(),outlet);
        return kind+"-"+String.format(java.util.Locale.ROOT,"%06d",((Number)row.get("value")).longValue());
    }
    String billNumber(Actor actor, UUID outlet, boolean nc) {
        UUID branch=id(db.one("select branch_id from outlets where tenant_id=? and id=? for share",actor.tenantId(),outlet).get("branch_id"));
        String kind=nc?"NC-BILL":"BILL";
        var row=db.one("""
            insert into branch_bill_counters(tenant_id,branch_id,kind,value) values(?,?,?,1)
            on conflict(tenant_id,branch_id,kind) do update set value=branch_bill_counters.value+1
            returning value
            """,actor.tenantId(),branch,kind);
        return kind+"-"+row.get("value");
    }

    Map<String,Object> menu(Actor a,UUID outlet,UUID menuId) {
        db.outlet(a,outlet);
        return db.one("select m.*,c.name as category_name from menu_items m join categories c on c.tenant_id=m.tenant_id and c.outlet_id=m.outlet_id and c.id=m.category_id where m.tenant_id=? and c.tenant_id=? and m.outlet_id=? and m.id=?",a.tenantId(),a.tenantId(),outlet,menuId);
    }
    void assertDiscount(Actor a,Map<String,Object> order) {
        OperationsMoney.price(lines(a,order,true),OperationsMoney.amount(order.get("discount")));
    }
    Map<String,Object> snapshot(Actor a,UUID outlet,Map<String,Object> line) {
        Map<String,Object> copy=new LinkedHashMap<>(line);
        // Category names are captured before billing and never joined to the live menu in reports.
        Map<String,Object> category=db.one("select name from categories where tenant_id=? and outlet_id=? and id=?",a.tenantId(),outlet,id(line.get("category_id")));
        copy.put("category_name",category.get("name"));
        copy.remove("tenant_id"); return copy;
    }
}
