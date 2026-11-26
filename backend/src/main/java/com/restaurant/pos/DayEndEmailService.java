package com.restaurant.pos;

import jakarta.mail.internet.MimeMessage;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Currency;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.time.format.DateTimeFormatter;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import static com.restaurant.pos.OperationsSupport.id;
import static com.restaurant.pos.OperationsSupport.integer;
import static com.restaurant.pos.OperationsSupport.text;

@Service
public class DayEndEmailService {
    private static final Logger LOG = LoggerFactory.getLogger(DayEndEmailService.class);
    private final TenantJdbc db;
    private final ReportService reports;
    private final JavaMailSender mail;
    private final String mailHost;
    private final String mailFrom;

    public DayEndEmailService(TenantJdbc db, ReportService reports, JavaMailSender mail,
            @Value("${spring.mail.host:}") String mailHost, @Value("${app.mail-from:}") String mailFrom) {
        this.db = db; this.reports = reports; this.mail = mail;
        this.mailHost = mailHost; this.mailFrom = mailFrom;
    }

    public boolean emailConfigured() { return !mailHost.isBlank() && !mailFrom.isBlank(); }

    public Map<String,Object> saveSettings(Actor actor, UUID branchId, List<String> recipients, boolean scheduled, LocalTime sendTime) {
        actor.require("SETTINGS"); requireOwner(actor);
        return db.tx(actor, () -> {
            Map<String,Object> branch = branchInfo(actor, branchId);
            List<String> clean = recipients == null ? List.of() : recipients.stream().map(String::strip)
                    .filter(value -> !value.isBlank()).map(value -> value.toLowerCase(Locale.ROOT)).distinct().toList();
            if (clean.size() > 5) throw new ApiException(422, "Add no more than five recipient email addresses.");
            if (clean.isEmpty()) throw new ApiException(422, "Add at least one recipient email address.");
            if (sendTime == null) throw new ApiException(422, "Choose a local send time.");
            db.update("""
                    insert into day_end_email_settings(tenant_id,branch_id,recipients,scheduled,send_time,updated_at)
                    values(?,?,?::jsonb,?,?,now())
                    on conflict(tenant_id,branch_id) do update set recipients=excluded.recipients,
                      scheduled=excluded.scheduled,send_time=excluded.send_time,updated_at=now()
                    """, actor.tenantId(), branchId, db.json(clean), scheduled, sendTime);
            db.audit(actor, null, "DAY_END_EMAIL_SETTINGS_UPDATE", "BRANCH", branchId, "",
                    Map.of("recipientCount", clean.size(), "scheduled", scheduled, "sendTime", sendTime.toString()));
            return Map.of("branch_id", branchId, "branch_name", branch.get("branch_name"), "recipients", clean, "scheduled", scheduled, "send_time", sendTime.toString());
        });
    }

    public Map<String,Object> sendNow(Actor actor, UUID branchId, LocalDateTime startAt, LocalDateTime endAt) {
        actor.require("REPORT"); requireOwner(actor);
        if (!emailConfigured()) throw new ApiException(503, "Email is not configured. Set MAIL_HOST and MAIL_FROM in the local environment, then restart the backend.");
        if (startAt == null || endAt == null) throw new ApiException(422, "Choose the start and end date and time for the branch report.");
        return deliver(actor, branchId, startAt, endAt, "MANUAL");
    }

    private Map<String,Object> deliver(Actor actor, UUID branchId, LocalDateTime startAt, LocalDateTime endAt, String trigger) {
        Reservation reservation = reserve(actor, branchId, startAt, endAt, trigger);
        if (reservation == null) return Map.of("status", "SKIPPED");
        try {
            String from = reservation.startAt().toLocalDateTime().toString();
            String toExclusive = reservation.endAt().plusMinutes(1).toLocalDateTime().toString();
            Map<String,Object> report = db.tx(actor, () -> reports.reportForBranch(actor, branchId.toString(), "chance-sheet", from, toExclusive, 0, 1));
            byte[] csv = db.tx(actor, () -> reports.exportForBranch(actor, branchId.toString(), "chance-sheet", from, toExclusive));
            sendMessage(reservation, report, csv);
            db.tx(actor, () -> {
                db.update("update day_end_email_deliveries set status='SENT',sent_at=now(),last_error='' where tenant_id=? and branch_id=? and start_at=? and end_at=? and status='SENDING'",
                        actor.tenantId(), branchId, reservation.startAt(), reservation.endAt());
                db.audit(actor, null, "DAY_END_EMAIL_SENT", "BRANCH", branchId, "",
                        Map.of("startAt", reservation.startAt().toString(), "endAt", reservation.endAt().toString(), "trigger", trigger, "recipientCount", reservation.recipients().size()));
                return null;
            });
            return Map.of("status", "SENT", "startAt", reservation.startAtLocal().toString(), "endAt", reservation.endAtLocal().toString(), "branchId", branchId, "branchName", reservation.branchName(), "recipients", reservation.recipients());
        } catch (Exception ex) {
            markFailed(actor.tenantId(), branchId, reservation.startAt(), reservation.endAt(), failureDetails(ex));
            LOG.error("Branch day-end email failed; tenant={}, branch={}, startAt={}, endAt={}, category={}", actor.tenantId(), branchId, reservation.startAt(), reservation.endAt(), ex.getClass().getSimpleName(), ex);
            if (ex instanceof ApiException api) throw api;
            throw new ApiException(502, "The day-end email could not be sent. Check the SMTP settings and backend logs, then retry.");
        }
    }

    private Reservation reserve(Actor actor, UUID branchId, LocalDateTime startAtLocal, LocalDateTime endAtLocal, String trigger) {
        return db.tx(actor, () -> {
            Map<String,Object> location = branchInfo(actor, branchId);
            ZoneId zone = ZoneId.of(text(location.get("timezone")));
            LocalDate today = LocalDate.now(zone);
            if (endAtLocal.isBefore(startAtLocal)) throw new ApiException(422, "The end time must be on or after the start time.");
            if ("MANUAL".equals(trigger)) {
                LocalDateTime earliest = today.minusDays(3).atStartOfDay();
                LocalDateTime latest = LocalDateTime.now(zone).withSecond(0).withNano(0);
                if (startAtLocal.isBefore(earliest) || endAtLocal.isBefore(earliest) || endAtLocal.isAfter(latest))
                    throw new ApiException(422, "Choose a time from the start of the day three days ago through the current branch local time.");
            }
            LocalDate startDate = startAtLocal.toLocalDate();
            LocalDate endDate = endAtLocal.toLocalDate();
            OffsetDateTime startAt = startAtLocal.atZone(zone).toOffsetDateTime();
            OffsetDateTime endAt = endAtLocal.atZone(zone).toOffsetDateTime();
            List<Map<String,Object>> settings = db.list("select recipients,scheduled from day_end_email_settings where tenant_id=? and branch_id=?",
                    actor.tenantId(), branchId);
            Map<String,Object> setting = settings.isEmpty() ? Map.of() : settings.getFirst();
            if ("MANUAL".equals(trigger) && Boolean.TRUE.equals(setting.get("scheduled"))) throw new ApiException(409, "Manual close is disabled while automatic branch email is enabled.");
            List<String> recipients = stringList(setting.get("recipients"));
            if (recipients.isEmpty()) throw new ApiException(422, "Save at least one recipient email address in the branch day-end settings before sending.");
            db.jdbc().queryForList("select pg_advisory_xact_lock(hashtextextended(?,0))", actor.tenantId() + ":branch-day-end-email:" + branchId + ":" + startAt + ":" + endAt);
            List<Map<String,Object>> prior = db.list("select status,attempts,started_at from day_end_email_deliveries where tenant_id=? and branch_id=? and start_at=? and end_at=? for update",
                    actor.tenantId(), branchId, startAt, endAt);
            if (!prior.isEmpty()) {
                Map<String,Object> row = prior.getFirst();
                if ("SENT".equals(row.get("status"))) throw new ApiException(409, "A day-end email was already sent for this branch and date range.");
                if ("SENDING".equals(row.get("status"))) throw new ApiException(409, "A day-end email is already being sent for this branch and date range. Check the inbox before retrying.");
                if (integer(row.get("attempts")) >= 10) throw new ApiException(409, "This date range reached its email retry limit. Check the mail logs before trying again.");
                db.update("update day_end_email_deliveries set status='SENDING',trigger=?,attempts=attempts+1,started_at=now(),sent_at=null,last_error='',requested_by=? where tenant_id=? and branch_id=? and start_at=? and end_at=?",
                        trigger, actor.userId(), actor.tenantId(), branchId, startAt, endAt);
            } else {
                db.update("insert into day_end_email_deliveries(id,tenant_id,branch_id,start_date,end_date,start_at,end_at,trigger,status,attempts,requested_by) values(?,?,?,?,?,?,?,?,'SENDING',1,?)",
                        UUID.randomUUID(), actor.tenantId(), branchId, startDate, endDate, startAt, endAt, trigger, actor.userId());
            }
            List<OutletInfo> outlets = db.list("select id,name,currency from outlets where tenant_id=? and branch_id=? order by name,id", actor.tenantId(), branchId)
                    .stream().map(row -> new OutletInfo(text(row.get("id")), text(row.get("name")), text(row.get("currency")))).toList();
            return new Reservation(text(location.get("business_name")), text(location.get("branch_name")), zone, startAtLocal, endAtLocal, startAt, endAt, recipients, outlets);
        });
    }

    private Map<String,Object> branchInfo(Actor actor, UUID branchId) {
        Map<String,Object> branch = db.one("""
                select b.id as branch_id,b.name as branch_name,t.name as business_name,
                  min(o.timezone) as timezone,count(o.id) as outlet_count,count(distinct o.timezone) as timezone_count
                from branches b join tenants t on t.id=b.tenant_id
                left join outlets o on o.tenant_id=b.tenant_id and o.branch_id=b.id
                where b.tenant_id=? and b.id=? group by b.id,b.name,t.name
                """, actor.tenantId(), branchId);
        if (integer(branch.get("outlet_count")) == 0) throw new ApiException(422, "Add an outlet to this branch before setting up its day-end report.");
        if (integer(branch.get("timezone_count")) != 1) throw new ApiException(422, "All outlets in a branch must use the same timezone for its day-end report.");
        return branch;
    }

    private void sendMessage(Reservation reservation, Map<String,Object> report, byte[] csv) throws Exception {
        String period = formatDateTime(reservation.startAtLocal()) + " – " + formatDateTime(reservation.endAtLocal());
        @SuppressWarnings("unchecked") List<Map<String,Object>> summary = report.get("outletSummary") instanceof List<?> values
                ? (List<Map<String,Object>>) values : List.of();
        Map<String,Map<String,Object>> byId = new java.util.HashMap<>();
        for (Map<String,Object> row : summary) byId.put(text(row.get("outlet_id")), row);
        BigDecimal totalSale = BigDecimal.ZERO, totalTax = BigDecimal.ZERO, totalGrand = BigDecimal.ZERO;
        boolean oneCurrency = reservation.outlets().stream().map(OutletInfo::currency).distinct().count() == 1;
        String currencyCode = reservation.outlets().isEmpty() ? "INR" : reservation.outlets().getFirst().currency();
        StringBuilder outletRows = new StringBuilder();
        int rowNumber = 0;
        for (OutletInfo outlet : reservation.outlets()) {
            Map<String,Object> row = byId.getOrDefault(outlet.id(), Map.of());
            BigDecimal sale = amount(row.get("sale")), tax = amount(row.get("tax")), grand = amount(row.get("grand"));
            totalSale = totalSale.add(sale); totalTax = totalTax.add(tax); totalGrand = totalGrand.add(grand);
            String background = rowNumber++ % 2 == 0 ? "#ffffff" : "#faf7f2";
            outletRows.append("<tr style=\"background:").append(background).append(";\">")
                    .append(emailCell(escape(outlet.name()), "left", "font-weight:600;"))
                    .append(emailCell(escape(text(row.getOrDefault("bill_count", "0"))), "right", ""))
                    .append(emailCell(escape(currency(sale, outlet.currency())), "right", ""))
                    .append(emailCell(escape(currency(tax, outlet.currency())), "right", ""))
                    .append(emailCell(escape(currency(grand, outlet.currency())), "right", "font-weight:700;"))
                    .append("</tr>");
        }
        String bills = text(report.getOrDefault("totalElements", 0));
        StringBuilder html = new StringBuilder(6000);
        html.append("<!doctype html><html><body style=\"margin:0;padding:0;background:#f4f1eb;color:#332821;font-family:Arial,Helvetica,sans-serif;\">")
                .append("<div style=\"display:none;max-height:0;overflow:hidden;opacity:0;\">Day-end sales report for ").append(escape(reservation.branchName())).append(" · ").append(escape(period)).append("</div>")
                .append("<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"background:#f4f1eb;padding:28px 12px;\"><tr><td align=\"center\">")
                .append("<table role=\"presentation\" width=\"680\" cellpadding=\"0\" cellspacing=\"0\" style=\"width:100%;max-width:680px;background:#ffffff;border:1px solid #e9dfd2;border-radius:12px;overflow:hidden;\">")
                .append("<tr><td style=\"background:#3a281e;padding:25px 30px;color:#ffffff;\"><div style=\"font-size:11px;letter-spacing:2px;color:#e7b887;font-weight:bold;\">RESTAURANT OPERATIONS</div>")
                .append("<h1 style=\"font-size:25px;line-height:1.25;margin:9px 0 5px;color:#ffffff;\">Day-end report</h1><div style=\"font-size:14px;color:#f1e5d9;\">").append(escape(reservation.businessName())).append("</div></td></tr>")
                .append("<tr><td style=\"padding:25px 30px 10px;\"><div style=\"font-size:12px;color:#8c6a54;text-transform:uppercase;letter-spacing:1px;font-weight:bold;\">Branch</div><div style=\"font-size:19px;font-weight:bold;margin-top:4px;\">").append(escape(reservation.branchName())).append("</div>")
                .append("<div style=\"font-size:13px;color:#65584d;margin-top:6px;\">Business period: <strong>").append(escape(period)).append("</strong> <span style=\"color:#8b8b80;\">(").append(escape(reservation.zone().getId())).append(")</span></div></td></tr>")
                .append("<tr><td style=\"padding:14px 30px 22px;\"><table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\"><tr>")
                .append(summaryCard("BILLS", bills)).append(summaryCard("OUTLETS", String.valueOf(reservation.outlets().size())))
                .append(summaryCard("PERIOD", reservation.startAtLocal().toLocalDate().equals(reservation.endAtLocal().toLocalDate()) ? "Same day" : "Multiple days"))
                .append("</tr></table></td></tr>")
                .append("<tr><td style=\"padding:0 30px 24px;\"><h2 style=\"font-size:16px;margin:0 0 12px;color:#3a281e;\">Outlet sales summary</h2>")
                .append("<table width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"border-collapse:collapse;font-size:12px;\"><thead><tr style=\"background:#f4e9dc;color:#624c3d;\">")
                .append(emailHeader("Outlet", "left")).append(emailHeader("Bills", "right")).append(emailHeader("Net sales", "right"))
                .append(emailHeader("Tax", "right")).append(emailHeader("Grand total", "right")).append("</tr></thead><tbody>")
                .append(outletRows);
        if (oneCurrency && !reservation.outlets().isEmpty()) {
            html.append("<tr style=\"border-top:2px solid #d9c7b2;background:#fbf8f4;\">")
                    .append(emailCell("Branch total", "left", "font-weight:700;"))
                    .append(emailCell(escape(bills), "right", "font-weight:700;"))
                    .append(emailCell(escape(currency(totalSale, currencyCode)), "right", "font-weight:700;"))
                    .append(emailCell(escape(currency(totalTax, currencyCode)), "right", "font-weight:700;"))
                    .append(emailCell(escape(currency(totalGrand, currencyCode)), "right", "font-weight:700;color:#8c3f22;"))
                    .append("</tr>");
        }
        html.append("</tbody></table>");
        if (!oneCurrency) html.append("<p style=\"font-size:11px;color:#786b60;margin:10px 0 0;\">Money totals are shown separately for each outlet because the outlets use different currencies.</p>");
        if ("0".equals(bills)) html.append("<p style=\"padding:13px 15px;background:#f8f5ef;border-radius:6px;color:#716458;font-size:12px;\">No bills were recorded during this selected period.</p>");
        html.append("<div style=\"margin-top:18px;padding:14px 16px;background:#f8f5ef;border-left:3px solid #a24b2a;color:#65584d;font-size:12px;line-height:1.6;\">The attached CSV lists each bill included in this report, with its local business date and time, outlet, amounts, payment mode, and status.</div></td></tr>")
                .append("<tr><td style=\"padding:17px 30px;border-top:1px solid #eee5da;background:#fcfbf9;color:#8b8178;font-size:10px;line-height:1.6;\">Automated day-end report · Times are shown in the branch timezone · Please do not reply to this message.</td></tr>")
                .append("</table></td></tr></table></body></html>");
        String plain = reservation.businessName() + " — Day-end report\nBranch: " + reservation.branchName()
                + "\nBusiness period: " + period + " (" + reservation.zone().getId() + ")"
                + "\nBills: " + bills + "\nOutlets: " + reservation.outlets().size()
                + "\nThe attached CSV lists the bills included, with their local business date and time.";
        MimeMessage message = mail.createMimeMessage();
        MimeMessageHelper helper = new MimeMessageHelper(message, true, "UTF-8");
        helper.setFrom(mailFrom);
        helper.setTo(reservation.recipients().toArray(String[]::new));
        helper.setSubject(reservation.businessName() + " | " + reservation.branchName() + " | Day-end report | " + period);
        helper.setText(plain, html.toString());
        String fileStart = reservation.startAtLocal().format(DateTimeFormatter.ofPattern("uuuuMMdd-HHmm"));
        String fileEnd = reservation.endAtLocal().format(DateTimeFormatter.ofPattern("uuuuMMdd-HHmm"));
        helper.addAttachment("day-end-" + fileStart + "-to-" + fileEnd + ".csv", new ByteArrayResource(csv), "text/csv");
        mail.send(message);
    }

    private static String formatDateTime(LocalDateTime value) {
        return value.format(DateTimeFormatter.ofPattern("dd MMM uuuu, hh:mm a", Locale.ENGLISH));
    }
    private static String currency(BigDecimal amount, String code) {
        var format = java.text.NumberFormat.getCurrencyInstance(Locale.forLanguageTag("en-IN"));
        format.setCurrency(Currency.getInstance(code));
        return format.format(amount);
    }
    private static String emailCell(String value, String align, String extraStyle) {
        return "<td align=\"" + align + "\" style=\"padding:11px 9px;border-bottom:1px solid #eee8e0;color:#392f28;" + extraStyle + "\">" + value + "</td>";
    }
    private static String emailHeader(String value, String align) {
        return "<th align=\"" + align + "\" style=\"padding:10px 9px;border-bottom:1px solid #ddcbb7;font-size:10px;text-transform:uppercase;letter-spacing:.4px;\">" + value + "</th>";
    }
    private static String summaryCard(String label, String value) {
        return "<td width=\"33%\" style=\"padding:11px;background:#faf7f2;border:1px solid #eee7df;\"><div style=\"font-size:9px;letter-spacing:1px;color:#8c6a54;font-weight:bold;\">" + label + "</div><div style=\"font-size:17px;font-weight:bold;color:#39291f;margin-top:4px;\">" + escape(value) + "</div></td>";
    }

    @Scheduled(fixedDelayString = "${app.day-end-email.poll-ms:60000}")
    public void scheduledEmails() {
        if (!emailConfigured()) return;
        for (Map<String,Object> tenantRow : db.list("select id from tenants")) {
            UUID tenant = id(tenantRow);
            try {
                List<Map<String,Object>> due = db.asTenant(tenant, () -> db.list("""
                        select s.branch_id,tz.timezone from day_end_email_settings s
                        cross join lateral (select min(o.timezone) as timezone,count(distinct o.timezone) as timezone_count
                          from outlets o where o.tenant_id=s.tenant_id and o.branch_id=s.branch_id) tz
                        where s.tenant_id=? and s.scheduled=true
                          and tz.timezone_count=1 and tz.timezone is not null
                          and (now() at time zone tz.timezone)::time>=s.send_time
                          and not exists (select 1 from day_end_email_deliveries d where d.tenant_id=s.tenant_id and d.branch_id=s.branch_id
                            and d.start_date=(now() at time zone tz.timezone)::date and d.end_date=(now() at time zone tz.timezone)::date and d.status in ('SENT','SENDING'))
                          and not exists (select 1 from day_end_email_deliveries d where d.tenant_id=s.tenant_id and d.branch_id=s.branch_id
                            and d.start_date=(now() at time zone tz.timezone)::date and d.end_date=(now() at time zone tz.timezone)::date and d.status='FAILED'
                            and (d.attempts>=3 or d.started_at>now()-interval '5 minutes'))
                        """, tenant));
                for (Map<String,Object> row : due) {
                    UUID branchId = id(row.get("branch_id"));
                    LocalDate date = LocalDate.now(ZoneId.of(text(row.get("timezone"))));
                    Actor owner = db.asTenant(tenant, () -> {
                        Map<String,Object> user = db.one("select id,name,email from users where tenant_id=? and role='OWNER' and active=true order by created_at limit 1", tenant);
                        return new Actor(tenant, id(user), "OWNER", text(user.get("name")), text(user.get("email")));
                    });
                    try { deliver(owner, branchId, date.atStartOfDay(), date.atTime(23, 59), "SCHEDULED"); }
                    catch (ApiException ex) { LOG.warn("Scheduled branch day-end email skipped; tenant={}, branch={}, date={}, reason={}", tenant, branchId, date, ex.getMessage()); }
                }
            } catch (Exception ex) {
                LOG.error("Scheduled day-end email scan failed; tenant={}, category={}", tenant, ex.getClass().getSimpleName());
            }
        }
    }

    private void markFailed(UUID tenant, UUID branch, OffsetDateTime startAt, OffsetDateTime endAt, String message) {
        try { db.asTenant(tenant, () -> { db.update("update day_end_email_deliveries set status='FAILED',last_error=? where tenant_id=? and branch_id=? and start_at=? and end_at=? and status='SENDING'", message, tenant, branch, startAt, endAt); return null; }); }
        catch (Exception ex) { LOG.error("Could not persist day-end email failure; tenant={}, branch={}, startAt={}, endAt={}", tenant, branch, startAt, endAt); }
    }

    private static String failureDetails(Exception failure) {
        Throwable cause = failure;
        while (cause.getCause() != null && cause.getCause() != cause) cause = cause.getCause();
        String name = cause.getClass().getSimpleName();
        String message = cause.getMessage() == null ? "" : cause.getMessage().replaceAll("[\\r\\n\\t]+", " ").strip();
        String diagnostic = (name.isBlank() ? "Delivery failure" : name) + (message.isBlank() ? "" : ": " + message);
        diagnostic = diagnostic.replaceAll("(?i)(password\\s*[=:]\\s*)[^\\s,;]+", "$1[redacted]")
                .replaceAll("(?i)(MAIL_PASSWORD\\s*=\\s*)[^\\s,;]+", "$1[redacted]");
        if (diagnostic.length() > 480) diagnostic = diagnostic.substring(0, 477) + "...";
        return diagnostic;
    }

    private static List<String> stringList(Object value) {
        if (!(value instanceof List<?> values)) return List.of();
        List<String> output = new ArrayList<>();
        for (Object item : values) if (item instanceof String address) output.add(address);
        return List.copyOf(output);
    }
    private static BigDecimal amount(Object value) { try { return value == null ? BigDecimal.ZERO : new BigDecimal(value.toString()); } catch (NumberFormatException ex) { return BigDecimal.ZERO; } }
    private static String escape(String value) { return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;").replace("'", "&#39;"); }
    private static void requireOwner(Actor actor) { if (!"OWNER".equals(actor.role())) throw new ApiException(403, "Only the owner can manage day-end email."); }

    private record OutletInfo(String id, String name, String currency) {}
    private record Reservation(String businessName, String branchName, ZoneId zone, LocalDateTime startAtLocal, LocalDateTime endAtLocal,
                               OffsetDateTime startAt, OffsetDateTime endAt, List<String> recipients, List<OutletInfo> outlets) {}
}
