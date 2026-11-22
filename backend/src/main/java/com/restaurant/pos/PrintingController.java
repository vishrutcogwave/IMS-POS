package com.restaurant.pos;

import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;
import java.util.*;
import static com.restaurant.pos.OperationsDtos.*;

@RestController
@RequestMapping("/api/printing")
public class PrintingController {
    private final TenantJdbc db;
    private final OperationsSupport scope;
    private final OperationsIdempotency keys;
    private final PrintingService printing;
    public PrintingController(TenantJdbc db,OperationsSupport scope,OperationsIdempotency keys,PrintingService printing) { this.db=db; this.scope=scope; this.keys=keys; this.printing=printing; }
    @PostMapping("/preview")
    public Object preview(@Valid @RequestBody Preview body) { Actor a=Actor.current(); a.require("PRINT"); return db.tx(a,() -> printing.preview(a,body)); }
    @GetMapping("/jobs")
    public Object jobs(@RequestParam UUID outletId) { Actor a=Actor.current(); a.require("PRINT"); return db.tx(a,() -> printing.jobs(a,outletId)); }
    @PostMapping("/printers/{id}/test")
    public Object test(@PathVariable UUID id,@RequestHeader(value="Idempotency-Key",required=false) String key) {
        Actor a=Actor.current(); a.require("PRINT");
        return keys.execute(a,key,"POST /printing/printers/"+id+"/test",Map.of(),true,() -> scope.printer(a,id),() -> printing.test(a,id));
    }
    @PostMapping("/jobs/{id}/retry")
    public Object retry(@PathVariable UUID id,@Valid @RequestBody Reason body,@RequestHeader(value="Idempotency-Key",required=false) String key) {
        Actor a=Actor.current(); a.require("PRINT");
        return keys.execute(a,key,"POST /printing/jobs/"+id+"/retry",body,true,() -> scope.job(a,id,false),() -> printing.retry(a,id,body.reason()));
    }
    @PostMapping("/local/claim")
    public Object claimLocal(@RequestParam UUID outletId) {
        Actor a=Actor.current(); a.require("PRINT");
        return db.tx(a,() -> printing.claimLocal(a,outletId));
    }
    @PostMapping("/claim")
    public Object claim(@Valid @RequestBody Claim body) { Actor a=Actor.current(); a.require("PRINT"); return db.tx(a,() -> printing.claim(a,body)); }
    @PostMapping("/jobs/{id}/ack")
    public Object ack(@PathVariable UUID id,@Valid @RequestBody Ack body) { Actor a=Actor.current(); a.require("PRINT"); return db.tx(a,() -> printing.ack(a,id,body)); }
}
