package com.restaurant.pos;

import org.springframework.stereotype.Service;
import java.math.BigDecimal;
import java.util.*;
import static com.restaurant.pos.OperationsSupport.*;

@Service
public class OrderService {
    private final TenantJdbc db;
    private final OperationsSupport support;
    private final PrintingService printing;
    public OrderService(TenantJdbc db,OperationsSupport support,PrintingService printing) { this.db=db; this.support=support; this.printing=printing; }

    public List<Map<String,Object>> list(Actor a,UUID outlet,String status) {
        db.outlet(a,outlet);
        String filter;
        if(status==null || "active".equalsIgnoreCase(status)) filter=" and o.status in ('OPEN','BILL_PENDING')";
        else if("all".equalsIgnoreCase(status)) filter="";
        else {
            String value=status.toUpperCase(Locale.ROOT);
            if(!Set.of("OPEN","BILL_PENDING","SETTLED","CANCELLED").contains(value)) throw new ApiException(400,"Invalid order status filter");
            filter=" and o.status='"+value+"'";
        }
        List<Map<String,Object>> orders=db.list("select o.*,t.name as table_name from orders o left join restaurant_tables t on t.tenant_id=o.tenant_id and t.outlet_id=o.outlet_id and t.id=o.table_id where o.tenant_id=? and o.outlet_id=?"+filter+" order by o.created_at desc,o.id",a.tenantId(),outlet);
        for(Map<String,Object> order:orders) {
            List<Map<String,Object>> lines=support.lines(a,order,true);
            order.putAll(OperationsMoney.totals(OperationsMoney.price(lines,OperationsMoney.amount(order.get("discount")))));
        }
        return orders;
    }
    public Map<String,Object> detail(Actor a,UUID orderId) {
        Map<String,Object> order=new LinkedHashMap<>(support.order(a,orderId,false)); UUID outlet=id(order.get("outlet_id"));
        List<Map<String,Object>> lines=support.lines(a,order,false);
        order.put("items",lines);
        order.putAll(OperationsMoney.totals(OperationsMoney.price(lines.stream().filter(l -> !Boolean.TRUE.equals(l.get("cancelled"))).toList(),OperationsMoney.amount(order.get("discount")))));
        order.put("table_name",order.get("table_id")==null?null:db.one("select name from restaurant_tables where tenant_id=? and outlet_id=? and id=?",a.tenantId(),outlet,id(order.get("table_id"))).get("name"));
        List<Map<String,Object>> kots=db.list("select * from kots where tenant_id=? and outlet_id=? and order_id=? order by created_at,id",a.tenantId(),outlet,orderId);
        for(Map<String,Object> kot:kots) kot.put("items",kotLines(a,kot));
        order.put("kots",kots);
        order.put("bills",db.list("select * from bills where tenant_id=? and outlet_id=? and order_id=? order by created_at,id",a.tenantId(),outlet,orderId));
        return order;
    }
    public Map<String,Object> create(Actor a,OperationsDtos.CreateOrder request) {
        Map<String,Object> outlet=support.outlet(a,request.outletId()); support.lockOutlet(a,request.outletId());
        if(!(outlet.get("service_modes") instanceof List<?> modes) || !modes.contains(request.serviceMode())) throw new ApiException(422,"Service mode is not enabled for this outlet");
        if("DINE_IN".equals(request.serviceMode())) {
            if(request.tableId()==null) throw new ApiException(422,"Dine-in orders require a table");
            db.one("select id from restaurant_tables where tenant_id=? and outlet_id=? and id=? for update",a.tenantId(),request.outletId(),request.tableId());
            availableTable(a,request.outletId(),request.tableId(),null);
        } else if(request.tableId()!=null) throw new ApiException(422,"Only dine-in orders can occupy a table");
        UUID order=UUID.randomUUID(); String number=support.number(a,request.outletId(),"ORD");
        db.update("insert into orders(id,tenant_id,outlet_id,table_id,number,service_mode,covers,notes,customer_name,created_by) values(?,?,?,?,?,?,?,?,?,?)",order,a.tenantId(),request.outletId(),request.tableId(),number,request.serviceMode(),request.covers(),text(request.notes()),text(request.customerName()),a.userId());
        db.audit(a,request.outletId(),"ORDER_CREATE","ORDER",order,"",Map.of("number",number,"table_id",request.tableId()==null?"":request.tableId().toString()));
        return detail(a,order);
    }
    private void availableTable(Actor a,UUID outlet,UUID table,UUID except) {
        List<Map<String,Object>> occupants=db.list("select id from orders where tenant_id=? and outlet_id=? and table_id=? and status in ('OPEN','BILL_PENDING')",a.tenantId(),outlet,table);
        if(occupants.stream().anyMatch(o -> !id(o).equals(except))) throw new ApiException(409,"Table already has an active order");
    }
    public Map<String,Object> add(Actor a,UUID orderId,OperationsDtos.AddItem request) {
        Map<String,Object> order=support.order(a,orderId,true); version(order,request.version()); open(order); UUID outlet=id(order.get("outlet_id"));
        if(support.lines(a,order,false).size()>=500) throw new ApiException(422,"An order can contain at most 500 distinct lines");
        Map<String,Object> menu=support.menu(a,outlet,request.menuItemId());
        if(!Boolean.TRUE.equals(menu.get("available"))) throw new ApiException(422,"Menu item is unavailable");
        String variant=text(request.variant()); BigDecimal price=OperationsMoney.amount(menu.get("price"));
        if(!variant.isEmpty()) price=choice(objects(menu.get("variants")),variant,"variant");
        List<String> names=request.modifiers()==null?List.of():request.modifiers();
        if(new HashSet<>(names).size()!=names.size()) throw new ApiException(422,"Duplicate modifiers are not allowed");
        List<Map<String,Object>> modifiers=new ArrayList<>();
        for(String name:names) {
            BigDecimal extra=choice(objects(menu.get("modifiers")),name,"modifier"); price=price.add(extra);
            modifiers.add(Map.of("name",name,"price",extra));
        }
        price=OperationsMoney.money(price);
        db.update("insert into order_items(id,tenant_id,order_id,menu_item_id,category_id,name,quantity,unit_price,tax_rate,variant,modifiers,notes) values(?,?,?,?,?,?,?,?,?,?,?::jsonb,?)",UUID.randomUUID(),a.tenantId(),orderId,request.menuItemId(),id(menu.get("category_id")),menu.get("name"),request.quantity(),price,menu.get("tax_rate"),variant,db.json(modifiers),text(request.notes()));
        support.assertDiscount(a,order); support.bump(a,order); return detail(a,orderId);
    }
    private BigDecimal choice(List<Map<String,Object>> choices,String name,String type) {
        List<Map<String,Object>> matches=choices.stream().filter(c -> name.equals(c.get("name"))).toList();
        if(matches.size()!=1) throw new ApiException(422,"Unknown or ambiguous "+type+": "+name);
        return OperationsMoney.money(OperationsMoney.amount(matches.get(0).get("price")));
    }
    public Map<String,Object> edit(Actor a,UUID orderId,OperationsDtos.EditOrder request) {
        Map<String,Object> order=support.order(a,orderId,true); version(order,request.version()); open(order);
        BigDecimal discount=OperationsMoney.amount(order.get("discount"));
        if(request.discount()!=null && request.discount().compareTo(discount)!=0) { a.require("DISCOUNT"); discount=OperationsMoney.money(request.discount()); }
        OperationsMoney.price(support.lines(a,order,true),discount);
        db.update("update orders set notes=?,customer_name=?,discount=?,version=version+1,updated_at=now() where tenant_id=? and outlet_id=? and id=?",request.notes()==null?order.get("notes"):request.notes(),request.customerName()==null?order.get("customer_name"):request.customerName(),discount,a.tenantId(),id(order.get("outlet_id")),orderId);
        if(discount.compareTo(OperationsMoney.amount(order.get("discount")))!=0) db.audit(a,id(order.get("outlet_id")),"ORDER_DISCOUNT","ORDER",orderId,"",Map.of("before",order.get("discount"),"after",discount));
        return detail(a,orderId);
    }
    public Map<String,Object> editItem(Actor a,UUID orderId,UUID lineId,OperationsDtos.EditItem request) {
        Map<String,Object> order=support.order(a,orderId,true); version(order,request.version()); open(order);
        Map<String,Object> line=support.line(a,order,lineId); unsent(line);
        db.update("update order_items set quantity=?,notes=? where tenant_id=? and order_id=? and id=?",request.quantity(),request.notes()==null?line.get("notes"):request.notes(),a.tenantId(),orderId,lineId);
        support.assertDiscount(a,order); support.bump(a,order); return detail(a,orderId);
    }
    private void unsent(Map<String,Object> line) {
        if(Boolean.TRUE.equals(line.get("cancelled"))) throw new ApiException(409,"Line is cancelled");
        if(integer(line.get("sent_quantity"))!=0) throw new ApiException(409,"Sent lines are immutable. Add a new line or cancel its complete KOT.");
    }
    public Map<String,Object> cancelItem(Actor a,UUID orderId,UUID lineId,OperationsDtos.Cancel request) {
        reason(request.reason()); Map<String,Object> order=support.order(a,orderId,true); version(order,request.version()); open(order);
        Map<String,Object> line=support.line(a,order,lineId); unsent(line);
        db.update("update order_items set cancelled=true where tenant_id=? and order_id=? and id=?",a.tenantId(),orderId,lineId);
        support.assertDiscount(a,order); support.bump(a,order);
        db.audit(a,id(order.get("outlet_id")),"ORDER_ITEM_CANCEL","ORDER_ITEM",lineId,request.reason(),Map.of("order_id",orderId,"line",line)); return detail(a,orderId);
    }
    public Map<String,Object> transfer(Actor a,UUID orderId,OperationsDtos.Transfer request) {
        reason(request.reason()); Map<String,Object> order=support.order(a,orderId,true); version(order,request.version()); open(order);
        if(!"DINE_IN".equals(order.get("service_mode"))) throw new ApiException(422,"Only dine-in orders can be transferred");
        UUID outlet=id(order.get("outlet_id")),oldTable=id(order.get("table_id"));
        db.one("select id from restaurant_tables where tenant_id=? and outlet_id=? and id=?",a.tenantId(),outlet,request.tableId());
        db.list("select id from restaurant_tables where tenant_id=? and outlet_id=? and id in (?,?) order by id for update",a.tenantId(),outlet,oldTable,request.tableId());
        availableTable(a,outlet,request.tableId(),orderId);
        db.update("update orders set table_id=?,version=version+1,updated_at=now() where tenant_id=? and outlet_id=? and id=?",request.tableId(),a.tenantId(),outlet,orderId);
        db.audit(a,outlet,"TABLE_TRANSFER","ORDER",orderId,request.reason(),Map.of("from_table_id",oldTable,"to_table_id",request.tableId())); return detail(a,orderId);
    }
    public Map<String,Object> send(Actor a,UUID orderId,OperationsDtos.Version request) {
        Map<String,Object> order=support.order(a,orderId,true); version(order,request.version()); open(order); UUID outlet=id(order.get("outlet_id"));
        List<Map<String,Object>> unsent=support.lines(a,order,true).stream().filter(l -> integer(l.get("sent_quantity"))<integer(l.get("quantity"))).toList();
        if(unsent.isEmpty()) throw new ApiException(409,"There are no unsent items");
        Map<UUID,List<Map<String,Object>>> groups=new LinkedHashMap<>();
        // Resolve every route and every snapshot before allocating document numbers or writing anything.
        for(Map<String,Object> line:unsent) {
            if(integer(line.get("sent_quantity"))!=0) throw new ApiException(409,"Partial previously sent lines require operator reconciliation");
            Map<String,Object> printer=printing.route(a,outlet,id(line.get("category_id")));
            if(printer==null) throw new ApiException(422,"No enabled kitchen route or fallback for item: "+line.get("name"));
            groups.computeIfAbsent(id(printer),p -> new ArrayList<>()).add(support.snapshot(a,outlet,line));
        }
        for(Map.Entry<UUID,List<Map<String,Object>>> group:groups.entrySet()) {
            UUID kot=UUID.randomUUID(); String number=support.number(a,outlet,"KOT");
            db.update("insert into kots(id,tenant_id,outlet_id,order_id,printer_id,number) values(?,?,?,?,?,?)",kot,a.tenantId(),outlet,orderId,group.getKey(),number);
            for(Map<String,Object> line:group.getValue()) {
                db.update("insert into kot_items(id,tenant_id,kot_id,order_item_id,quantity,snapshot) values(?,?,?,?,?,?::jsonb)",UUID.randomUUID(),a.tenantId(),kot,id(line),line.get("quantity"),db.json(line));
                db.update("update order_items set sent_quantity=quantity where tenant_id=? and order_id=? and id=? and not cancelled and sent_quantity=0",a.tenantId(),orderId,id(line));
            }
            printing.enqueue(a,outlet,group.getKey(),"KOT",kot,null,printing.payload(a,order,"KITCHEN ORDER",number,group.getValue()));
            db.audit(a,outlet,"KOT_SEND","KOT",kot,"",Map.of("order_id",orderId,"number",number));
        }
        support.bump(a,order); return detail(a,orderId);
    }
    public List<Map<String,Object>> kots(Actor a,UUID outlet) {
        db.outlet(a,outlet);
        List<Map<String,Object>> result=db.list("select k.*,o.number as order_number,o.service_mode,t.name as table_name from kots k join orders o on o.tenant_id=k.tenant_id and o.outlet_id=k.outlet_id and o.id=k.order_id left join restaurant_tables t on t.tenant_id=o.tenant_id and t.outlet_id=o.outlet_id and t.id=o.table_id where k.tenant_id=? and o.tenant_id=? and k.outlet_id=? order by k.created_at desc,k.id",a.tenantId(),a.tenantId(),outlet);
        for(Map<String,Object> kot:result) kot.put("items",kotLines(a,kot)); return result;
    }
    private List<Map<String,Object>> kotLines(Actor a,Map<String,Object> kot) {
        UUID outlet=id(kot.get("outlet_id")); db.outlet(a,outlet);
        List<Map<String,Object>> rows=db.list("select i.* from kot_items i join kots k on k.tenant_id=i.tenant_id and k.id=i.kot_id where i.tenant_id=? and k.tenant_id=? and k.outlet_id=? and i.kot_id=? order by i.order_item_id,i.id",a.tenantId(),a.tenantId(),outlet,id(kot));
        for(Map<String,Object> row:rows) { Map<String,Object> snapshot=object(row.get("snapshot")); snapshot.remove("id"); snapshot.remove("quantity"); snapshot.remove("tenant_id"); row.putAll(snapshot); }
        return rows;
    }
    private Map<String,Object> kotDetail(Actor a,UUID kotId) {
        Map<String,Object> kot=new LinkedHashMap<>(support.kot(a,kotId,false)); kot.put("items",kotLines(a,kot)); return kot;
    }
    public Map<String,Object> status(Actor a,UUID kotId,String status) {
        Map<String,Object> kot=support.kot(a,kotId,true);
        String expected=Map.of("QUEUED","PREPARING","PREPARING","READY","READY","SERVED").get(text(kot.get("status")));
        if(!status.equals(expected)) throw new ApiException(409,"Kitchen status must advance QUEUED -> PREPARING -> READY -> SERVED");
        db.update("update kots set status=?,updated_at=now() where tenant_id=? and outlet_id=? and id=?",status,a.tenantId(),id(kot.get("outlet_id")),kotId);
        db.audit(a,id(kot.get("outlet_id")),"KOT_STATUS","KOT",kotId,"",Map.of("before",kot.get("status"),"after",status)); return kotDetail(a,kotId);
    }
    public Map<String,Object> cancelKot(Actor a,UUID kotId,String reason) {
        reason(reason); Map<String,Object> kot=support.kot(a,kotId,true);
        Map<String,Object> order=support.order(a,id(kot.get("order_id")),true); open(order); UUID outlet=id(order.get("outlet_id"));
        if(!db.list("select id from bills where tenant_id=? and outlet_id=? and order_id=? and status<>'CANCELLED'",a.tenantId(),outlet,id(order)).isEmpty()) throw new ApiException(409,"Cancel unpaid bills before cancelling kitchen items; paid refunds are not supported");
        cancelWholeKot(a,order,kot,reason); support.assertDiscount(a,order); support.bump(a,order); return kotDetail(a,kotId);
    }
    private void cancelWholeKot(Actor a,Map<String,Object> order,Map<String,Object> kot,String reason) {
        if("CANCELLED".equals(kot.get("status"))) throw new ApiException(409,"Kitchen ticket is already cancelled");
        List<Map<String,Object>> items=kotLines(a,kot);
        for(Map<String,Object> item:items) {
            Map<String,Object> line=support.line(a,order,id(item.get("order_item_id")));
            if(Boolean.TRUE.equals(line.get("cancelled")) || integer(line.get("quantity"))!=integer(item.get("quantity")) || integer(line.get("sent_quantity"))!=integer(item.get("quantity")))
                throw new ApiException(409,"Partial or inconsistent kitchen quantities cannot be cancelled automatically");
        }
        printing.cancelKotJob(a,kot,reason);
        for(Map<String,Object> item:items) db.update("update order_items set cancelled=true where tenant_id=? and order_id=? and id=?",a.tenantId(),id(order),id(item.get("order_item_id")));
        db.update("update kots set status='CANCELLED',reason=?,updated_at=now() where tenant_id=? and outlet_id=? and order_id=? and id=?",reason,a.tenantId(),id(order.get("outlet_id")),id(order),id(kot));
        db.audit(a,id(order.get("outlet_id")),"KOT_CANCEL","KOT",id(kot),reason,Map.of("order_id",id(order),"number",kot.get("number"),"items",items));
    }
    public Map<String,Object> cancel(Actor a,UUID orderId,OperationsDtos.Cancel request) {
        reason(request.reason()); Map<String,Object> order=support.order(a,orderId,true); version(order,request.version()); UUID outlet=id(order.get("outlet_id"));
        if(!Set.of("OPEN","BILL_PENDING").contains(text(order.get("status")))) throw new ApiException(409,"Order cannot be cancelled in its current state");
        List<Map<String,Object>> bills=db.list("select * from bills where tenant_id=? and outlet_id=? and order_id=? and status<>'CANCELLED' order by id for update",a.tenantId(),outlet,orderId);
        if(bills.stream().anyMatch(b -> "PAID".equals(b.get("status")))) throw new ApiException(409,"Paid refunds and reversals are not supported");
        for(Map<String,Object> kot:db.list("select * from kots where tenant_id=? and outlet_id=? and order_id=? and status<>'CANCELLED' order by id for update",a.tenantId(),outlet,orderId)) cancelWholeKot(a,order,kot,request.reason());
        for(Map<String,Object> bill:bills) {
            db.update("update bills set status='CANCELLED',reason=?,version=version+1 where tenant_id=? and outlet_id=? and order_id=? and id=?",request.reason(),a.tenantId(),outlet,orderId,id(bill));
            db.audit(a,outlet,"BILL_CANCEL","BILL",id(bill),request.reason(),Map.of("order_id",orderId,"number",bill.get("number"),"total",bill.get("total")));
        }
        db.update("update order_items set cancelled=true where tenant_id=? and order_id=?",a.tenantId(),orderId);
        db.update("update orders set status='CANCELLED',discount=0,version=version+1,updated_at=now() where tenant_id=? and outlet_id=? and id=?",a.tenantId(),outlet,orderId);
        db.audit(a,outlet,"ORDER_CANCEL","ORDER",orderId,request.reason(),Map.of("number",order.get("number"),"table_id",text(order.get("table_id")))); return detail(a,orderId);
    }
    public Map<String,Object> reprintKot(Actor a,UUID kotId,String reason) {
        Map<String,Object> kot=support.kot(a,kotId,true);
        if("CANCELLED".equals(kot.get("status"))) throw new ApiException(409,"Cancelled KOTs cannot be reissued as kitchen orders; retry the cancellation job if needed");
        return printing.reprint(a,id(kot.get("outlet_id")),"KOT",kotId,reason);
    }
}
