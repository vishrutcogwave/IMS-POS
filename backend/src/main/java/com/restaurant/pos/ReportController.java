package com.restaurant.pos;

import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.UUID;

@RestController
@RequestMapping("/api")
public class ReportController {
    private final TenantJdbc db;
    private final ReportService reports;
    public ReportController(TenantJdbc db,ReportService reports) { this.db=db; this.reports=reports; }
    @GetMapping("/dashboard")
    public Object dashboard(@RequestParam UUID outletId,@RequestParam(required=false) String from,@RequestParam(required=false) String to) {
        Actor a=Actor.current(); a.require("DASHBOARD"); return db.tx(a,() -> reports.dashboard(a,outletId,from,to));
    }
    @GetMapping("/reports/{type}")
    public Object report(@PathVariable String type,@RequestParam UUID outletId,@RequestParam(required=false) String from,@RequestParam(required=false) String to,
            @RequestParam(defaultValue="0") int page,@RequestParam(defaultValue="25") int size) {
        Actor a=Actor.current(); a.require("REPORT"); return db.tx(a,() -> reports.report(a,outletId,type,from,to,page,size));
    }
    @GetMapping("/reports/{type}/export")
    public ResponseEntity<byte[]> export(@PathVariable String type,@RequestParam UUID outletId,@RequestParam(required=false) String from,@RequestParam(required=false) String to) {
        Actor a=Actor.current(); a.require("REPORT");
        byte[] bytes=db.tx(a,() -> reports.export(a,outletId,type,from,to));
        // ReportService validates the type against its closed whitelist before constructing a filename.
        return ResponseEntity.ok().header(HttpHeaders.CONTENT_DISPOSITION,"attachment; filename=\""+type+".csv\"")
                .contentType(MediaType.parseMediaType("text/csv;charset=UTF-8")).body(bytes);
    }
}
