package com.restaurant.pos;

import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import com.fasterxml.jackson.databind.JsonNode;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.util.*;
import java.util.function.Function;
import org.springframework.http.HttpStatus;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.web.bind.annotation.*;
import static com.restaurant.pos.OperationsSupport.*;

@RestController
@EnableScheduling
@RequestMapping("/api/print-device")
public class PrintDeviceController {
    private final TenantJdbc db;
    private final SecureRandom random = new SecureRandom();

    public PrintDeviceController(TenantJdbc db) { this.db = db; }

    record Pair(@NotBlank @Size(max=160) String code) {}
    record Start(@NotNull UUID jobId, @NotNull UUID claimToken, @NotNull JsonNode plan) {}
    record Result(@NotNull UUID jobId, @NotNull UUID claimToken, @NotNull JsonNode deliveries,
                  @NotBlank @Pattern(regexp="PRINTED|FAILED|UNCERTAIN") String status, @Size(max=500) String error,
                  boolean retryable) {}
    private record Device(UUID tenant, UUID id, UUID branch) {}

    @PostMapping("/branches/{branch}/pairing")
    public Object pairing(@PathVariable UUID branch) {
        Actor actor = admin();
        return db.tx(actor, () -> {
            db.one("select id from branches where tenant_id=? and id=?",actor.tenantId(),branch);
            String secret = secret();
            db.update("""
                insert into print_pc_pairings(tenant_id,branch_id,code_hash,expires_at) values(?,?,?,now()+interval '10 minutes')
                on conflict(tenant_id,branch_id) do update set code_hash=excluded.code_hash,expires_at=excluded.expires_at
                """,actor.tenantId(),branch,hash(secret));
            return Map.of("code",actor.tenantId()+"."+branch+"."+secret);
        });
    }

    @DeleteMapping("/branches/{branch}/pairing")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void disconnect(@PathVariable UUID branch) {
        Actor actor = admin();
        db.tx(actor, () -> {
            db.update("update print_pcs set credential_hash=?,last_seen_at=null where tenant_id=? and branch_id=?",
                    hash(secret()),actor.tenantId(),branch);
            db.update("delete from print_pc_pairings where tenant_id=? and branch_id=?",actor.tenantId(),branch);
            return null;
        });
    }

    @PostMapping("/pair")
    public Object pair(@RequestHeader("Authorization") String authorization,@Valid @RequestBody Pair body) {
        if (!MessageDigest.isEqual(("Bearer "+body.code()).getBytes(StandardCharsets.US_ASCII),authorization.getBytes(StandardCharsets.US_ASCII))) throw unauthorized();
        String[] parts = parts(body.code());
        UUID tenant = uuid(parts[0]), branch = uuid(parts[1]);
        return db.asTenant(tenant, () -> {
            if (db.update("delete from print_pc_pairings where tenant_id=? and branch_id=? and code_hash=? and expires_at>now()",
                    tenant,branch,hash(parts[2])) != 1) throw unauthorized();
            db.list("select id from outlets where tenant_id=? and branch_id=? order by id for update",tenant,branch);
            if (!db.list("""
                    select j.id from print_jobs j join outlets o on (o.tenant_id,o.id)=(j.tenant_id,j.outlet_id)
                    where j.tenant_id=? and o.branch_id=? and j.target_pc_id is null and j.status in ('PENDING','CLAIMED') limit 1
                    """,tenant,branch).isEmpty()) {
                throw new ApiException(409,"Finish the branch’s existing browser print jobs before pairing.");
            }
            String token = secret();
            var row = db.one("""
                    insert into print_pcs(tenant_id,id,branch_id,credential_hash,last_seen_at) values(?,?,?,?,now())
                    on conflict(tenant_id,branch_id) do update set credential_hash=excluded.credential_hash,last_seen_at=now()
                    returning id
                    """,tenant,UUID.randomUUID(),branch,hash(token));
            return Map.of("token",tenant+"."+id(row)+"."+token,"pcId",id(row),"branchId",branch);
        });
    }

    @GetMapping("/outlets/{outlet}/status")
    public Object status(@PathVariable UUID outlet, @RequestParam(required=false) UUID orderId) {
        Actor actor = Actor.current();
        if (!actor.can("ORDER") && !actor.can("BILL") && !actor.can("PRINT")) actor.require("SETTINGS");
        return db.tx(actor, () -> {
            db.outlet(actor,outlet);
            var pcs = db.list("""
                    select p.branch_id,p.id,(p.last_seen_at>now()-interval '20 seconds') as online
                    from print_pcs p join outlets o on (o.tenant_id,o.branch_id)=(p.tenant_id,p.branch_id)
                    where o.tenant_id=? and o.id=?
                    """,actor.tenantId(),outlet);
            var jobs = db.list("""
                    select j.id,j.document_type,j.reference_id,j.created_at,j.error,
                        case j.status when 'PRINTED' then 'SENT_TO_PRINTER' when 'UNCERTAIN' then 'NEEDS_REVIEW'
                            when 'FAILED' then 'FAILED' else 'QUEUED' end as status
                    from print_jobs j
                    where j.tenant_id=? and j.outlet_id=? and j.target_pc_id is not null
                      and (?::uuid is null or j.reference_id in (
                          select k.id from kots k where k.tenant_id=j.tenant_id and k.outlet_id=j.outlet_id and k.order_id=?
                          union all select b.id from bills b where b.tenant_id=j.tenant_id and b.outlet_id=j.outlet_id and b.order_id=?))
                    order by j.created_at desc,j.id desc limit 25
                    """,actor.tenantId(),outlet,orderId,orderId,orderId);
            return Map.of("paired",!pcs.isEmpty(),"online",!pcs.isEmpty() && Boolean.TRUE.equals(pcs.getFirst().get("online")),"jobs",jobs);
        });
    }

    @PostMapping("/claim")
    public Object claim(@RequestHeader(value="Authorization",required=false) String token) {
        return device(token, pc -> {
            db.update("update print_pcs set last_seen_at=now() where tenant_id=? and id=?",pc.tenant(),pc.id());
            var jobs = db.list("""
                    select id from print_jobs
                    where tenant_id=? and target_pc_id=? and status='PENDING' and expires_at>now()
                      and coalesce(next_print_attempt_at,created_at)<=now()
                    order by created_at,id limit 1 for update skip locked
                    """,pc.tenant(),pc.id());
            if (jobs.isEmpty()) return Map.of("jobs",List.of());
            UUID job = id(jobs.getFirst());
            db.update("""
                    update print_jobs set status='CLAIMED',attempts=attempts+1,claimed_at=now(),
                        claim_token=?,delivery_started_at=null
                    where tenant_id=? and target_pc_id=? and id=?
                    """,UUID.randomUUID(),pc.tenant(),pc.id(),job);
            return Map.of("jobs",db.list("""
                    select j.*,p.paper_width,p.copies,p.template,original.delivery_plan as original_plan
                    from print_jobs j join printers p on (p.tenant_id,p.id)=(j.tenant_id,j.printer_id)
                    left join print_jobs original on (original.tenant_id,original.id)=(j.tenant_id,j.original_job_id)
                    where j.tenant_id=? and j.target_pc_id=? and j.id=?
                    """,pc.tenant(),pc.id(),job));
        });
    }

    @PostMapping("/start")
    public Object start(@RequestHeader(value="Authorization",required=false) String token,@Valid @RequestBody Start body) {
        return device(token, pc -> {
            if (!body.plan().isArray() || body.plan().size()>500) throw new ApiException(422,"Invalid printer delivery plan.");
            int updated = db.update("""
                    update print_jobs set delivery_started_at=coalesce(delivery_started_at,now()),delivery_plan=coalesce(delivery_plan,?::jsonb),claimed_at=now()
                    where tenant_id=? and target_pc_id=? and id=? and status='CLAIMED' and claim_token=?
                      and (delivery_started_at is not null or expires_at>now()) and claimed_at>now()-interval '120 seconds'
                      and (delivery_plan is null or delivery_plan=?::jsonb)
                    """,body.plan().toString(),pc.tenant(),pc.id(),body.jobId(),body.claimToken(),body.plan().toString());
            if (updated!=1) throw new ApiException(409,"The print claim expired or its delivery plan changed.");
            return Map.of("ok",true);
        });
    }

    @PostMapping("/result")
    public Object result(@RequestHeader(value="Authorization",required=false) String token,@Valid @RequestBody Result body) {
        return device(token, pc -> {
            if (!body.deliveries().isObject() || body.deliveries().size()>500) throw new ApiException(422,"Invalid delivery results.");
            var job = db.one("""
                    select attempts,delivery_started_at,expires_at>now() as retry_window
                    from print_jobs where tenant_id=? and target_pc_id=? and id=? and status='CLAIMED' and claim_token=? and claimed_at>now()-interval '120 seconds' for update
                    """,pc.tenant(),pc.id(),body.jobId(),body.claimToken());
            if ("PRINTED".equals(body.status()) && job.get("delivery_started_at")==null)
                throw new ApiException(409,"Printing was not started for this claim.");
            boolean retry = body.retryable() && "FAILED".equals(body.status()) && integer(job.get("attempts"))<3
                    && Boolean.TRUE.equals(job.get("retry_window"));
            db.update("""
                    update print_jobs set status=?,error=?,delivery_results=?::jsonb,claimed_at=null,claim_token=null,
                      completed_at=case when ? then null else now() end,
                      next_print_attempt_at=case when ? then now()+interval '10 seconds' else null end
                    where tenant_id=? and target_pc_id=? and id=?
                    """,retry?"PENDING":body.status(),text(body.error()),body.deliveries().toString(),retry,retry,
                    pc.tenant(),pc.id(),body.jobId());
            return Map.of("ok",true);
        });
    }

    @Scheduled(fixedDelay=15000)
    public void expiry() {
        for (var tenant : db.list("select id from tenants")) {
            UUID tenantId = id(tenant);
            db.asTenant(tenantId, () -> {
                db.update("""
                    update print_jobs set status='UNCERTAIN',error='Check the physical printer before resending.',
                        completed_at=now(),claim_token=null
                    where tenant_id=? and target_pc_id is not null and status='CLAIMED' and delivery_started_at is not null
                        and claimed_at<=now()-interval '120 seconds'
                    """,tenantId);
                db.update("""
                    update print_jobs set status='PENDING',claimed_at=null,claim_token=null
                    where tenant_id=? and target_pc_id is not null and status='CLAIMED' and delivery_started_at is null
                        and claimed_at<=now()-interval '120 seconds'
                    """,tenantId);
                db.update("""
                    update print_jobs set status='FAILED',error='The queued job expired before printing started.',completed_at=now(),claim_token=null
                    where tenant_id=? and target_pc_id is not null and expires_at<=now()
                      and (status='PENDING' or (status='CLAIMED' and delivery_started_at is null))
                    """,tenantId);
                return null;
            });
        }
    }

    private Actor admin() {
        Actor actor = Actor.current();
        actor.require("SETTINGS");
        if (!"OWNER".equals(actor.role())) throw new ApiException(403,"Only the property owner can pair a branch printing PC.");
        return actor;
    }
    UUID authenticate(String authorization, boolean pairing) {
        if (authorization==null || !authorization.startsWith("Bearer ")) throw unauthorized();
        String[] values=parts(authorization.substring(7));
        UUID tenant=uuid(values[0]), id=uuid(values[1]);
        return db.asTenant(tenant, () -> {
            var rows=pairing
                ? db.list("select branch_id from print_pc_pairings where tenant_id=? and branch_id=? and code_hash=? and expires_at>now()",
                        tenant,id,hash(values[2]))
                : db.list("select id from print_pcs where tenant_id=? and id=? and credential_hash=?",
                        tenant,id,hash(values[2]));
            if (rows.isEmpty()) throw unauthorized();
            return id;
        });
    }

    private Object device(String authorization, Function<Device,Object> work) {
        if (authorization==null || !authorization.startsWith("Bearer ")) throw unauthorized();
        String[] parts=parts(authorization.substring(7));
        UUID tenant=uuid(parts[0]), pc=uuid(parts[1]);
        return db.asTenant(tenant, () -> {
            var row=db.list("select branch_id from print_pcs where tenant_id=? and id=? and credential_hash=?",
                    tenant,pc,hash(parts[2]));
            if (row.isEmpty()) throw unauthorized();
            return work.apply(new Device(tenant,pc,id(row.getFirst().get("branch_id"))));
        });
    }
    private static String[] parts(String token) {
        String[] parts=token.split("\\.",-1);
        if (parts.length!=3 || !parts[2].matches("[a-f0-9]{64}")) throw unauthorized();
        return parts;
    }
    private static UUID uuid(String value) {
        try { return UUID.fromString(value); } catch (IllegalArgumentException ex) { throw unauthorized(); }
    }
    private String secret() {
        byte[] bytes=new byte[32];
        random.nextBytes(bytes);
        return HexFormat.of().formatHex(bytes);
    }
    private static String hash(String value) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.US_ASCII))); }
        catch (NoSuchAlgorithmException ex) { throw new IllegalStateException(ex); }
    }
    private static ApiException unauthorized() { return new ApiException(401,"Print PC credential or pairing code is invalid."); }
}
