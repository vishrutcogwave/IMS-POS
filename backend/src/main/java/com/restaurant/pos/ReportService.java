package com.restaurant.pos;

import org.springframework.stereotype.Service;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.*;
import java.time.format.DateTimeParseException;
import java.time.temporal.ChronoUnit;
import java.util.*;
import static com.restaurant.pos.OperationsSupport.*;

@Service
public class ReportService {
    private static final int MAX_EXPORT=10000;
    private final TenantJdbc db;
    private final OperationsSupport support;
    public ReportService(TenantJdbc db,OperationsSupport support) { this.db=db; this.support=support; }
    record Window(LocalDate from,LocalDate to,ZoneId zone,Timestamp start,Timestamp end) {}
    record Query(String sql,Object[] args,List<String> columns,List<String> sums,String order) {}
    record BranchScope(String sql,Object[] args) {}
    static Window window(String from,String to,String timezone) {
        try {
            ZoneId zone=ZoneId.of(timezone); LocalDate today=LocalDate.now(zone);
            LocalDate start=from==null || from.isBlank()?today:LocalDate.parse(from);
            LocalDate end=to==null || to.isBlank()?today:LocalDate.parse(to);
            if(end.isBefore(start) || ChronoUnit.DAYS.between(start,end)>=366) throw new ApiException(400,"Date range must be ordered and contain at most 366 inclusive local dates");
            return new Window(start,end,zone,Timestamp.from(start.atStartOfDay(zone).toInstant()),Timestamp.from(end.plusDays(1).atStartOfDay(zone).toInstant()));
        } catch(DateTimeException ex) { throw new ApiException(400,"Use valid ISO dates and a configured IANA outlet timezone"); }
    }
    private Query query(Actor a,UUID outlet,String type,String from,String to) {
        return queryInternal(a,outlet,false,null,type,from,to);
    }
    private Query branchQuery(Actor a,String branchId,String type,String from,String to) {
        return queryInternal(a,null,true,branchId,type,from,to);
    }
    private Query queryInternal(Actor a,UUID outlet,boolean branchScoped,String branchId,String type,String from,String to) {
        String scope; Object[] args; Window window=null;
        if (branchScoped) {
            BranchScope selected=branchScope(a,branchId,from,to); scope=selected.sql(); args=selected.args();
        } else {
            Map<String,Object> settings=support.outlet(a,outlet); window=window(from,to,text(settings.get("timezone")));
            scope="with scope as (select ?::uuid as tenant_id,?::uuid as outlet_id,?::timestamptz as from_at,?::timestamptz as to_at,?::text as tz) ";
            args=new Object[]{a.tenantId(),outlet,window.start(),window.end(),window.zone().getId()};
        }
        if ("outlet-sales".equals(type) && !branchScoped && outlet==null) {
            scope = """
                with scope as (
                    select o.tenant_id, o.id as outlet_id, o.name,
                           (cast(? as date)::timestamp at time zone o.timezone) as from_at,
                           ((cast(? as date) + 1)::timestamp at time zone o.timezone) as to_at
                    from outlets o
                    where o.tenant_id=? and (?='OWNER' or exists (
                        select 1 from user_outlets access
                        where access.tenant_id=o.tenant_id and access.outlet_id=o.id and access.user_id=?
                    ))
                )
                """;
            args = new Object[]{window.from(), window.to(), a.tenantId(), a.role(), a.userId()};
        }
        String paid=" from bills b cross join scope s where b.tenant_id=s.tenant_id and b.outlet_id=s.outlet_id and b.status='PAID' and not b.non_chargeable and b.settled_at>=s.from_at and b.settled_at<s.to_at ";
        String itemPaid=" from bill_items i join bills b on b.tenant_id=i.tenant_id and b.id=i.bill_id cross join scope s where i.tenant_id=s.tenant_id and b.tenant_id=s.tenant_id and b.outlet_id=s.outlet_id and b.status='PAID' and not b.non_chargeable and coalesce((i.snapshot->>'non_chargeable')::boolean,false)=false and b.settled_at>=s.from_at and b.settled_at<s.to_at ";
        String paymentRows=" from payments p join bills b on b.tenant_id=p.tenant_id and b.id=p.bill_id "
                +"join orders o on (o.tenant_id,o.outlet_id,o.id)=(b.tenant_id,b.outlet_id,b.order_id) "
                +"left join restaurant_tables t on (t.tenant_id,t.outlet_id,t.id)=(o.tenant_id,o.outlet_id,o.table_id) cross join scope s "
                +"where p.tenant_id=s.tenant_id and b.outlet_id=s.outlet_id and b.status='PAID' and not b.non_chargeable "
                +"and b.settled_at>=s.from_at and b.settled_at<s.to_at ";
        String itemMoney="sum((i.snapshot->>'subtotal')::numeric) as subtotal,sum((i.snapshot->>'discount')::numeric) as discount,sum((i.snapshot->>'tax')::numeric) as tax,sum((i.snapshot->>'total')::numeric) as total";
        String branchColumn=branchScoped ? "s.branch_name" : "null::text";
        String sql; List<String> columns; List<String> sums; String order;
        switch(type) {
            case "daily-sales" -> {
                sql="select (b.settled_at at time zone s.tz)::date::text as date,count(*) as bill_count,sum(b.subtotal) as subtotal,sum(b.discount) as discount,sum(b.tax) as tax,sum(b.total) as total,round(avg(b.total),2) as average_bill"+paid+"group by (b.settled_at at time zone s.tz)::date";
                columns=List.of("date","bill_count","subtotal","discount","tax","total","average_bill"); sums=List.of("bill_count","subtotal","discount","tax","total"); order="date desc";
            }
            case "item-sales" -> {
                sql=branchScoped
                    ? "select null::text as menu_item_id,i.snapshot->>'name' as name,coalesce(i.snapshot->>'variant','') as variant,coalesce(i.snapshot->'modifiers','[]'::jsonb) as modifiers,sum(i.quantity) as quantity,"+itemMoney+itemPaid+"group by i.snapshot->>'name',coalesce(i.snapshot->>'variant',''),coalesce(i.snapshot->'modifiers','[]'::jsonb)"
                    : "select i.snapshot->>'menu_item_id' as menu_item_id,i.snapshot->>'name' as name,coalesce(i.snapshot->>'variant','') as variant,coalesce(i.snapshot->'modifiers','[]'::jsonb) as modifiers,sum(i.quantity) as quantity,"+itemMoney+itemPaid+"group by i.snapshot->>'menu_item_id',i.snapshot->>'name',coalesce(i.snapshot->>'variant',''),coalesce(i.snapshot->'modifiers','[]'::jsonb)";
                columns=List.of("menu_item_id","name","variant","modifiers","quantity","subtotal","discount","tax","total"); sums=List.of("quantity","subtotal","discount","tax","total"); order="total desc,name,menu_item_id,variant,modifiers::text";
            }
            case "category-sales" -> {
                sql=branchScoped
                    ? "select null::text as category_id,i.snapshot->>'category_name' as name,sum(i.quantity) as quantity,"+itemMoney+itemPaid+"group by i.snapshot->>'category_name'"
                    : "select i.snapshot->>'category_id' as category_id,i.snapshot->>'category_name' as name,sum(i.quantity) as quantity,"+itemMoney+itemPaid+"group by i.snapshot->>'category_id',i.snapshot->>'category_name'";
                columns=List.of("category_id","name","quantity","subtotal","discount","tax","total"); sums=List.of("quantity","subtotal","discount","tax","total"); order="total desc,name,category_id";
            }
            case "branch-sales" -> {
                sql = branchScoped ? """
                    select s.branch_id,s.branch_name as name,count(b.id) as bill_count,
                           coalesce(sum(b.subtotal),0) as subtotal,coalesce(sum(b.discount),0) as discount,
                           coalesce(sum(b.tax),0) as tax,coalesce(sum(b.total),0) as total
                    from (select distinct tenant_id,branch_id,branch_name from scope) s
                    left join scope outlets on outlets.branch_id=s.branch_id
                    left join bills b on b.tenant_id=outlets.tenant_id and b.outlet_id=outlets.outlet_id
                    and b.status='PAID' and not b.non_chargeable and b.settled_at>=outlets.from_at and b.settled_at<outlets.to_at
                    group by s.branch_id,s.branch_name
                    """ : """
                    select o.branch_id,br.name as name,count(b.id) as bill_count,
                           coalesce(sum(b.subtotal),0) as subtotal,coalesce(sum(b.discount),0) as discount,
                           coalesce(sum(b.tax),0) as tax,coalesce(sum(b.total),0) as total
                    from scope s join outlets o on (o.tenant_id,o.id)=(s.tenant_id,s.outlet_id)
                    join branches br on br.tenant_id=o.tenant_id and br.id=o.branch_id
                    left join bills b on b.tenant_id=s.tenant_id and b.outlet_id=s.outlet_id
                      and b.status='PAID' and not b.non_chargeable and b.settled_at>=s.from_at and b.settled_at<s.to_at
                    group by o.branch_id,br.name
                    """;
                columns=List.of("branch_id","name","bill_count","subtotal","discount","tax","total"); sums=List.of("bill_count","subtotal","discount","tax","total"); order="total desc,name,branch_id";
            }
            case "outlet-sales" -> {
                sql = outlet==null ? """
                    select s.outlet_id,s.name,count(b.id) as bill_count,
                           coalesce(sum(b.subtotal),0) as subtotal,coalesce(sum(b.discount),0) as discount,
                           coalesce(sum(b.tax),0) as tax,coalesce(sum(b.total),0) as total
                    from scope s left join bills b on b.tenant_id=s.tenant_id and b.outlet_id=s.outlet_id
                    and b.status='PAID' and not b.non_chargeable and b.settled_at>=s.from_at and b.settled_at<s.to_at
                    group by s.outlet_id,s.name
                    """ : """
                    select s.outlet_id,o.name,count(b.id) as bill_count,
                           coalesce(sum(b.subtotal),0) as subtotal,coalesce(sum(b.discount),0) as discount,
                           coalesce(sum(b.tax),0) as tax,coalesce(sum(b.total),0) as total
                    from scope s join outlets o on o.tenant_id=s.tenant_id and o.id=s.outlet_id
                    left join bills b on b.tenant_id=s.tenant_id and b.outlet_id=s.outlet_id
                    and b.status='PAID' and not b.non_chargeable and b.settled_at>=s.from_at and b.settled_at<s.to_at
                    group by s.outlet_id,o.name
                    """;
                columns=List.of("outlet_id","name","bill_count","subtotal","discount","tax","total"); sums=List.of("bill_count","subtotal","discount","tax","total"); order="total desc,name,outlet_id";
            }
            case "chance-sheet" -> {
                sql="""
                    select b.id,o.name as outlet,b.number as bill_number,
                           to_char(coalesce(b.settled_at,b.created_at) at time zone o.timezone,'DD/MM/YYYY') as date,
                           to_char(coalesce(b.settled_at,b.created_at) at time zone o.timezone,'HH24:MI:SS') as time,
                           b.subtotal-b.discount as sale,b.tax,round(b.tax/2,2) as cgst,
                           b.tax-round(b.tax/2,2) as sgst,
                           b.subtotal-b.discount+b.tax as total,
                           b.total-(b.subtotal-b.discount+b.tax) as rounding,b.total as grand,
                           coalesce((select jsonb_object_agg(pm.method,pm.amount) from
                             (select p.method,sum(p.amount) as amount from payments p
                              where p.tenant_id=b.tenant_id and p.bill_id=b.id group by p.method) pm),'{}'::jsonb) as payment_modes,
                           case when b.status='OPEN' then 'Bill Pending' else coalesce((
                             select case when count(distinct p.method)>1 then 'Multiple' else min(p.method) end
                             from payments p where p.tenant_id=b.tenant_id and p.bill_id=b.id),'Paid') end as status
                    from bills b join outlets o on (o.tenant_id,o.id)=(b.tenant_id,b.outlet_id)
                    cross join scope s
                    where b.tenant_id=s.tenant_id and b.outlet_id=s.outlet_id
                      and b.status in ('OPEN','PAID') and not b.non_chargeable
                      and coalesce(b.settled_at,b.created_at)>=s.from_at and coalesce(b.settled_at,b.created_at)<s.to_at
                    """;
                columns=List.of("outlet","bill_number","date","time","sale","tax","cgst","sgst","total","rounding","grand","payment_modes","status");
                sums=List.of("sale","tax","cgst","sgst","total","rounding","grand"); order="outlet,date desc,time desc,bill_number";
            }
            case "chance-outlet-summary" -> {
                sql="""
                    select o.id as outlet_id,o.name,count(b.id) as bill_count,
                           coalesce(sum(b.subtotal-b.discount),0) as sale,coalesce(sum(b.tax),0) as tax,
                           coalesce(sum(round(b.tax/2,2)),0) as cgst,
                           coalesce(sum(b.tax-round(b.tax/2,2)),0) as sgst,
                           coalesce(sum(b.subtotal-b.discount+b.tax),0) as total,
                           coalesce(sum(b.total-(b.subtotal-b.discount+b.tax)),0) as rounding,
                           coalesce(sum(b.total),0) as grand
                    from scope s join outlets o on (o.tenant_id,o.id)=(s.tenant_id,s.outlet_id)
                    left join bills b on b.tenant_id=s.tenant_id and b.outlet_id=s.outlet_id
                      and b.status in ('OPEN','PAID') and not b.non_chargeable
                      and coalesce(b.settled_at,b.created_at)>=s.from_at and coalesce(b.settled_at,b.created_at)<s.to_at
                    group by o.id,o.name
                    """;
                columns=List.of("outlet_id","name","bill_count","sale","tax","cgst","sgst","total","rounding","grand");
                sums=List.of("bill_count","sale","tax","cgst","sgst","total","rounding","grand"); order="name,outlet_id";
            }
            case "chance-payment-summary" -> {
                sql="""
                    select method,sum(amount) as total from (
                      select p.method,p.amount from payments p join bills b on b.tenant_id=p.tenant_id and b.id=p.bill_id
                        join scope s on s.tenant_id=b.tenant_id and s.outlet_id=b.outlet_id
                        where b.status='PAID' and not b.non_chargeable and b.settled_at>=s.from_at and b.settled_at<s.to_at
                      union all
                      select 'Bill Pending' as method,b.total as amount from bills b join scope s on s.tenant_id=b.tenant_id and s.outlet_id=b.outlet_id
                        where b.status='OPEN' and not b.non_chargeable and b.created_at>=s.from_at and b.created_at<s.to_at
                    ) amounts group by method
                    """;
                columns=List.of("method","total"); sums=List.of("total"); order="method";
            }
            case "payments" -> {
                sql="select p.method,count(*) as payment_count,count(distinct b.id) as bill_count,sum(p.amount) as total"+paymentRows+"group by p.method";
                columns=List.of("method","payment_count","bill_count","total"); sums=List.of("payment_count","total"); order="total desc,method";
            }
            case "payment-details" -> {
                sql="select p.id,"+branchColumn+" as branch,b.settled_at,b.number as bill_number,o.number as order_number,t.name as table_name,p.method,p.reference,p.amount"
                        +paymentRows;
                columns=List.of("id","branch","settled_at","bill_number","order_number","table_name","method","reference","amount");
                sums=List.of("amount"); order="settled_at desc,bill_number,id";
            }
            case "tax-settlement" -> {
                sql="select (i.snapshot->>'tax_rate')::numeric as tax_rate,sum(i.quantity) as quantity,sum((i.snapshot->>'subtotal')::numeric-(i.snapshot->>'discount')::numeric) as taxable,"+itemMoney+itemPaid+"group by (i.snapshot->>'tax_rate')::numeric";
                columns=List.of("tax_rate","quantity","subtotal","discount","taxable","tax","total"); sums=List.of("quantity","subtotal","discount","taxable","tax","total"); order="tax_rate";
            }
            case "kot-register" -> {
                sql="select k.id,k.number,k.order_id,j.payload->>'order' as order_number,j.payload->>'table' as table_name,j.payload->>'serviceMode' as service_mode,k.status,k.reason,k.created_at,j.payload->'lines' as items,"+branchColumn+" as branch,coalesce((select sum(ki.quantity) from kot_items ki where ki.tenant_id=s.tenant_id and ki.kot_id=k.id),0) as quantity from kots k join print_jobs j on j.tenant_id=k.tenant_id and j.outlet_id=k.outlet_id and j.reference_id=k.id and j.document_type='KOT' and j.original_job_id is null cross join scope s where k.tenant_id=s.tenant_id and j.tenant_id=s.tenant_id and k.outlet_id=s.outlet_id and k.created_at>=s.from_at and k.created_at<s.to_at";
                columns=List.of("id","number","order_id","order_number","table_name","service_mode","status","reason","created_at","items","branch","quantity"); sums=List.of("quantity"); order="created_at desc,id";
            }
            case "nc-kots" -> {
                sql="""
                    select k.id,k.nc_department_name as department,k.number as kot_number,o.number as order_number,
                           t.name as table_name,k.status,k.nc_reason as nc_reason,k.reason as void_reason,k.created_at,%s as branch,
                           (select sum(i.quantity) from kot_items i where i.tenant_id=k.tenant_id and i.kot_id=k.id) as quantity
                    from kots k join orders o on (o.tenant_id,o.outlet_id,o.id)=(k.tenant_id,k.outlet_id,k.order_id)
                    left join restaurant_tables t on (t.tenant_id,t.outlet_id,t.id)=(o.tenant_id,o.outlet_id,o.table_id)
                    cross join scope s
                    where k.tenant_id=s.tenant_id and k.outlet_id=s.outlet_id and k.nc_department_id is not null
                      and k.created_at>=s.from_at and k.created_at<s.to_at
                    """.formatted(branchColumn);
                columns=List.of("id","department","kot_number","order_number","table_name","status","nc_reason","void_reason","created_at","branch","quantity");
                sums=List.of("quantity"); order="department,created_at desc,id";
            }
            case "kot-cancellations","bill-reprints","bill-cancellations","bill-modifications","table-activity" -> {
                String actions=switch(type) {
                    case "kot-cancellations" -> "'KOT_CANCEL'";
                    case "bill-reprints" -> "'BILL_REPRINT'";
                    case "bill-cancellations" -> "'BILL_CANCEL','BILL_PAYMENT_REVERSE'";
                    case "bill-modifications" -> "'BILL_MODIFY','BILL_PAYMENT_CORRECT'";
                    default -> "'ORDER_CREATE','ORDER_CANCEL','TABLE_TRANSFER','BILL_SETTLE'";
                };
                sql="select l.id,l.created_at,l.action,l.entity_type,l.entity_id,l.user_id,u.name as staff_name,l.reason,l.details,"+branchColumn+" as branch from audit_log l left join users u on (u.tenant_id,u.id)=(l.tenant_id,l.user_id) cross join scope s where l.tenant_id=s.tenant_id and l.outlet_id=s.outlet_id and l.action in ("+actions+") and l.created_at>=s.from_at and l.created_at<s.to_at";
                columns=List.of("id","created_at","action","entity_type","entity_id","user_id","staff_name","reason","details","branch"); sums=List.of(); order="created_at desc,id";
            }
            default -> throw new ApiException(404,"Unknown report type");
        }
        return new Query(scope+sql,args,columns,sums,order);
    }
    private BranchScope branchScope(Actor a,String selectedBranch,String from,String to) {
        UUID branch=null;
        if (selectedBranch!=null && !selectedBranch.isBlank() && !"ALL".equals(selectedBranch)) {
            try { branch=UUID.fromString(selectedBranch); }
            catch (IllegalArgumentException ex) { throw new ApiException(400,"Choose a valid branch."); }
        }
        if (branch==null && !"OWNER".equals(a.role())) throw new ApiException(403,"Only the owner can view reports across all branches.");
        if (branch!=null) {
            List<Map<String,Object>> visible=db.list("select b.id from branches b where b.tenant_id=? and b.id=? and (?='OWNER' or exists (select 1 from outlets o join user_outlets u on u.tenant_id=o.tenant_id and u.outlet_id=o.id where o.tenant_id=b.tenant_id and o.branch_id=b.id and u.user_id=?))",a.tenantId(),branch,a.role(),a.userId());
            if (visible.isEmpty()) throw new ApiException(403,"You do not have access to this branch.");
        }
        Window dates=window(from,to,"Asia/Calcutta");
        String sql="""
            with scope as (
              select o.tenant_id,o.id as outlet_id,o.name,o.branch_id,b.name as branch_name,o.timezone as tz,
                     (cast(? as date)::timestamp at time zone o.timezone) as from_at,
                     ((cast(? as date)+1)::timestamp at time zone o.timezone) as to_at
              from outlets o join branches b on b.tenant_id=o.tenant_id and b.id=o.branch_id
              where o.tenant_id=? and (?::uuid is null or o.branch_id=?::uuid)
                and (?='OWNER' or exists (select 1 from user_outlets access where access.tenant_id=o.tenant_id and access.outlet_id=o.id and access.user_id=?))
            )
            """;
        return new BranchScope(sql,new Object[]{dates.from(),dates.to(),a.tenantId(),branch,branch,a.role(),a.userId()});
    }
    private Query branchActiveQuery(Actor a,String branchId,String from,String to) {
        BranchScope scope=branchScope(a,branchId,from,to);
        return new Query(scope.sql()+"select count(distinct o.id) as active_orders,count(distinct o.table_id) as active_tables from orders o join scope s on s.tenant_id=o.tenant_id and s.outlet_id=o.outlet_id where o.status in ('OPEN','BILL_PENDING')",scope.args(),List.of("active_orders","active_tables"),List.of(),"");
    }
    public Map<String,Object> reportForBranch(Actor a,String branchId,String type,String from,String to,int page,int size) {
        if(page<0 || size<1 || size>200) throw new ApiException(400,"Page must be nonnegative and size must be between 1 and 200");
        Query query=branchQuery(a,branchId,type,from,to); long count=count(query);
        Map<String,Object> result=new LinkedHashMap<>(Map.of("rows",rows(query,size,(long)page*size),"totalElements",count,"page",page,"size",size,"totals",totals(query,count)));
        if ("payment-details".equals(type)) result.put("paymentModes",rows(branchQuery(a,branchId,"payments",from,to),200,0));
        if ("chance-sheet".equals(type)) {
            result.put("outletSummary",rows(branchQuery(a,branchId,"chance-outlet-summary",from,to),10000,0));
            result.put("paymentSummary",rows(branchQuery(a,branchId,"chance-payment-summary",from,to),200,0));
        }
        return result;
    }
    public byte[] exportForBranch(Actor a,String branchId,String type,String from,String to) {
        Query query=branchQuery(a,branchId,type,from,to); long count=count(query);
        if(count>MAX_EXPORT) throw new ApiException(422,"Export exceeds 10000 rows; narrow the date range");
        List<Map<String,Object>> values=rows(query,MAX_EXPORT+1,0);
        if(values.size()>MAX_EXPORT) throw new ApiException(422,"Export exceeds 10000 rows; narrow the date range");
        StringBuilder csv=new StringBuilder(); csv.append(String.join(",",query.columns().stream().map(ReportService::csvCell).toList())).append("\r\n");
        for(Map<String,Object> row:values) { List<String> fields=new ArrayList<>(); for(String column:query.columns()) fields.add(csvCell(reportText(row.get(column)))); csv.append(String.join(",",fields)).append("\r\n"); }
        return csv.toString().getBytes(StandardCharsets.UTF_8);
    }
    public Map<String,Object> dashboardForBranch(Actor a,String branchId,String from,String to) {
        Query daily=branchQuery(a,branchId,"daily-sales",from,to); Map<String,Object> totals=totals(daily,count(daily));
        BigDecimal sales=OperationsMoney.amount(totals.get("total")); long billCount=((Number)totals.getOrDefault("bill_count",0)).longValue();
        Query activeQuery=branchActiveQuery(a,branchId,from,to); Map<String,Object> active=db.one(activeQuery.sql(),activeQuery.args());
        Map<String,Object> result=new LinkedHashMap<>(); result.put("sales",sales); result.put("billCount",billCount);
        result.put("subtotal",OperationsMoney.amount(totals.get("subtotal"))); result.put("discount",OperationsMoney.amount(totals.get("discount"))); result.put("tax",OperationsMoney.amount(totals.get("tax")));
        result.put("averageBill",billCount==0?OperationsMoney.ZERO:sales.divide(BigDecimal.valueOf(billCount),2,java.math.RoundingMode.HALF_UP));
        result.put("activeTables",active.get("active_tables")); result.put("activeOrders",active.get("active_orders"));
        result.put("payments",rows(branchQuery(a,branchId,"payments",from,to),200,0)); result.put("topItems",rows(branchQuery(a,branchId,"item-sales",from,to),10,0));
        result.put("topCategories",rows(branchQuery(a,branchId,"category-sales",from,to),10,0)); result.put("branches",rows(branchQuery(a,branchId,"branch-sales",from,to),10000,0));
        result.put("daily",rows(new Query(daily.sql(),daily.args(),daily.columns(),daily.sums(),"date"),366,0)); return result;
    }
    private long count(Query query) { return ((Number)db.one("select count(*) as count from ("+query.sql()+") report_count",query.args()).get("count")).longValue(); }
    private Map<String,Object> totals(Query query,long count) {
        Map<String,Object> result=new LinkedHashMap<>(); result.put("row_count",count);
        if(!query.sums().isEmpty()) {
            String fields=String.join(",",query.sums().stream().map(column -> "coalesce(sum("+column+"),0) as "+column).toList());
            result.putAll(db.one("select "+fields+" from ("+query.sql()+") report_totals",query.args()));
        }
        return result;
    }
    private List<Map<String,Object>> rows(Query query,int limit,long offset) {
        List<Object> args=new ArrayList<>(Arrays.asList(query.args())); args.add(limit); args.add(offset);
        return db.list("select * from ("+query.sql()+") report_rows order by "+query.order()+" limit ? offset ?",args.toArray());
    }
    public Map<String,Object> report(Actor a,UUID outlet,String type,String from,String to,int page,int size) {
        if(page<0 || size<1 || size>200) throw new ApiException(400,"Page must be nonnegative and size must be between 1 and 200");
        Query query=query(a,outlet,type,from,to); long count=count(query);
        Map<String,Object> result=new LinkedHashMap<>(Map.of("rows",rows(query,size,(long)page*size),"totalElements",count,"page",page,"size",size,"totals",totals(query,count)));
        if ("payment-details".equals(type)) result.put("paymentModes",rows(query(a,outlet,"payments",from,to),200,0));
        if ("chance-sheet".equals(type)) {
            result.put("outletSummary",rows(query(a,outlet,"chance-outlet-summary",from,to),10000,0));
            result.put("paymentSummary",rows(query(a,outlet,"chance-payment-summary",from,to),200,0));
        }
        return result;
    }
    public byte[] export(Actor a,UUID outlet,String type,String from,String to) {
        Query query=query(a,outlet,type,from,to); long count=count(query);
        if(count>MAX_EXPORT) throw new ApiException(422,"Export exceeds 10000 rows; narrow the date range");
        List<Map<String,Object>> rows=rows(query,MAX_EXPORT+1,0);
        if(rows.size()>MAX_EXPORT) throw new ApiException(422,"Export exceeds 10000 rows; narrow the date range");
        StringBuilder csv=new StringBuilder(); csv.append(String.join(",",query.columns().stream().map(ReportService::csvCell).toList())).append("\r\n");
        for(Map<String,Object> row:rows) {
            List<String> values=new ArrayList<>();
            for(String column:query.columns()) {
                values.add(csvCell(reportText(row.get(column))));
            }
            csv.append(String.join(",",values)).append("\r\n");
        }
        return csv.toString().getBytes(StandardCharsets.UTF_8);
    }
    private static String reportText(Object value) {
        if (value instanceof List<?> entries) {
            return String.join("\n",entries.stream().map(ReportService::reportText).filter(part -> !part.isBlank()).toList());
        }
        if (value instanceof Map<?,?> entries) {
            List<String> parts=new ArrayList<>();
            for (var entry:entries.entrySet()) {
                String detail=reportText(entry.getValue());
                if (!detail.isBlank()) parts.add(entry.getKey().toString().replace('_',' ')+": "+detail);
            }
            return String.join("; ",parts);
        }
        return text(value);
    }

    static String csvCell(String value) {
        String text=value==null?"":value;
        // Strip all leading control/space characters only for detection, never from exported content.
        int first=0; while(first<text.length() && (Character.isWhitespace(text.charAt(first)) || Character.isISOControl(text.charAt(first)) || text.charAt(first)=='\ufeff')) first++;
        if(first<text.length() && "=+-@".indexOf(text.charAt(first))>=0 || (!text.isEmpty() && "\t\r\n".indexOf(text.charAt(0))>=0)) text="'"+text;
        return "\""+text.replace("\"","\"\"")+"\"";
    }
    public Map<String,Object> dashboard(Actor a,UUID outlet,String from,String to) {
        Query daily=query(a,outlet,"daily-sales",from,to); Map<String,Object> totals=totals(daily,count(daily));
        BigDecimal sales=OperationsMoney.amount(totals.get("total")); long billCount=((Number)totals.getOrDefault("bill_count",0)).longValue();
        Map<String,Object> active=db.one("select count(*) as active_orders,count(distinct table_id) as active_tables from orders where tenant_id=? and outlet_id=? and status in ('OPEN','BILL_PENDING')",a.tenantId(),outlet);
        Map<String,Object> result=new LinkedHashMap<>(); result.put("sales",sales); result.put("billCount",billCount);
        result.put("subtotal",OperationsMoney.amount(totals.get("subtotal")));
        result.put("discount",OperationsMoney.amount(totals.get("discount")));
        result.put("tax",OperationsMoney.amount(totals.get("tax")));
        result.put("averageBill",billCount==0?OperationsMoney.ZERO:sales.divide(BigDecimal.valueOf(billCount),2,java.math.RoundingMode.HALF_UP));
        result.put("activeTables",active.get("active_tables")); result.put("activeOrders",active.get("active_orders"));
        result.put("payments",rows(query(a,outlet,"payments",from,to),200,0)); result.put("topItems",rows(query(a,outlet,"item-sales",from,to),10,0));
        result.put("topCategories",rows(query(a,outlet,"category-sales",from,to),10,0)); result.put("outlets",rows(query(a,outlet,"outlet-sales",from,to),10000,0));
        result.put("daily",rows(new Query(daily.sql(),daily.args(),daily.columns(),daily.sums(),"date"),366,0)); return result;
    }
}
