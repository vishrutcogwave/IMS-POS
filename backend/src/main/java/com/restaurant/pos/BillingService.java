package com.restaurant.pos;

import org.springframework.stereotype.Service;
import java.math.BigDecimal;
import java.util.*;
import static com.restaurant.pos.OperationsSupport.*;

@Service
public class BillingService {
    private final TenantJdbc db;
    private final OperationsSupport support;
    private final OrderService orders;
    private final PrintingService printing;
    public BillingService(TenantJdbc db,OperationsSupport support,OrderService orders,PrintingService printing) { this.db=db; this.support=support; this.orders=orders; this.printing=printing; }

    public List<Map<String,Object>> list(Actor a,UUID outlet) {
        db.outlet(a,outlet);
        return db.list("select b.*,o.number as order_number from bills b join orders o on o.tenant_id=b.tenant_id and o.outlet_id=b.outlet_id and o.id=b.order_id where b.tenant_id=? and o.tenant_id=? and b.outlet_id=? order by b.created_at desc,b.id",a.tenantId(),a.tenantId(),outlet);
    }
    List<Map<String,Object>> items(Actor a,Map<String,Object> bill) {
        UUID outlet=id(bill.get("outlet_id")); db.outlet(a,outlet);
        List<Map<String,Object>> rows=db.list("select i.* from bill_items i join bills b on b.tenant_id=i.tenant_id and b.id=i.bill_id where i.tenant_id=? and b.tenant_id=? and b.outlet_id=? and i.bill_id=? order by i.order_item_id,i.id",a.tenantId(),a.tenantId(),outlet,id(bill));
        for(Map<String,Object> row:rows) { Map<String,Object> snapshot=object(row.get("snapshot")); snapshot.remove("id"); snapshot.remove("quantity"); snapshot.remove("tenant_id"); row.putAll(snapshot); }
        return rows;
    }
    public Map<String,Object> detail(Actor a,UUID billId) {
        Map<String,Object> bill=new LinkedHashMap<>(support.bill(a,billId,false)); UUID outlet=id(bill.get("outlet_id"));
        bill.put("items",items(a,bill));
        bill.put("payments",db.list("select p.* from payments p join bills b on b.tenant_id=p.tenant_id and b.id=p.bill_id where p.tenant_id=? and b.tenant_id=? and b.outlet_id=? and p.bill_id=? order by p.created_at,p.id",a.tenantId(),a.tenantId(),outlet,billId));
        bill.put("order",support.order(a,id(bill.get("order_id")),false));
        bill.put("outlet",support.outlet(a,outlet));
        bill.put("tenant",db.one("select name,receipt_address,tax_number,phone,receipt_footer from tenants where id=?",a.tenantId()));
        bill.put("change",OperationsMoney.ZERO);
        if("PAID".equals(bill.get("status"))) {
            Map<String,Object> receipt=object(printing.original(a,outlet,"BILL",billId).get("payload")); bill.put("receipt",receipt);
            bill.put("change",receipt.getOrDefault("change",OperationsMoney.ZERO));
            bill.put("tenant",Map.of("name",text(receipt.get("businessName")),"receipt_address",text(receipt.get("address")),"tax_number",text(receipt.get("taxNumber")),"phone",text(receipt.get("phone")),"receipt_footer",text(receipt.get("footer"))));
            Map<String,Object> outletSnapshot=object(bill.get("outlet")); outletSnapshot.put("name",receipt.get("outlet")); outletSnapshot.put("currency",receipt.get("currency")); bill.put("outlet",outletSnapshot);
        }
        return bill;
    }
    public Map<String,Object> create(Actor a,UUID orderId,OperationsDtos.CreateBills request) {
        Map<String,Object> order=support.order(a,orderId,true); version(order,request.version()); open(order); UUID outlet=id(order.get("outlet_id"));
        if(!db.list("select id from bills where tenant_id=? and outlet_id=? and order_id=? and status<>'CANCELLED'",a.tenantId(),outlet,orderId).isEmpty()) throw new ApiException(409,"Cancel existing unpaid bills before regenerating");
        List<Map<String,Object>> lines=support.lines(a,order,true);
        if(lines.isEmpty()) throw new ApiException(422,"Cannot bill an empty order");
        if(lines.stream().anyMatch(l -> integer(l.get("quantity"))!=integer(l.get("sent_quantity")))) throw new ApiException(409,"Send every active item to the kitchen before creating bills");
        List<Map<String,Object>> snapshots=new ArrayList<>();
        for(Map<String,Object> line:lines) snapshots.add(support.snapshot(a,outlet,line));
        List<Map<String,Object>> priced=OperationsMoney.price(snapshots,OperationsMoney.amount(order.get("discount")));
        List<List<Map<String,Object>>> groups=split(priced,request.groups());
        for(List<Map<String,Object>> group:groups) {
            Map<String,Object> totals=OperationsMoney.totals(group); UUID bill=UUID.randomUUID(); String number=support.number(a,outlet,"BILL");
            db.update("insert into bills(id,tenant_id,outlet_id,order_id,number,subtotal,discount,tax,total) values(?,?,?,?,?,?,?,?,?)",bill,a.tenantId(),outlet,orderId,number,totals.get("subtotal"),totals.get("discount"),totals.get("tax"),totals.get("total"));
            for(Map<String,Object> line:group) db.update("insert into bill_items(id,tenant_id,bill_id,order_item_id,quantity,snapshot) values(?,?,?,?,?,?::jsonb)",UUID.randomUUID(),a.tenantId(),bill,id(line),line.get("quantity"),db.json(line));
            db.audit(a,outlet,"BILL_CREATE","BILL",bill,"",Map.of("order_id",orderId,"number",number,"totals",totals));
        }
        db.update("update orders set status='BILL_PENDING',version=version+1,updated_at=now() where tenant_id=? and outlet_id=? and id=?",a.tenantId(),outlet,orderId);
        return orders.detail(a,orderId);
    }

    /** Split canonical whole-line tax/discount cents, preserving exactly the unsplit order total. */
    static List<List<Map<String,Object>>> split(List<Map<String,Object>> priced,List<OperationsDtos.BillGroup> requested) {
        if(requested==null) return List.of(priced);
        if(requested.isEmpty() || requested.size()>100) throw new ApiException(422,"Supply between one and 100 nonempty bill groups");
        Map<UUID,Map<String,Object>> source=new LinkedHashMap<>(); priced.forEach(line -> source.put(id(line),line));
        Map<UUID,Integer> quantities=new HashMap<>();
        List<List<Map<String,Object>>> groups=new ArrayList<>();
        for(OperationsDtos.BillGroup requestedGroup:requested) {
            if(requestedGroup.items()==null || requestedGroup.items().isEmpty()) throw new ApiException(422,"A split bill cannot be empty");
            Set<UUID> seen=new HashSet<>(); List<Map<String,Object>> group=new ArrayList<>();
            for(OperationsDtos.BillPart part:requestedGroup.items()) {
                if(part.quantity()==null || part.quantity()<1 || !source.containsKey(part.itemId()) || !seen.add(part.itemId())) throw new ApiException(422,"Each bill group must contain unique active item IDs and positive quantities");
                quantities.merge(part.itemId(),part.quantity(),Math::addExact);
                if(quantities.get(part.itemId())>integer(source.get(part.itemId()).get("quantity"))) throw new ApiException(422,"Split quantities exceed an active item quantity");
                Map<String,Object> line=new LinkedHashMap<>(source.get(part.itemId())); line.put("quantity",part.quantity());
                line.put("subtotal",OperationsMoney.amount(line.get("unit_price")).multiply(BigDecimal.valueOf(part.quantity()))); group.add(line);
            }
            group.sort(Comparator.comparing(line -> text(line.get("id")))); groups.add(group);
        }
        for(Map.Entry<UUID,Map<String,Object>> entry:source.entrySet()) {
            if(!Objects.equals(quantities.get(entry.getKey()),integer(entry.getValue().get("quantity")))) throw new ApiException(422,"Split bill groups must account for every active item quantity exactly once");
            List<Map<String,Object>> portions=groups.stream().flatMap(Collection::stream).filter(line -> id(line).equals(entry.getKey())).toList();
            List<BigDecimal> weights=portions.stream().map(line -> BigDecimal.valueOf(integer(line.get("quantity")))).toList();
            List<BigDecimal> discounts=OperationsMoney.allocate(OperationsMoney.amount(entry.getValue().get("discount")),weights);
            List<BigDecimal> taxes=OperationsMoney.allocate(OperationsMoney.amount(entry.getValue().get("tax")),weights);
            for(int i=0;i<portions.size();i++) {
                Map<String,Object> part=portions.get(i); part.put("discount",discounts.get(i)); part.put("tax",taxes.get(i));
                part.put("total",OperationsMoney.amount(part.get("subtotal")).subtract(discounts.get(i)).add(taxes.get(i)));
            }
        }
        return groups;
    }
    private List<Map<String,Object>> siblings(Actor a,Map<String,Object> bill) {
        return db.list("select * from bills where tenant_id=? and outlet_id=? and order_id=? and status<>'CANCELLED' order by id for update",a.tenantId(),id(bill.get("outlet_id")),id(bill.get("order_id")));
    }
    public Map<String,Object> settle(Actor a,UUID billId,OperationsDtos.Settle request) {
        Map<String,Object> bill=support.bill(a,billId,true); version(bill,request.version());
        if(!"OPEN".equals(bill.get("status"))) throw new ApiException(409,"Only an unpaid bill can be settled, once");
        UUID outletId=id(bill.get("outlet_id")); Map<String,Object> outlet=support.outlet(a,outletId);
        Map<String,Object> order=support.order(a,id(bill.get("order_id")),true);
        if(!"BILL_PENDING".equals(order.get("status"))) throw new ApiException(409,"Order is not awaiting payment");
        List<?> allowed=(List<?>)outlet.get("payment_methods");
        BigDecimal allocated=OperationsMoney.ZERO,cash=OperationsMoney.ZERO;
        for(OperationsDtos.Payment payment:request.payments()) {
            if(!allowed.contains(payment.method())) throw new ApiException(422,"Payment method is not configured for this outlet: "+payment.method());
            if(Set.of("CARD","UPI").contains(payment.method()) && text(payment.reference()).isBlank()) throw new ApiException(422,"CARD and UPI payments require an external confirmation reference");
            BigDecimal amount=OperationsMoney.money(payment.amount()); if(amount.signum()<=0) throw new ApiException(422,"Payment allocation must be positive");
            allocated=allocated.add(amount); if("CASH".equals(payment.method())) cash=cash.add(amount);
        }
        if(allocated.compareTo(OperationsMoney.amount(bill.get("total")))!=0) throw new ApiException(422,"Payment allocations must equal the bill total exactly");
        BigDecimal tender=request.cashTendered()==null?cash:OperationsMoney.money(request.cashTendered());
        if(tender.compareTo(cash)<0) throw new ApiException(422,"Cash tendered is less than the cash allocation");
        if(cash.signum()==0 && tender.signum()!=0) throw new ApiException(422,"Cash tendered requires a cash payment allocation");
        BigDecimal change=tender.subtract(cash);
        // Validate receipt routing before any settlement or payment writes.
        Map<String,Object> printer=printing.receiptPrinter(a,outletId);
        List<Map<String,Object>> lineSnapshots=items(a,bill).stream().map(i -> object(i.get("snapshot"))).toList();
        Map<String,Object> receipt=printing.payload(a,order,"RECEIPT",text(bill.get("number")),lineSnapshots);
        for(String key:List.of("subtotal","discount","tax","total")) receipt.put(key,bill.get(key));
        receipt.put("payments",request.payments()); receipt.put("cashTendered",tender); receipt.put("change",change); receipt.put("billId",billId);
        for(OperationsDtos.Payment payment:request.payments()) db.update("insert into payments(id,tenant_id,bill_id,method,amount,reference) values(?,?,?,?,?,?)",UUID.randomUUID(),a.tenantId(),billId,payment.method(),OperationsMoney.money(payment.amount()),text(payment.reference()));
        db.update("update bills set status='PAID',version=version+1,settled_at=now() where tenant_id=? and outlet_id=? and order_id=? and id=?",a.tenantId(),outletId,id(order),billId);
        printing.enqueue(a,outletId,id(printer),"BILL",billId,null,receipt);
        boolean allPaid=db.list("select id from bills where tenant_id=? and outlet_id=? and order_id=? and status='OPEN'",a.tenantId(),outletId,id(order)).isEmpty();
        db.update("update orders set status=?,version=version+1,updated_at=now() where tenant_id=? and outlet_id=? and id=?",allPaid?"SETTLED":"BILL_PENDING",a.tenantId(),outletId,id(order));
        db.audit(a,outletId,"BILL_SETTLE","BILL",billId,"",Map.of("number",bill.get("number"),"order_id",id(order),"total",bill.get("total"),"payments",request.payments(),"cash_tendered",tender,"change",change,"table_id",text(order.get("table_id"))));
        return detail(a,billId);
    }
    public Map<String,Object> cancel(Actor a,UUID billId,OperationsDtos.Cancel request) {
        reason(request.reason()); Map<String,Object> bill=support.bill(a,billId,true); version(bill,request.version()); UUID outlet=id(bill.get("outlet_id"));
        if(!"OPEN".equals(bill.get("status"))) throw new ApiException(409,"Only unpaid bills can be cancelled. Paid refunds/reversals are not implemented.");
        List<Map<String,Object>> siblings=siblings(a,bill);
        if(siblings.stream().anyMatch(b -> "PAID".equals(b.get("status")))) throw new ApiException(409,"A sibling bill was paid. Refunds/reversals are not implemented; the order cannot reopen.");
        for(Map<String,Object> sibling:siblings) {
            db.update("update bills set status='CANCELLED',reason=?,version=version+1 where tenant_id=? and outlet_id=? and order_id=? and id=?",request.reason(),a.tenantId(),outlet,id(bill.get("order_id")),id(sibling));
            db.audit(a,outlet,"BILL_CANCEL","BILL",id(sibling),request.reason(),Map.of("order_id",bill.get("order_id"),"number",sibling.get("number"),"total",sibling.get("total"),"requested_bill_id",billId));
        }
        db.update("update orders set status='OPEN',version=version+1,updated_at=now() where tenant_id=? and outlet_id=? and id=?",a.tenantId(),outlet,id(bill.get("order_id")));
        return detail(a,billId);
    }
    public Map<String,Object> modify(Actor a,UUID billId,OperationsDtos.ModifyBill request) {
        reason(request.reason()); Map<String,Object> bill=support.bill(a,billId,true); version(bill,request.version()); UUID outlet=id(bill.get("outlet_id"));
        if(!"OPEN".equals(bill.get("status"))) throw new ApiException(409,"Only unpaid bills can be modified");
        if(siblings(a,bill).size()!=1) throw new ApiException(409,"Split bills must be cancelled together and regenerated before modifications");
        List<Map<String,Object>> rows=items(a,bill);
        List<Map<String,Object>> snapshots=rows.stream().map(row -> object(row.get("snapshot"))).toList();
        List<Map<String,Object>> priced=OperationsMoney.price(snapshots,OperationsMoney.money(request.discount())); Map<String,Object> totals=OperationsMoney.totals(priced);
        for(int i=0;i<rows.size();i++) db.update("update bill_items set snapshot=?::jsonb where tenant_id=? and bill_id=? and id=?",db.json(priced.get(i)),a.tenantId(),billId,id(rows.get(i)));
        db.update("update bills set subtotal=?,discount=?,tax=?,total=?,reason=?,version=version+1 where tenant_id=? and outlet_id=? and id=?",totals.get("subtotal"),totals.get("discount"),totals.get("tax"),totals.get("total"),request.reason(),a.tenantId(),outlet,billId);
        db.update("update orders set discount=?,version=version+1,updated_at=now() where tenant_id=? and outlet_id=? and id=?",request.discount(),a.tenantId(),outlet,id(bill.get("order_id")));
        db.audit(a,outlet,"BILL_MODIFY","BILL",billId,request.reason(),Map.of("number",bill.get("number"),"before",Map.of("subtotal",bill.get("subtotal"),"discount",bill.get("discount"),"tax",bill.get("tax"),"total",bill.get("total")),"after",totals));
        return detail(a,billId);
    }
    public Map<String,Object> reprint(Actor a,UUID billId,String reason) {
        Map<String,Object> bill=support.bill(a,billId,true);
        if(!"PAID".equals(bill.get("status"))) throw new ApiException(409,"Only a settled immutable receipt can be reprinted");
        return printing.reprint(a,id(bill.get("outlet_id")),"BILL",billId,reason);
    }
}
