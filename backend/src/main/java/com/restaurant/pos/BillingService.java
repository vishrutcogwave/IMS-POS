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
        return db.list("select b.*,b.number as bill_number,o.number as order_number from bills b join orders o on o.tenant_id=b.tenant_id and o.outlet_id=b.outlet_id and o.id=b.order_id where b.tenant_id=? and o.tenant_id=? and b.outlet_id=? order by b.created_at desc,b.id",a.tenantId(),a.tenantId(),outlet);
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
        Map<String,Object> order = new LinkedHashMap<>(support.order(a,id(bill.get("order_id")),false));
        order.put("order_number",order.get("number"));
        if (order.get("table_id") != null) {
            order.put("table_name",db.one("select name from restaurant_tables where tenant_id=? and outlet_id=? and id=?",
                    a.tenantId(),outlet,id(order.get("table_id"))).get("name"));
        }
        bill.put("bill_number",bill.get("number"));
        bill.put("order_number",order.get("number"));
        bill.put("order",order);
        bill.put("outlet",support.outlet(a,outlet));
        bill.put("tenant",db.one("select name,receipt_address,tax_number,phone,receipt_footer from tenants where id=?",a.tenantId()));

        if("CANCELLED".equals(bill.get("status")) && bill.get("settled_at")!=null) {
            var reversals=db.list("select reason,details->>'refundReference' as refund_reference,created_at from audit_log where tenant_id=? and outlet_id=? and action='BILL_PAYMENT_REVERSE' and entity_type='BILL' and entity_id=? order by created_at desc limit 1",a.tenantId(),outlet,billId);
            if(!reversals.isEmpty()) bill.put("reversal",reversals.getFirst());
        }
        if("PAID".equals(bill.get("status"))) {
            Map<String,Object> receipt=object(printing.currentBillReceipt(a,outlet,billId).get("payload")); bill.put("receipt",receipt);
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
        if(request.ncBill() && (request.groups()!=null || lines.stream().anyMatch(line -> !Boolean.TRUE.equals(line.get("non_chargeable")))))
            throw new ApiException(422,"An NC bill requires a single bill containing only items sent on NC KOTs.");
        List<List<Map<String,Object>>> groups=split(priced,request.groups());
        List<Map<String,Object>> receiptPrinters=printing.receiptPrinters(a,outlet);
        boolean printBeforePayment=printing.autoPrint(a,outlet,"bill_before_payment");
        List<UUID> previewJobIds=new ArrayList<>();
        for(List<Map<String,Object>> group:groups) {
            boolean nc=group.stream().allMatch(line -> Boolean.TRUE.equals(line.get("non_chargeable")));
            Map<String,Object> totals=OperationsMoney.totals(group); UUID bill=UUID.randomUUID(); String number=support.billNumber(a,outlet,nc);
            db.update("insert into bills(id,tenant_id,outlet_id,order_id,number,subtotal,discount,tax,total,non_chargeable) values(?,?,?,?,?,?,?,?,?,?)",bill,a.tenantId(),outlet,orderId,number,totals.get("subtotal"),totals.get("discount"),totals.get("tax"),totals.get("total"),nc);
            for(Map<String,Object> line:group) db.update("insert into bill_items(id,tenant_id,bill_id,order_item_id,quantity,snapshot) values(?,?,?,?,?,?::jsonb)",UUID.randomUUID(),a.tenantId(),bill,id(line),line.get("quantity"),db.json(line));
            Map<String,Object> preview=printing.payload(a,order,nc?"NC BILL PREVIEW":"BILL PREVIEW",number,group);
            for(String key:List.of("subtotal","discount","tax","total")) preview.put(key,totals.get(key));
            preview.put("billId",bill); preview.put("billStatus","UNPAID"); preview.put("payments",List.of());
            for(Map<String,Object> printer:receiptPrinters)
                previewJobIds.add(id(printing.enqueue(a,outlet,id(printer),"BILL_PREVIEW",bill,null,preview,printBeforePayment)));
            db.audit(a,outlet,"BILL_CREATE","BILL",bill,"",Map.of("order_id",orderId,"number",number,"totals",totals));
        }
        db.update("update orders set status='BILL_PENDING',version=version+1,updated_at=now() where tenant_id=? and outlet_id=? and id=?",a.tenantId(),outlet,orderId);
        Map<String,Object> result=orders.detail(a,orderId);
        result.put("bill_preview_print_job_ids",previewJobIds);
        result.put("bill_preview_auto_printed",printBeforePayment);
        return result;
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
        PaymentAmounts amounts=validatePayments(bill,outlet,request);
        BigDecimal tender=amounts.tender(), change=amounts.change();

        // Validate receipt routing before any settlement or payment writes.
        List<Map<String,Object>> printers=printing.receiptPrinters(a,outletId);
        boolean printAfterSettlement=printing.autoPrint(a,outletId,"receipt_after_settlement");
        List<Map<String,Object>> lineSnapshots=items(a,bill).stream().map(i -> object(i.get("snapshot"))).toList();
        Map<String,Object> receipt=printing.payload(a,order,Boolean.TRUE.equals(bill.get("non_chargeable"))?"NC BILL":"RECEIPT",text(bill.get("number")),lineSnapshots);
        for(String key:List.of("subtotal","discount","tax","total")) receipt.put(key,bill.get(key));
        receipt.put("payments",request.payments()); receipt.put("cashTendered",tender); receipt.put("change",change); receipt.put("billId",billId);
        for(OperationsDtos.Payment payment:request.payments()) db.update("insert into payments(id,tenant_id,bill_id,method,amount,reference) values(?,?,?,?,?,?)",UUID.randomUUID(),a.tenantId(),billId,payment.method(),OperationsMoney.money(payment.amount()),text(payment.reference()));
        db.update("update bills set status='PAID',version=version+1,settled_at=now() where tenant_id=? and outlet_id=? and order_id=? and id=?",a.tenantId(),outletId,id(order),billId);
        var printJobs = new ArrayList<UUID>();
        for (var printer : printers) printJobs.add(id(printing.enqueue(a,outletId,id(printer),"BILL",billId,null,receipt,printAfterSettlement)));
        boolean allPaid=db.list("select id from bills where tenant_id=? and outlet_id=? and order_id=? and status='OPEN'",a.tenantId(),outletId,id(order)).isEmpty();
        db.update("update orders set status=?,version=version+1,updated_at=now() where tenant_id=? and outlet_id=? and id=?",allPaid?"SETTLED":"BILL_PENDING",a.tenantId(),outletId,id(order));
        db.audit(a,outletId,"BILL_SETTLE","BILL",billId,"",Map.of("number",bill.get("number"),"order_id",id(order),"total",bill.get("total"),"payments",request.payments(),"cash_tendered",tender,"change",change,"table_id",text(order.get("table_id"))));
        var result = detail(a,billId);
        result.put("print_job_ids",printJobs);
        result.put("receipt_auto_printed",printAfterSettlement);
        return result;
    }
    private record PaymentAmounts(BigDecimal tender, BigDecimal change) {}

    private PaymentAmounts validatePayments(Map<String,Object> bill,Map<String,Object> outlet,OperationsDtos.Settle request) {
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
        return new PaymentAmounts(tender,tender.subtract(cash));
    }

    public Map<String,Object> correctPayment(Actor a,UUID billId,OperationsDtos.CorrectPayment request) {
        reason(request.reason());
        Map<String,Object> bill=support.bill(a,billId,true);
        if(Boolean.TRUE.equals(bill.get("non_chargeable"))) throw new ApiException(422,"NC bills have no payment to correct.");
        OperationsDtos.Settle payment=request.payment();
        version(bill,payment.version());
        if(!"PAID".equals(bill.get("status"))) throw new ApiException(409,"Select a paid bill to correct its recorded payment.");
        UUID outlet=id(bill.get("outlet_id"));
        PaymentAmounts amounts=validatePayments(bill,support.outlet(a,outlet),payment);
        boolean printAfterSettlement=printing.autoPrint(a,outlet,"receipt_after_settlement");
        var printers=printing.receiptPrinters(a,outlet);
        var original=printing.currentBillReceipt(a,outlet,billId);
        var receipt=object(original.get("payload"));
        Object previous=receipt.get("payments");
        db.update("delete from payments where tenant_id=? and bill_id=?",a.tenantId(),billId);
        for(var row:payment.payments()) db.update("insert into payments(id,tenant_id,bill_id,method,amount,reference) values(?,?,?,?,?,?)",
                UUID.randomUUID(),a.tenantId(),billId,row.method(),OperationsMoney.money(row.amount()),text(row.reference()));
        db.update("update bills set version=version+1 where tenant_id=? and outlet_id=? and id=?",a.tenantId(),outlet,billId);
        receipt.put("title","CORRECTED RECEIPT");
        receipt.put("billVersion",payment.version()+1);
        receipt.put("payments",payment.payments());
        receipt.put("cashTendered",amounts.tender());
        receipt.put("change",amounts.change());
        printing.supersedePendingBillReceipts(a,outlet,billId,"Superseded by corrected payment receipt");
        for(var printer:printers) printing.enqueue(a,outlet,id(printer),"BILL",billId,id(original),receipt,printAfterSettlement);
        db.audit(a,outlet,"BILL_PAYMENT_CORRECT","BILL",billId,request.reason(),Map.of("previousPayments",previous,
                "payments",payment.payments(),"previousReceiptJob",id(original),"cashTendered",amounts.tender(),"change",amounts.change()));
        var result=detail(a,billId);
        result.put("receipt_auto_printed",printAfterSettlement);
        return result;
    }

    public Map<String,Object> reverse(Actor a,UUID billId,OperationsDtos.ReverseBill request) {
        reason(request.reason());
        var initial=support.bill(a,billId,false);
        UUID orderId=id(initial.get("order_id")), outlet=id(initial.get("outlet_id"));
        var order=support.order(a,orderId,true);
        var bill=support.bill(a,billId,true);
        version(bill,request.version());
        if(!"PAID".equals(bill.get("status"))) throw new ApiException(409,"Only a paid bill can be reversed.");
        boolean nc=Boolean.TRUE.equals(bill.get("non_chargeable"));
        if(!nc && text(request.refundReference()).isBlank())
            throw new ApiException(422,"Enter the completed refund reference.",Map.of("refundReference","Enter a refund reference."));
        var siblings=siblings(a,bill);
        if(request.reopen()) {
            if(siblings.size()!=1) throw new ApiException(409,"Reverse the other paid bills and cancel any unpaid bills before reopening this order.");
            if(order.get("table_id")!=null) {
                UUID table=id(order.get("table_id"));
                db.one("select id from restaurant_tables where tenant_id=? and outlet_id=? and id=? for update",a.tenantId(),outlet,table);
                if(!db.list("select id from orders where tenant_id=? and outlet_id=? and table_id=? and id<>? and status in ('OPEN','BILL_PENDING')",a.tenantId(),outlet,table,orderId).isEmpty())
                    throw new ApiException(409,"This table has a newer active order. Close that order before reopening this bill.");
            }
        }
        var receipt=printing.currentBillReceipt(a,outlet,billId);
        db.update("update bills set status='CANCELLED',reason=?,version=version+1 where tenant_id=? and outlet_id=? and id=?",
                request.reason(),a.tenantId(),outlet,billId);
        printing.supersedePendingBillReceipts(a,outlet,billId,"Payment was reversed");
        if(request.reopen() || siblings.size()==1) db.update("update orders set status=?,version=version+1,updated_at=now() where tenant_id=? and outlet_id=? and id=?",
                request.reopen()?"OPEN":"CANCELLED",a.tenantId(),outlet,orderId);
        else if(siblings.stream().noneMatch(sibling -> "OPEN".equals(sibling.get("status"))))
            db.update("update orders set status='SETTLED',version=version+1,updated_at=now() where tenant_id=? and outlet_id=? and id=?",a.tenantId(),outlet,orderId);
        db.audit(a,outlet,"BILL_PAYMENT_REVERSE","BILL",billId,request.reason(),Map.of("orderId",orderId,
                "amount",bill.get("total"),"refundReference",text(request.refundReference()).strip(),"receiptJob",id(receipt),"reopened",request.reopen()));
        return detail(a,billId);
    }

    public Map<String,Object> cancel(Actor a,UUID billId,OperationsDtos.Cancel request) {
        reason(request.reason()); Map<String,Object> bill=support.bill(a,billId,true); version(bill,request.version()); UUID outlet=id(bill.get("outlet_id"));
        if(!"OPEN".equals(bill.get("status"))) throw new ApiException(409,"Only unpaid bills can be cancelled. Paid refunds/reversals are not implemented.");
        List<Map<String,Object>> siblings=siblings(a,bill);
        if(siblings.stream().anyMatch(b -> "PAID".equals(b.get("status")))) throw new ApiException(409,"A sibling bill was paid. Refunds/reversals are not implemented; the order cannot reopen.");
        for(Map<String,Object> sibling:siblings) {
            db.update("update bills set status='CANCELLED',reason=?,version=version+1 where tenant_id=? and outlet_id=? and order_id=? and id=?",request.reason(),a.tenantId(),outlet,id(bill.get("order_id")),id(sibling));
            printing.supersedePendingBillPreviews(a,outlet,id(sibling),"Bill cancelled before settlement");
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
        a.require("REPRINT_BILL");
        Map<String,Object> bill=support.bill(a,billId,true);
        if(!"PAID".equals(bill.get("status"))) throw new ApiException(409,"Only a settled immutable receipt can be reprinted");
        return printing.reprint(a,id(bill.get("outlet_id")),"BILL",billId,reason);
    }
    public Map<String,Object> printPreview(Actor a,UUID billId,String reason) {
        a.require("PRINT_BILL");
        Map<String,Object> bill=support.bill(a,billId,true);
        if(!"OPEN".equals(bill.get("status"))) throw new ApiException(409,"Only an unpaid bill can be printed as a bill preview");
        return printing.reprint(a,id(bill.get("outlet_id")),"BILL_PREVIEW",billId,reason);
    }
}
