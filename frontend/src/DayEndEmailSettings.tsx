import { useEffect, useState } from 'react';
import { CalendarDays, Clock3, Eye, Mail, Save } from 'lucide-react';
import { api } from './api';
import type { Branch, DayEndEmailDelivery, DayEndEmailSetting, Outlet } from './types';
import { Badge, Button, CheckField, Empty, Field, Modal, today, useAction } from './ui';

function daysBefore(day: string, days: number) {
  const value = new Date(`${day}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

function localDateTimeInput(timezone: string, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const part = (type: string) => parts.find(item => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}

function formatInBranchTime(value: string | undefined, timezone: string) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-IN', {
    timeZone: timezone, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true,
  }).format(date);
}

export function DayEndEmailSettingsPage({ branches, outlets, activeBranchId, settings, deliveries, emailConfigured, onSaved }: {
  branches: Branch[]; outlets: Outlet[]; activeBranchId: string; settings: DayEndEmailSetting[];
  deliveries: DayEndEmailDelivery[]; emailConfigured: boolean; onSaved: () => Promise<void>;
}) {
  const [branchId, setBranchId] = useState(activeBranchId !== 'ALL' ? activeBranchId : branches[0]?.id || '');
  const branch = branches.find(item => item.id === branchId);
  const branchOutlets = outlets.filter(item => item.branch_id === branchId);
  const timezoneNames = [...new Set(branchOutlets.map(item => item.timezone))];
  const timezone = timezoneNames[0] || 'Asia/Kolkata';
  const current = settings.find(item => item.branch_id === branchId);
  const [recipients, setRecipients] = useState('');
  const [scheduled, setScheduled] = useState(false);
  const [sendTime, setSendTime] = useState('23:00');
  const action = useAction();
  const closeAction = useAction();
  const [closeDialog, setCloseDialog] = useState(false);
  const [viewDelivery, setViewDelivery] = useState<DayEndEmailDelivery | null>(null);
  const [emailNotice, setEmailNotice] = useState('');
  const todayDate = today(timezone);
  const earliestDate = daysBefore(todayDate, 3);
  const [startAt, setStartAt] = useState(`${todayDate}T00:00`);
  const [endAt, setEndAt] = useState(() => localDateTimeInput(timezone));
  const earliestAt = `${earliestDate}T00:00`;
  const latestAt = localDateTimeInput(timezone);
  useEffect(() => {
    setRecipients(current?.recipients.join(', ') || '');
    setScheduled(current?.scheduled || false);
    setSendTime((current?.send_time || '23:00').slice(0, 5));
    setStartAt(`${today(timezone)}T00:00`);
    setEndAt(localDateTimeInput(timezone));
    setEmailNotice('');
    action.clear();
    closeAction.clear();
  }, [branchId, settings]);
  const history = deliveries.filter(item => item.branch_id === branchId);
  const manualCloseAvailable = !scheduled && current?.scheduled !== true;
  const parseRecipients = () => recipients.split(/[;,\n]+/).map(value => value.trim()).filter(Boolean);
  if (!branches.length) return <Empty title="No branches available" text="Create a branch and at least one outlet before configuring its day-end email." />;
  return <section className="card">
    <div className="section-heading"><div><h2>Day-end email · {branch?.name || 'Branch'}</h2><p>One report for all outlets in this branch. The schedule uses the branch’s outlet timezone.</p></div><Mail size={22} className="muted" /></div>
    <Field label="Branch"><select aria-label="Day-end email branch" value={branchId} onChange={event => setBranchId(event.target.value)}>
      {branches.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select></Field>
    {branchOutlets.length > 0 && <p className="small-text muted">Includes {branchOutlets.map(item => item.name).join(', ')} · {timezone}</p>}
    <div className="notice info"><span>Reports are sent only to the recipient addresses listed below.</span></div>
    {!branchOutlets.length && <div className="notice warning"><span>Add at least one outlet to this branch before configuring email.</span></div>}
    {timezoneNames.length > 1 && <div className="notice warning"><span>All outlets in a branch must use the same timezone for the day-end report. Update their timezone in outlet settings.</span></div>}
    {!emailConfigured && <div className="notice warning"><span>Email delivery needs SMTP settings in the local `.env` file and a backend restart. Saving recipients is available now.</span></div>}
    <form onSubmit={event => {
      event.preventDefault();
      void action.run(async () => {
        await api.saveDayEndEmailSettings(branchId, parseRecipients(), scheduled, sendTime);
        await onSaved();
      }, 'Branch day-end email settings saved.');
    }}>
      <Field label="Report recipient email addresses" hint="Add one to five addresses. Reports go only to these addresses, separated by commas or new lines.">
        <textarea value={recipients} onChange={event => setRecipients(event.target.value)} rows={3} maxLength={1300} placeholder="manager@example.com, accounts@example.com" />
      </Field>
      <CheckField label="Automatically email the branch report every day" checked={scheduled} onChange={setScheduled} />
      {scheduled && <Field label="Send time · branch local time"><input type="time" required value={sendTime} onChange={event => setSendTime(event.target.value)} /></Field>}
      <p className="small-text muted"><Clock3 size={14} /> The report covers every outlet in the branch. If the server is offline, it sends when the server next comes online.</p>
      {action.feedback}
      <div className="modal-actions"><Button busy={action.busy} disabled={!branchOutlets.length || timezoneNames.length > 1 || !recipients.trim()}><Save size={16} />Save branch email settings</Button></div>
    </form>
    <div className="section-divider" />
    {manualCloseAvailable && <div className="section-heading"><div><h3>Manual branch close</h3><p>Choose a date and time range within the last four local dates, then email all outlets in this branch.</p></div><Button disabled={!branchOutlets.length || timezoneNames.length > 1} onClick={() => { closeAction.clear(); setEmailNotice(''); setStartAt(`${today(timezone)}T00:00`); setEndAt(localDateTimeInput(timezone)); setCloseDialog(true); }}><Mail size={16} />Close Branch &amp; Email</Button></div>}
    {emailNotice && <div className="notice success" role="status">{emailNotice}</div>}
    <div className="section-heading"><div><h3>Recent branch day-end emails</h3><p>Delivery attempts for this branch.</p></div></div>
    {history.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Business period · {timezone}</th><th>Sent by</th><th>Status</th><th>Attempts</th><th>Details</th><th>Action</th></tr></thead><tbody>
      {history.map((entry, index) => <tr key={`${entry.start_at || entry.start_date}-${entry.end_at || entry.end_date}-${index}`}><td>{entry.start_at && entry.end_at ? `${formatInBranchTime(entry.start_at, timezone)} – ${formatInBranchTime(entry.end_at, timezone)}` : entry.start_date === entry.end_date ? entry.start_date : `${entry.start_date} – ${entry.end_date}`}</td><td>{entry.trigger === 'MANUAL' ? 'Owner' : 'Schedule'}</td><td><Badge status={entry.status}>{entry.status}</Badge></td><td>{entry.attempts}</td><td>{entry.last_error || (entry.sent_at ? 'Delivered' : 'In progress')}</td><td><button className="text-button" onClick={() => setViewDelivery(entry)}><Eye size={15} />View</button></td></tr>)}
    </tbody></table></div> : <Empty title="No branch day-end emails yet" text="Manual and scheduled delivery results will appear here." />}
    {viewDelivery && <Modal title={viewDelivery.status === 'FAILED' ? 'Failed email details' : 'Day-end email details'} subtitle={`${viewDelivery.branch_name} · ${viewDelivery.start_at && viewDelivery.end_at ? `${formatInBranchTime(viewDelivery.start_at, timezone)} – ${formatInBranchTime(viewDelivery.end_at, timezone)}` : `${viewDelivery.start_date}${viewDelivery.end_date !== viewDelivery.start_date ? ` to ${viewDelivery.end_date}` : ''}`}`} onClose={() => setViewDelivery(null)}>
      <dl className="detail-list"><div><dt>Status</dt><dd><Badge status={viewDelivery.status}>{viewDelivery.status}</Badge></dd></div><div><dt>Triggered by</dt><dd>{viewDelivery.trigger === 'MANUAL' ? 'Owner' : 'Automatic schedule'}</dd></div><div><dt>Attempts</dt><dd>{viewDelivery.attempts}</dd></div>{viewDelivery.started_at && <div><dt>Last attempt</dt><dd>{formatInBranchTime(viewDelivery.started_at, timezone)}</dd></div>}</dl>
      <div className={viewDelivery.status === 'FAILED' ? 'notice error' : 'notice info'}><div><strong>{viewDelivery.status === 'FAILED' ? 'Failure details' : 'Delivery details'}</strong><p>{viewDelivery.last_error || (viewDelivery.sent_at ? 'Email delivered successfully.' : 'Delivery is still in progress.')}</p></div></div>
      {viewDelivery.status === 'FAILED' && viewDelivery.last_error?.includes('Check backend logs') && <p className="small-text muted">This failure was recorded before detailed diagnostics were available. Retry after restarting the backend to capture the underlying error.</p>}
      <div className="modal-actions"><Button type="button" className="secondary" onClick={() => setViewDelivery(null)}>Close</Button></div>
    </Modal>}
    {closeDialog && branch && <Modal title="Close branch and email report?" subtitle={`${branch.name} · ${timezone} · Includes all outlets in this branch.`} onClose={() => setCloseDialog(false)} noClose={closeAction.busy}>
      <p>Select a start and end date/time. Both must fall within the last four local dates; the selected end minute is included.</p>
      <p className="small-text muted">The report filters bills in {timezone}. The CSV includes each bill’s local business date and time.</p>
      {!emailConfigured && <div className="notice warning"><span>Configure SMTP in `.env` and restart the backend before sending email.</span></div>}
      <div className="form-grid">
        <Field label="Start date and time · branch local"><input type="datetime-local" required min={earliestAt} max={endAt || latestAt} value={startAt} onChange={event => { setStartAt(event.target.value); if (event.target.value > endAt) setEndAt(event.target.value); }} /></Field>
        <Field label="End date and time · inclusive"><input type="datetime-local" required min={startAt || earliestAt} max={latestAt} value={endAt} onChange={event => setEndAt(event.target.value)} /></Field>
      </div>
      {closeAction.feedback}
      <div className="modal-actions"><Button type="button" className="secondary" disabled={closeAction.busy} onClick={() => setCloseDialog(false)}>Cancel</Button><Button type="button" busy={closeAction.busy} disabled={!emailConfigured || !recipients.trim() || !startAt || !endAt || startAt > endAt || startAt < earliestAt || endAt > latestAt} onClick={() => void closeAction.run(async () => {
        const result = await api.sendDayEndEmail(branchId, startAt, endAt);
        await onSaved();
        setEmailNotice(`Branch report from ${result.startAt} to ${result.endAt} was emailed to ${result.recipients.join(', ')}.`);
        setCloseDialog(false);
        return result;
      })}><CalendarDays size={16} />Close &amp; Email Report</Button></div>
    </Modal>}
  </section>;
}
