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
        Map<String,Object> settings=support.outlet(a,outlet); Window window=window(from,to,text(settings.get("timezone")));
        String scope="with scope as (select ?::uuid as tenant_id,?::uuid as outlet_id,?::timestamptz as from_at,?::timestamptz as to_at,?::text as tz) ";
        Object[] args={a.tenantId(),outlet,window.start(),window.end(),window.zone().getId()};
        String paid=" from bills b cross join scope s where b.tenant_id=s.tenant_id and b.outlet_id=s.outlet_id and b.status='PAID' and b.settled_at>=s.from_at and b.settled_at<s.to_at ";
        String itemPaid=" from bill_items i join bills b on b.tenant_id=i.tenant_id and b.id=i.bill_id cross join scope s where i.tenant_id=s.tenant_id and b.tenant_id=s.tenant_id and b.outlet_id=s.outlet_id and b.status='PAID' and b.settled_at>=s.from_at and b.settled_at<s.to_at ";
        String itemMoney="sum((i.snapshot->>'subtotal')::numeric) as subtotal,sum((i.snapshot->>'discount')::numeric) as discount,sum((i.snapshot->>'tax')::numeric) as tax,sum((i.snapshot->>'total')::numeric) as total";
        String sql; List<String> columns; List<String> sums; String order;
        switch(type) {
            case "daily-sales" -> {
                sql="select (b.settled_at at time zone s.tz)::date::text as date,count(*) as bill_count,sum(b.subtotal) as subtotal,sum(b.discount) as discount,sum(b.tax) as tax,sum(b.total) as total,round(avg(b.total),2) as average_bill"+paid+"group by (b.settled_at at time zone s.tz)::date";
                columns=List.of("date","bill_count","subtotal","discount","tax","total","average_bill"); sums=List.of("bill_count","subtotal","discount","tax","total"); order="date desc";
            }
            case "item-sales" -> {
                sql="select i.snapshot->>'menu_item_id' as menu_item_id,i.snapshot->>'name' as name,coalesce(i.snapshot->>'variant','') as variant,coalesce(i.snapshot->'modifiers','[]'::jsonb) as modifiers,sum(i.quantity) as quantity,"+itemMoney+itemPaid+"group by i.snapshot->>'menu_item_id',i.snapshot->>'name',coalesce(i.snapshot->>'variant',''),coalesce(i.snapshot->'modifiers','[]'::jsonb)";
                columns=List.of("menu_item_id","name","variant","modifiers","quantity","subtotal","discount","tax","total"); sums=List.of("quantity","subtotal","discount","tax","total"); order="total desc,name,menu_item_id,variant,modifiers::text";
            }
            case "category-sales" -> {
                sql="select i.snapshot->>'category_id' as category_id,i.snapshot->>'category_name' as name,sum(i.quantity) as quantity,"+itemMoney+itemPaid+"group by i.snapshot->>'category_id',i.snapshot->>'category_name'";
                columns=List.of("category_id","name","quantity","subtotal","discount","tax","total"); sums=List.of("quantity","subtotal","discount","tax","total"); order="total desc,name,category_id";
            }
            case "outlet-sales" -> {
                sql="select b.outlet_id,j.payload->>'outlet' as name,count(*) as bill_count,sum(b.subtotal) as subtotal,sum(b.discount) as discount,sum(b.tax) as tax,sum(b.total) as total from bills b join print_jobs j on j.tenant_id=b.tenant_id and j.outlet_id=b.outlet_id and j.reference_id=b.id and j.document_type='BILL' and j.original_job_id is null cross join scope s where b.tenant_id=s.tenant_id and j.tenant_id=s.tenant_id and b.outlet_id=s.outlet_id and b.status='PAID' and b.settled_at>=s.from_at and b.settled_at<s.to_at group by b.outlet_id,j.payload->>'outlet'";
                columns=List.of("outlet_id","name","bill_count","subtotal","discount","tax","total"); sums=List.of("bill_count","subtotal","discount","tax","total"); order="total desc,name,outlet_id";
            }
            case "payments" -> {
                sql="select p.method,count(*) as payment_count,count(distinct b.id) as bill_count,sum(p.amount) as total from payments p join bills b on b.tenant_id=p.tenant_id and b.id=p.bill_id cross join scope s where p.tenant_id=s.tenant_id and b.tenant_id=s.tenant_id and b.outlet_id=s.outlet_id and b.status='PAID' and b.settled_at>=s.from_at and b.settled_at<s.to_at group by p.method";
                columns=List.of("method","payment_count","bill_count","total"); sums=List.of("payment_count","total"); order="total desc,method";
            }
            case "tax-settlement" -> {
                sql="select (i.snapshot->>'tax_rate')::numeric as tax_rate,sum(i.quantity) as quantity,sum((i.snapshot->>'subtotal')::numeric-(i.snapshot->>'discount')::numeric) as taxable,"+itemMoney+itemPaid+"group by (i.snapshot->>'tax_rate')::numeric";
                columns=List.of("tax_rate","quantity","subtotal","discount","taxable","tax","total"); sums=List.of("quantity","subtotal","discount","taxable","tax","total"); order="tax_rate";
            }
            case "kot-register" -> {
                sql="select k.id,k.number,k.order_id,j.payload->>'order' as order_number,j.payload->>'table' as table_name,j.payload->>'serviceMode' as service_mode,k.status,k.reason,k.created_at,j.payload->'lines' as items,coalesce((select sum(ki.quantity) from kot_items ki where ki.tenant_id=s.tenant_id and ki.kot_id=k.id),0) as quantity from kots k join print_jobs j on j.tenant_id=k.tenant_id and j.outlet_id=k.outlet_id and j.reference_id=k.id and j.document_type='KOT' and j.original_job_id is null cross join scope s where k.tenant_id=s.tenant_id and j.tenant_id=s.tenant_id and k.outlet_id=s.outlet_id and k.created_at>=s.from_at and k.created_at<s.to_at";
                columns=List.of("id","number","order_id","order_number","table_name","service_mode","status","reason","created_at","items","quantity"); sums=List.of("quantity"); order="created_at desc,id";
            }
            case "kot-cancellations","bill-reprints","bill-cancellations","bill-modifications","table-activity" -> {
                String actions=switch(type) {
                    case "kot-cancellations" -> "'KOT_CANCEL'";
                    case "bill-reprints" -> "'BILL_REPRINT'";
                    case "bill-cancellations" -> "'BILL_CANCEL'";
                    case "bill-modifications" -> "'BILL_MODIFY'";
                    default -> "'ORDER_CREATE','ORDER_CANCEL','TABLE_TRANSFER','BILL_SETTLE'";
                };
                sql="select l.id,l.created_at,l.action,l.entity_type,l.entity_id,l.user_id,l.reason,l.details from audit_log l cross join scope s where l.tenant_id=s.tenant_id and l.outlet_id=s.outlet_id and l.action in ("+actions+") and l.created_at>=s.from_at and l.created_at<s.to_at";
                columns=List.of("id","created_at","action","entity_type","entity_id","user_id","reason","details"); sums=List.of(); order="created_at desc,id";
            }
            default -> throw new ApiException(404,"Unknown report type");
        }
        return new Query(scope+sql,args,columns,sums,order);
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
        return Map.of("rows",rows(query,size,(long)page*size),"totalElements",count,"page",page,"size",size,"totals",totals(query,count));
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
                Object value=row.get(column); String text=value instanceof Map<?,?> || value instanceof List<?>?db.json(value):text(value);
                values.add(csvCell(text));
            }
            csv.append(String.join(",",values)).append("\r\n");
        }
        return csv.toString().getBytes(StandardCharsets.UTF_8);
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
        result.put("averageBill",billCount==0?OperationsMoney.ZERO:sales.divide(BigDecimal.valueOf(billCount),2,java.math.RoundingMode.HALF_UP));
        result.put("activeTables",active.get("active_tables")); result.put("activeOrders",active.get("active_orders"));
        result.put("payments",rows(query(a,outlet,"payments",from,to),200,0)); result.put("topItems",rows(query(a,outlet,"item-sales",from,to),10,0));
        result.put("topCategories",rows(query(a,outlet,"category-sales",from,to),10,0)); result.put("outlets",rows(query(a,outlet,"outlet-sales",from,to),10000,0));
        result.put("daily",rows(new Query(daily.sql(),daily.args(),daily.columns(),daily.sums(),"date"),366,0)); return result;
    }
}
