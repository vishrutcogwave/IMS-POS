package com.restaurant.pos;

import org.springframework.stereotype.Service;
import java.time.Instant;
import java.util.*;
import static com.restaurant.pos.OperationsSupport.*;

@Service
public class PrintingService {
    private final TenantJdbc db;
    private final OperationsSupport support;
    public PrintingService(TenantJdbc db,OperationsSupport support) { this.db=db; this.support=support; }

    private String printPc(Actor actor, UUID outlet) {
        var request = org.springframework.web.context.request.RequestContextHolder.getRequestAttributes();
        if (request instanceof org.springframework.web.context.request.ServletRequestAttributes servlet) {
            String pc = servlet.getRequest().getHeader("X-Print-PC");
            if (pc != null && pc.matches("[a-f0-9]{32}") && !db.list(
                    "select id from printers where tenant_id=? and outlet_id=? and pc_id=? limit 1",
                    actor.tenantId(), outlet, pc).isEmpty()) return pc;
        }
        return text(db.one("select default_print_pc from outlets where tenant_id=? and id=?",
                actor.tenantId(), outlet).get("default_print_pc"));
    }

    private Map<String,Object> designatedPc(Actor actor, UUID outlet) {
        db.list("select id from outlets where tenant_id=? and id=? for share",actor.tenantId(),outlet);
        return db.list("""
                select p.id,p.branch_id from print_pcs p join outlets o
                on (o.tenant_id,o.branch_id)=(p.tenant_id,p.branch_id)
                where o.tenant_id=? and o.id=?
                """,actor.tenantId(),outlet).stream().findFirst().orElse(null);
    }

    private String localPrintPc() {
        var request = org.springframework.web.context.request.RequestContextHolder.getRequestAttributes();
        if (request instanceof org.springframework.web.context.request.ServletRequestAttributes servlet) {
            String pc = servlet.getRequest().getHeader("X-Local-Print-PC");
            if (pc != null && pc.matches("[a-f0-9]{32}")) return pc;
        }
        return null;
    }

    private Map<String,Object> localPrinter(Actor actor, UUID outlet, String pc) {
        String alias = "local-" + pc;
        String name = "Local Windows bridge " + pc;
        db.update("""
                insert into printers(id,tenant_id,outlet_id,name,device_key,document_type,pc_id)
                values(?,?,?,?,?,'BOTH',?) on conflict (tenant_id,outlet_id,name) do nothing
                """, UUID.randomUUID(),actor.tenantId(),outlet,name,alias,pc);
        return db.one("select * from printers where tenant_id=? and outlet_id=? and name=? and pc_id=? and device_key=? and enabled",
                actor.tenantId(),outlet,name,pc,alias);
    }
    Map<String,Object> route(Actor a,UUID outlet,UUID category) {
        db.outlet(a,outlet);
        String pc = printPc(a, outlet);
        db.one("select id from categories where tenant_id=? and outlet_id=? and id=?",a.tenantId(),outlet,category);
        var target = designatedPc(a,outlet);
        String localPc = target == null ? (a.can("PRINT") ? localPrintPc() : null) : id(target).toString().replace("-","");
        if (localPc != null) return localPrinter(a,outlet,localPc);
        List<Map<String,Object>> printers=db.list("select p.* from category_routes r join printers p on p.tenant_id=r.tenant_id and p.outlet_id=r.outlet_id and p.id=r.printer_id where r.tenant_id=? and p.tenant_id=? and r.outlet_id=? and r.category_id=? and r.pc_id=? and p.enabled and p.document_type in ('KOT','BOTH')",a.tenantId(),a.tenantId(),outlet,category,pc);
        if(printers.isEmpty()) printers=defaultPrinters(a,outlet,pc,"KOT");
        if(printers.isEmpty()) return null;
        validateAlias(printers.get(0)); return printers.get(0);
    }
    List<Map<String,Object>> receiptPrinters(Actor a,UUID outlet) {
        db.outlet(a,outlet);
        var target = designatedPc(a,outlet);
        String localPc = target == null ? (a.can("PRINT") ? localPrintPc() : null) : id(target).toString().replace("-","");
        if (localPc != null) return List.of(localPrinter(a,outlet,localPc));
        List<Map<String,Object>> printers=db.list("select * from printers where tenant_id=? and outlet_id=? and coalesce(pc_id,'')=? and enabled and is_receipt and document_type in ('BILL','BOTH') order by id",a.tenantId(),outlet,printPc(a,outlet));
        if(printers.isEmpty()) printers=defaultPrinters(a,outlet,printPc(a,outlet),"BILL");
        if(printers.isEmpty()) throw new ApiException(422,"Pair a Windows print bridge or configure an enabled receipt printer before settling a bill.");
        printers.forEach(this::validateAlias); return printers;
    }
    private List<Map<String,Object>> defaultPrinters(Actor actor, UUID outlet, String pc, String document) {
        return db.list("select * from printers where tenant_id=? and outlet_id=? and coalesce(pc_id,'')=? and enabled and is_fallback and document_type in (?, 'BOTH')",
                actor.tenantId(), outlet, pc, document);
    }
    private void validateAlias(Map<String,Object> printer) {
        if(!text(printer.get("device_key")).matches("[A-Za-z0-9][A-Za-z0-9_.-]{0,99}"))
            throw new ApiException(422,"Printer device key must be a local device alias");
    }
    Map<String,Object> enqueue(Actor a,UUID outlet,UUID printerId,String type,UUID reference,UUID original,Object payload) {
        db.outlet(a,outlet);
        Map<String,Object> printer=db.one("select * from printers where tenant_id=? and outlet_id=? and id=?",a.tenantId(),outlet,printerId);
        validateAlias(printer);
        if(original!=null) db.one("select id from print_jobs where tenant_id=? and outlet_id=? and id=?",a.tenantId(),outlet,original);
        UUID job=UUID.randomUUID();
        var target = designatedPc(a,outlet);
        if (target == null) {
            db.update("insert into print_jobs(id,tenant_id,outlet_id,printer_id,document_type,reference_id,original_job_id,payload) values(?,?,?,?,?,?,?,?::jsonb)",
                    job,a.tenantId(),outlet,printerId,type,reference,original,db.json(payload));
        } else {
            db.update("""
                    insert into print_jobs(id,tenant_id,outlet_id,printer_id,document_type,reference_id,original_job_id,payload,
                        target_branch_id,target_pc_id,expires_at)
                    values(?,?,?,?,?,?,?,?::jsonb,?,?,now()+(? * interval '1 minute'))
                    """,job,a.tenantId(),outlet,printerId,type,reference,original,db.json(payload),
                    id(target.get("branch_id")),id(target),type.startsWith("KOT")?20:1440);
        }
        return support.job(a,job,false);
    }
    Map<String,Object> payload(Actor a,Map<String,Object> order,String title,String reference,List<Map<String,Object>> lines) {
        UUID outletId=id(order.get("outlet_id"));
        Map<String,Object> outlet=support.outlet(a,outletId);
        Map<String,Object> tenant=db.one("select name,receipt_address,tax_number,phone,receipt_footer from tenants where id=?",a.tenantId());
        String table="";
        if(order.get("table_id")!=null) table=text(db.one("select name from restaurant_tables where tenant_id=? and outlet_id=? and id=?",a.tenantId(),outletId,id(order.get("table_id"))).get("name"));
        Map<String,Object> result=new LinkedHashMap<>();
        result.put("title",title); result.put("reference",reference); result.put("outlet",outlet.get("name")); result.put("businessName",tenant.get("name"));
        result.put("order",order.get("number")); result.put("table",table); result.put("serviceMode",order.get("service_mode")); result.put("customerName",order.get("customer_name"));
        result.put("createdAt",Instant.now().toString()); result.put("address",tenant.get("receipt_address")); result.put("taxNumber",tenant.get("tax_number"));
        result.put("phone",tenant.get("phone")); result.put("footer",tenant.get("receipt_footer")); result.put("currency",outlet.get("currency"));
        List<Map<String,Object>> printLines=new ArrayList<>();
        for(Map<String,Object> line:lines) {
            Map<String,Object> p=new LinkedHashMap<>();
            p.put("categoryId",line.get("category_id")); p.put("name",line.get("name")); p.put("quantity",line.get("quantity")); p.put("unitPrice",line.get("unit_price"));
            p.put("variant",line.get("variant")); p.put("modifiers",line.get("modifiers")); p.put("notes",line.get("notes"));
            for(String key:List.of("subtotal","discount","tax","total")) if(line.containsKey(key)) p.put(key,line.get(key));
            printLines.add(p);
        }
        result.put("waiterName", text(order.get("waiter_name")));
        result.put("covers", order.get("covers"));
        result.put("notes",order.get("notes")); result.put("lines",printLines); return result;
    }
    Map<String,Object> original(Actor a,UUID outlet,String type,UUID reference) {
        db.outlet(a,outlet);
        List<Map<String,Object>> jobs=db.list("select * from print_jobs where tenant_id=? and outlet_id=? and document_type=? and reference_id=? and original_job_id is null order by created_at,id limit 1",a.tenantId(),outlet,type,reference);
        if(jobs.isEmpty()) throw new ApiException(409,"No original printable document exists for this reference");
        return jobs.get(0);
    }
    Map<String,Object> currentBillReceipt(Actor a,UUID outlet,UUID bill) {
        var corrected=db.list("select * from print_jobs where tenant_id=? and outlet_id=? and document_type='BILL' and reference_id=? and payload->>'title'='CORRECTED RECEIPT' order by (payload->>'billVersion')::integer desc, id limit 1",a.tenantId(),outlet,bill);
        return corrected.isEmpty() ? original(a,outlet,"BILL",bill) : corrected.getFirst();
    }

    void supersedePendingBillReceipts(Actor a,UUID outlet,UUID bill,String reason) {
        db.update("update print_jobs set status='FAILED',error=?,completed_at=now() where tenant_id=? and outlet_id=? and document_type='BILL' and reference_id=? and status='PENDING'",
                reason,a.tenantId(),outlet,bill);
    }

    Map<String,Object> reprint(Actor a,UUID outlet,String type,UUID reference,String reason) {
        reason(reason);
        Map<String,Object> original="BILL".equals(type) ? currentBillReceipt(a,outlet,reference) : original(a,outlet,type,reference);
        Map<String,Object> payload=object(original.get("payload"));
        payload.put("title","REPRINT - "+text(payload.get("title"))); payload.put("originalReference",payload.get("reference")); payload.put("reprintReason",reason);
        List<UUID> targets = "BILL".equals(type) ? receiptPrinters(a,outlet).stream().map(OperationsSupport::id).toList()
                : List.of(id(original.get("printer_id")));
        List<Map<String,Object>> jobs = new ArrayList<>();
        for (UUID target : targets) jobs.add(enqueue(a,outlet,target,type,reference,id(original),payload));
        db.audit(a,outlet,type+"_REPRINT",type,reference,reason,Map.of("original_job_id",original.get("id"),
                "job_id",jobs.get(0).get("id"), "job_ids",jobs.stream().map(job -> job.get("id")).toList()));
        return jobs.get(0);
    }
    void cancelKotJob(Actor a,Map<String,Object> kot,String reason,List<Map<String,Object>> lines,boolean entireOriginal) {
        UUID outlet=id(kot.get("outlet_id"));
        Map<String,Object> original=original(a,outlet,"KOT",id(kot));
        if(entireOriginal) db.update("update print_jobs set status='FAILED',error='Superseded by KOT cancellation; retry the cancellation document instead',completed_at=now() where tenant_id=? and outlet_id=? and reference_id=? and document_type='KOT' and status='PENDING'",a.tenantId(),outlet,id(kot));
        Map<String,Object> payload=object(original.get("payload")); payload.put("title","VOID KOT");
        payload.put("originalReference",kot.get("number")); payload.put("reason",reason); payload.put("lines",lines);
        enqueue(a,outlet,id(original.get("printer_id")),"KOT_CANCEL",id(kot),id(original),payload);
    }
    public Map<String,Object> preview(Actor a,OperationsDtos.Preview request) {
        db.outlet(a,request.outletId());
        Map<UUID,Map<String,Object>> groups=new LinkedHashMap<>(); List<Map<String,Object>> unmapped=new ArrayList<>();
        for(OperationsDtos.PreviewItem input:request.items()) {
            Map<String,Object> menu=support.menu(a,request.outletId(),input.menuItemId());
            Map<String,Object> item=new LinkedHashMap<>(); item.put("menu_item_id",menu.get("id")); item.put("name",menu.get("name")); item.put("quantity",input.quantity());
            Map<String,Object> printer=route(a,request.outletId(),id(menu.get("category_id")));
            if(printer==null) { unmapped.add(item); continue; }
            Map<String,Object> group=groups.computeIfAbsent(id(printer),key -> { Map<String,Object> g=new LinkedHashMap<>(); g.put("printer",printer); g.put("items",new ArrayList<Map<String,Object>>()); return g; });
            objects(group.get("items")).add(item);
        }
        return Map.of("groups",new ArrayList<>(groups.values()),"unmapped",unmapped);
    }
    void expire(Actor a,UUID outlet) {
        db.outlet(a,outlet);
        db.update("update print_jobs set status='UNCERTAIN',error='Claim expired; output may have occurred. Explicit duplicate-aware retry required.',completed_at=now() where tenant_id=? and outlet_id=? and target_pc_id is null and status='CLAIMED' and claimed_at < now()-interval '120 seconds'",a.tenantId(),outlet);
    }
    public List<Map<String,Object>> jobs(Actor a,UUID outlet) {
        db.outlet(a,outlet); expire(a,outlet);
        return db.list("select j.id,j.outlet_id,j.printer_id,j.document_type,j.reference_id,j.original_job_id,j.payload,j.status,j.attempts,j.error,j.claimed_at,j.completed_at,j.created_at,p.name as printer_name,p.device_key from print_jobs j join printers p on p.tenant_id=j.tenant_id and p.outlet_id=j.outlet_id and p.id=j.printer_id where j.tenant_id=? and p.tenant_id=? and j.outlet_id=? order by j.created_at desc,j.id desc limit 100",a.tenantId(),a.tenantId(),outlet);
    }
    public Map<String,Object> test(Actor a,UUID printerId) {
        Map<String,Object> printer=support.printer(a,printerId);
        if(!Boolean.TRUE.equals(printer.get("enabled"))) throw new ApiException(422,"Printer is disabled");
        UUID outlet=id(printer.get("outlet_id"));
        Map<String,Object> payload=new LinkedHashMap<>(); payload.put("title","PRINTER TEST"); payload.put("reference","TEST-"+UUID.randomUUID());
        payload.put("outlet",support.outlet(a,outlet).get("name")); payload.put("order",""); payload.put("table",""); payload.put("createdAt",Instant.now().toString());
        payload.put("lines",List.of(Map.of("name","Connection test - transport acceptance is not paper confirmation","quantity",1)));
        Map<String,Object> job=enqueue(a,outlet,printerId,"TEST",null,null,payload);
        db.audit(a,outlet,"PRINT_TEST","PRINT_JOB",id(job),"",Map.of("printer_id",printerId)); return job;
    }
    public Map<String,Object> retry(Actor a,UUID jobId,String reason) {
        reason(reason);
        if(!reason.toLowerCase(Locale.ROOT).contains("duplicate")) throw new ApiException(422,"Reason must explicitly acknowledge possible duplicate output (include 'duplicate')");
        Map<String,Object> prior=support.job(a,jobId,true); UUID outlet=id(prior.get("outlet_id"));
        if(!Set.of("FAILED","UNCERTAIN").contains(text(prior.get("status")))) throw new ApiException(409,"Only FAILED or UNCERTAIN jobs can be explicitly retried");
        if ("KOT".equals(prior.get("document_type"))) {
            Map<String,Object> kot = support.kot(a,id(prior.get("reference_id")),true);
            if ("CANCELLED".equals(kot.get("status"))) throw new ApiException(409,"Cancelled KOTs cannot be retried as kitchen orders; retry the cancellation document instead");
        }
        if ("BILL".equals(prior.get("document_type"))) {
            UUID billId=id(prior.get("reference_id"));
            Map<String,Object> bill=support.bill(a,billId,false);
            if (!"PAID".equals(bill.get("status")) || !Objects.equals(
                    object(prior.get("payload")).get("billVersion"),
                    object(currentBillReceipt(a,outlet,billId).get("payload")).get("billVersion")))
                throw new ApiException(409,"This receipt was superseded by a payment correction or reversal.");
        }
        Map<String,Object> printer=support.printer(a,id(prior.get("printer_id")));
        if(!Boolean.TRUE.equals(printer.get("enabled"))) throw new ApiException(422,"Enable the printer before retrying");
        if(!db.list("select id from print_jobs where tenant_id=? and outlet_id=? and original_job_id=? and status in ('PENDING','CLAIMED')",a.tenantId(),outlet,jobId).isEmpty()) throw new ApiException(409,"A retry of this job is already queued");
        Map<String,Object> result=enqueue(a,outlet,id(prior.get("printer_id")),text(prior.get("document_type")),prior.get("reference_id")==null?null:id(prior.get("reference_id")),jobId,prior.get("payload"));
        db.audit(a,outlet,"PRINT_RETRY","PRINT_JOB",id(result),reason,Map.of("original_job_id",jobId)); return result;
    }
    public Map<String,Object> claim(Actor a,OperationsDtos.Claim request) {
        UUID outlet=request.outletId(); db.outlet(a,outlet);
        if (designatedPc(a,outlet) != null) return Map.of("jobs", List.of());
        if(!"KITCHEN".equals(a.role())) throw new ApiException(403,"Print claims require a dedicated KITCHEN account");
        List<Map<String,Object>> assignments=db.list("select outlet_id from user_outlets where tenant_id=? and user_id=?",a.tenantId(),a.userId());
        boolean branchAgent = a.permissions().equals(List.of("PRINT"));
        if (branchAgent) {
            var branches = db.list("select distinct o.branch_id from user_outlets u join outlets o on o.tenant_id=u.tenant_id and o.id=u.outlet_id where u.tenant_id=? and u.user_id=?", a.tenantId(), a.userId());
            if (branches.size()!=1 || assignments.stream().noneMatch(row -> outlet.equals(id(row.get("outlet_id"))))) {
                throw new ApiException(403,"Print bridge must be assigned to this outlet within one branch.");
            }
        } else if(assignments.size()!=1 || !outlet.equals(id(assignments.get(0).get("outlet_id")))) {
            throw new ApiException(403,"Print agent must be assigned to exactly this outlet");
        }
        Set<String> keys=new LinkedHashSet<>(request.deviceKeys());
        Set<String> configured=new HashSet<>();
        db.list("select device_key from printers where tenant_id=? and outlet_id=? and enabled",a.tenantId(),outlet).forEach(p -> configured.add(text(p.get("device_key"))));
        if (branchAgent) keys.retainAll(configured);
        else if(!configured.containsAll(keys)) throw new ApiException(403,"A requested device alias is not enabled in the authenticated outlet");
        if (keys.isEmpty()) return Map.of("jobs", List.of());
        return claimDevices(a,outlet,keys);
    }

    public Map<String,Object> claimLocal(Actor a, UUID outlet) {
        db.outlet(a,outlet);
        if (designatedPc(a,outlet) != null) return Map.of("jobs", List.of());
        String pc = localPrintPc();
        if (pc == null) throw new ApiException(422,"Connect this PC to the Windows print bridge.");
        return claimDevices(a,outlet,Set.of("local-" + pc));
    }

    private Map<String,Object> claimDevices(Actor a, UUID outlet, Set<String> keys) {
        expire(a,outlet);
        String placeholders=String.join(",",Collections.nCopies(keys.size(),"?"));
        List<Object> args=new ArrayList<>(List.of(a.tenantId(),a.tenantId(),outlet)); args.addAll(keys);
        List<Map<String,Object>> pending=db.list("select j.id from print_jobs j join printers p on p.tenant_id=j.tenant_id and p.outlet_id=j.outlet_id and p.id=j.printer_id where j.tenant_id=? and p.tenant_id=? and j.outlet_id=? and j.status='PENDING' and j.target_pc_id is null and p.enabled and p.device_key in ("+placeholders+") order by j.created_at,j.id limit 1 for update of j skip locked",args.toArray());
        List<Map<String,Object>> result=new ArrayList<>();
        for(Map<String,Object> pendingJob:pending) {
            UUID jobId=id(pendingJob),token=UUID.randomUUID();
            db.update("update print_jobs set status='CLAIMED',claimed_by=?,claim_token=?,claimed_at=now(),attempts=attempts+1,error='' where tenant_id=? and outlet_id=? and id=? and status='PENDING'",a.userId(),token,a.tenantId(),outlet,jobId);
            result.add(db.one("select j.*,p.name as printer_name,p.device_key,p.paper_width,p.copies,p.template from print_jobs j join printers p on p.tenant_id=j.tenant_id and p.outlet_id=j.outlet_id and p.id=j.printer_id where j.tenant_id=? and p.tenant_id=? and j.outlet_id=? and j.id=?",a.tenantId(),a.tenantId(),outlet,jobId));
        }
        return Map.of("jobs",result);
    }
    public Map<String,Object> ack(Actor a,UUID jobId,OperationsDtos.Ack request) {
        Map<String,Object> job=support.job(a,jobId,true); UUID outlet=id(job.get("outlet_id"));
        if(!a.userId().toString().equals(text(job.get("claimed_by"))) || !request.claimToken().toString().equals(text(job.get("claim_token")))) throw new ApiException(403,"Claim owner and token do not match");
        if(!"CLAIMED".equals(job.get("status"))) {
            if(request.status().equals(job.get("status"))) return job;
            throw new ApiException(409,"Print job is no longer claimed; refresh its status");
        }
        boolean stale=Boolean.TRUE.equals(db.one("select claimed_at < now()-interval '120 seconds' as stale from print_jobs where tenant_id=? and outlet_id=? and id=?",a.tenantId(),outlet,jobId).get("stale"));
        String status=stale?"UNCERTAIN":request.status();
        String error=stale?"Late acknowledgment: claim expired and physical output is uncertain":text(request.error());
        if(!"PRINTED".equals(status) && error.isBlank()) error="Print agent reported "+status;
        db.update("update print_jobs set status=?,error=?,completed_at=now() where tenant_id=? and outlet_id=? and id=? and claimed_by=? and claim_token=? and status='CLAIMED'",status,error,a.tenantId(),outlet,jobId,a.userId(),request.claimToken());
        db.update("update printers set last_seen_at=now() where tenant_id=? and outlet_id=? and id=?",a.tenantId(),outlet,id(job.get("printer_id")));
        return support.job(a,jobId,false);
    }
}
