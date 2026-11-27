package com.restaurant.pos;

import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;
import java.util.*;
import static com.restaurant.pos.OperationsDtos.*;

@RestController
@RequestMapping("/api")
public class OperationsController {
    private final TenantJdbc db;
    private final OperationsSupport scope;
    private final OperationsIdempotency keys;
    private final OrderService orders;
    private final BillingService bills;
    public OperationsController(TenantJdbc db,OperationsSupport scope,OperationsIdempotency keys,OrderService orders,BillingService bills) {
        this.db=db; this.scope=scope; this.keys=keys; this.orders=orders; this.bills=bills;
    }
    @GetMapping("/orders")
    public Object orders(@RequestParam UUID outletId,@RequestParam(defaultValue="active") String status) {
        Actor a=Actor.current(); a.require("ORDER"); return db.tx(a,() -> orders.list(a,outletId,status));
    }
    @GetMapping("/orders/{id}")
    public Object order(@PathVariable UUID id) { Actor a=Actor.current(); a.require("ORDER"); return db.tx(a,() -> orders.detail(a,id)); }
    @PostMapping("/orders")
    public Object create(@Valid @RequestBody CreateOrder body,@RequestHeader(value="Idempotency-Key",required=false) String key) {
        Actor a=Actor.current(); a.require("ORDER");
        return keys.execute(a,key,"POST /orders",body,false,() -> db.outlet(a,body.outletId()),() -> orders.create(a,body));
    }
    @PostMapping("/orders/{id}/items")
    public Object add(@PathVariable UUID id,@Valid @RequestBody AddItem body,@RequestHeader(value="Idempotency-Key",required=false) String key) {
        Actor a=Actor.current(); a.require("ORDER");
        return keys.execute(a,key,"POST /orders/"+id+"/items",body,false,() -> scope.order(a,id,false),() -> orders.add(a,id,body));
    }
    @PatchMapping("/orders/{id}")
    public Object edit(@PathVariable UUID id,@Valid @RequestBody EditOrder body,@RequestHeader(value="Idempotency-Key",required=false) String key) {
        Actor a=Actor.current(); a.require("ORDER");
        return keys.execute(a,key,"PATCH /orders/"+id,body,body.discount()!=null,() -> scope.order(a,id,false),() -> orders.edit(a,id,body));
    }
    @PatchMapping("/orders/{id}/items/{itemId}")
    public Object editItem(@PathVariable UUID id,@PathVariable UUID itemId,@Valid @RequestBody EditItem body,@RequestHeader(value="Idempotency-Key",required=false) String key) {
        Actor a=Actor.current(); a.require("ORDER");
        return keys.execute(a,key,"PATCH /orders/"+id+"/items/"+itemId,body,false,() -> scope.order(a,id,false),() -> orders.editItem(a,id,itemId,body));
    }
    @PostMapping("/orders/{id}/items/{itemId}/cancel")
    public Object cancelItem(@PathVariable UUID id,@PathVariable UUID itemId,@Valid @RequestBody RemoveItem body,@RequestHeader(value="Idempotency-Key",required=false) String key) {
        Actor a=Actor.current(); if (!a.can("CANCEL")) a.require("ORDER");
        return keys.execute(a,key,"POST /orders/"+id+"/items/"+itemId+"/cancel",body,true,() -> scope.order(a,id,false),() -> orders.cancelItem(a,id,itemId,body));
    }
    @PostMapping("/orders/{id}/transfer")
    public Object transfer(@PathVariable UUID id,@Valid @RequestBody Transfer body,@RequestHeader(value="Idempotency-Key",required=false) String key) {
        Actor a=Actor.current(); a.require("TRANSFER");
        return keys.execute(a,key,"POST /orders/"+id+"/transfer",body,false,() -> scope.order(a,id,false),() -> orders.transfer(a,id,body));
    }
    @PostMapping("/orders/{id}/cancel")
    public Object cancelOrder(@PathVariable UUID id,@Valid @RequestBody Cancel body,@RequestHeader(value="Idempotency-Key",required=false) String key) {
        Actor a=Actor.current(); a.require("CANCEL");
        return keys.execute(a,key,"POST /orders/"+id+"/cancel",body,true,() -> scope.order(a,id,false),() -> orders.cancel(a,id,body));
    }
    @PostMapping("/orders/{id}/send")
    public Object send(@PathVariable UUID id,@Valid @RequestBody SendKot body,@RequestHeader(value="Idempotency-Key",required=false) String key) {
        Actor a=Actor.current(); a.require("ORDER");
        return keys.execute(a,key,"POST /orders/"+id+"/send",body,true,() -> scope.order(a,id,false),() -> orders.send(a,id,body));
    }
    @PostMapping("/orders/{id}/bills")
    public Object createBills(@PathVariable UUID id,@Valid @RequestBody CreateBills body,@RequestHeader(value="Idempotency-Key",required=false) String key) {
        Actor a=Actor.current(); a.require("BILL");
        return keys.execute(a,key,"POST /orders/"+id+"/bills",body,true,() -> scope.order(a,id,false),() -> bills.create(a,id,body));
    }
    @GetMapping("/kots")
    public Object kots(@RequestParam UUID outletId) {
        Actor a=Actor.current();
        if (!a.can("KITCHEN") && !a.can("REPRINT_KOT") && !a.can("REPRINT_NC_KOT")) a.require("KITCHEN");
        return db.tx(a,() -> orders.kots(a,outletId)).stream().filter(kot -> a.can("KITCHEN") ||
                (kot.get("nc_department_id") == null ? a.can("REPRINT_KOT") : a.can("REPRINT_NC_KOT"))).toList();
    }
    @PostMapping("/kots/{id}/status")
    public Object kotStatus(@PathVariable UUID id,@Valid @RequestBody KotStatus body,@RequestHeader(value="Idempotency-Key",required=false) String key) {
        Actor a=Actor.current(); a.require("KITCHEN");
        return keys.execute(a,key,"POST /kots/"+id+"/status",body,false,() -> scope.kot(a,id,false),() -> orders.status(a,id,body.status()));
    }
    @PostMapping("/kots/{id}/void-items")
    public Object voidKotItems(@PathVariable UUID id,@Valid @RequestBody VoidKotItems body,@RequestHeader(value="Idempotency-Key",required=false) String key) {
        Actor a=Actor.current(); a.require("CANCEL");
        return keys.execute(a,key,"POST /kots/"+id+"/void-items",body,true,() -> scope.kot(a,id,false),() -> orders.voidKotItems(a,id,body));
    }
    @PostMapping("/kots/{id}/cancel")
    public Object cancelKot(@PathVariable UUID id,@Valid @RequestBody Reason body,@RequestHeader(value="Idempotency-Key",required=false) String key) {
        Actor a=Actor.current(); a.require("CANCEL");
        return keys.execute(a,key,"POST /kots/"+id+"/cancel",body,true,() -> scope.kot(a,id,false),() -> orders.cancelKot(a,id,body.reason()));
    }
    @PostMapping("/kots/{id}/reprint")
    public Object reprintKot(@PathVariable UUID id,@Valid @RequestBody Reason body,@RequestHeader(value="Idempotency-Key",required=false) String key) {
        Actor a=Actor.current();
        return keys.execute(a,key,"POST /kots/"+id+"/reprint",body,true,() -> scope.kot(a,id,false),() -> orders.reprintKot(a,id,body.reason()));
    }
    @GetMapping("/bills")
    public Object bills(@RequestParam UUID outletId) { Actor a=Actor.current(); a.require("BILL"); return db.tx(a,() -> bills.list(a,outletId)); }
    @GetMapping("/bills/{id}")
    public Object bill(@PathVariable UUID id) { Actor a=Actor.current(); a.require("BILL"); return db.tx(a,() -> bills.detail(a,id)); }
    @PostMapping("/bills/{id}/settle")
    public Object settle(@PathVariable UUID id,@Valid @RequestBody Settle body,@RequestHeader(value="Idempotency-Key",required=false) String key) {
        Actor a=Actor.current(); a.require("BILL");
        return keys.execute(a,key,"POST /bills/"+id+"/settle",body,true,() -> scope.bill(a,id,false),() -> bills.settle(a,id,body));
    }
    @PostMapping("/bills/{id}/cancel")
    public Object cancelBill(@PathVariable UUID id,@Valid @RequestBody Cancel body,@RequestHeader(value="Idempotency-Key",required=false) String key) {
        Actor a=Actor.current(); a.require("CANCEL");
        return keys.execute(a,key,"POST /bills/"+id+"/cancel",body,true,() -> scope.bill(a,id,false),() -> bills.cancel(a,id,body));
    }
    @PostMapping("/bills/{id}/correct-payment")
    public Object correctPayment(@PathVariable UUID id,@Valid @RequestBody CorrectPayment body,@RequestHeader(value="Idempotency-Key",required=false) String key) {
        Actor a=Actor.current(); a.require("BILL"); a.require("CANCEL");
        return keys.execute(a,key,"POST /bills/"+id+"/correct-payment",body,true,() -> scope.bill(a,id,false),() -> bills.correctPayment(a,id,body));
    }
    @PostMapping("/bills/{id}/reverse")
    public Object reverseBill(@PathVariable UUID id,@Valid @RequestBody ReverseBill body,@RequestHeader(value="Idempotency-Key",required=false) String key) {
        Actor a=Actor.current(); a.require("BILL"); a.require("CANCEL");
        if(body.reopen()) a.require("ORDER");
        return keys.execute(a,key,"POST /bills/"+id+"/reverse",body,true,() -> scope.bill(a,id,false),() -> bills.reverse(a,id,body));
    }
    @PostMapping("/bills/{id}/modify")
    public Object modifyBill(@PathVariable UUID id,@Valid @RequestBody ModifyBill body,@RequestHeader(value="Idempotency-Key",required=false) String key) {
        Actor a=Actor.current(); a.require("DISCOUNT"); a.require("CANCEL");
        return keys.execute(a,key,"POST /bills/"+id+"/modify",body,true,() -> scope.bill(a,id,false),() -> bills.modify(a,id,body));
    }
    @PostMapping("/bills/{id}/reprint")
    public Object reprintBill(@PathVariable UUID id,@Valid @RequestBody Reason body,@RequestHeader(value="Idempotency-Key",required=false) String key) {
        Actor a=Actor.current(); a.require("REPRINT_BILL");
        return keys.execute(a,key,"POST /bills/"+id+"/reprint",body,true,() -> scope.bill(a,id,false),() -> bills.reprint(a,id,body.reason()));
    }
    @PostMapping("/bills/{id}/print-preview")
    public Object printBillPreview(@PathVariable UUID id,@Valid @RequestBody Reason body,@RequestHeader(value="Idempotency-Key",required=false) String key) {
        Actor a=Actor.current(); a.require("PRINT_BILL");
        return keys.execute(a,key,"POST /bills/"+id+"/print-preview",body,true,() -> scope.bill(a,id,false),() -> bills.printPreview(a,id,body.reason()));
    }
}
