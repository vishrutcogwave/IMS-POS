import { cloneElement, createContext, isValidElement, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import type { DependencyList, FormEvent, ReactNode } from 'react';
import { AlertCircle, ArrowLeft, Check, ChevronRight, CircleCheck, LoaderCircle, RefreshCw, UtensilsCrossed, X } from 'lucide-react';
import { ApiError } from './api';
import type { Amount, DateRange, OrderItem, Outlet, Permission, Session } from './types';

export type Page = 'dashboard' | 'floor' | 'pos' | 'utility' | 'bills' | 'kitchen' | 'reports' | 'settings' | 'printing' | 'profile';
export interface Navigation { page: Page; orderId?: string; tableId?: string; billId?: string }
export interface Workspace { session: Session; outletId: string; outlet?: Outlet; branchId: string; branchName: string; allBranches: boolean; can: (permission: Permission) => boolean; selectOutlet: (id: string) => void; navigate: (to: Navigation) => void; refreshSession: () => Promise<void>; signedOut: (message?: string) => void }
export const WorkspaceContext = createContext<Workspace | null>(null);
export function useWorkspace() { const value = useContext(WorkspaceContext); if (!value) throw new Error('Workspace is unavailable'); return value; }
export const label = (s: string) => s.replaceAll('_', ' ').replaceAll('-', ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
export const number = (n: Amount | null | undefined) => Number(n ?? 0);
export const cents = (n: Amount) => Math.round(Number(n) * 100);
export const itemName = (item: OrderItem) => item.name || item.item_name || 'Menu item';
export const activeLine = (item: OrderItem) => item.status !== 'CANCELLED' && !item.cancelled && item.quantity > 0;
export const dateTime = (s?: string) => s ? new Date(s).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
export function money(value: Amount | undefined | null, currency = 'INR') { return new Intl.NumberFormat('en-IN', { style: 'currency', currency, minimumFractionDigits: 2 }).format(number(value)); }
export function useMoney() { const { outlet } = useWorkspace(); return (value?: Amount | null) => money(value, outlet?.currency || 'INR'); }
export function today(timezone?: string) { return new Intl.DateTimeFormat('en-CA', { timeZone: timezone || undefined, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
export function useDateRange() { const { outlet } = useWorkspace(); return useState<DateRange>(() => ({ from: today(outlet?.timezone), to: today(outlet?.timezone) })); }

export function useLoad<T>(load: () => Promise<T>, deps: DependencyList) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<Error>();
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision(n => n + 1), []);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(undefined);
    load().then(value => { if (active) setData(value); }).catch((e: unknown) => { if (active) setError(asError(e)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
    // Callers supply resource identity dependencies; do not depend on the inline loader.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, revision]);
  return { data, setData, error, loading, reload };
}
function asError(error: unknown): Error { return error instanceof Error ? error : new Error('An unexpected error occurred.'); }
export function useAction(reload?: () => void) {
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState<Error>();
  const [success, setSuccess] = useState('');
  const last = useRef<(() => Promise<unknown>) | null>(null);
  const run = async <T,>(action: () => Promise<T>, message = ''): Promise<T | undefined> => {
    if (lock.current) return undefined;
    lock.current = true; setBusy(true); setError(undefined); setSuccess('');
    last.current = () => run(action, message);
    try { const result = await action(); setSuccess(message); last.current = null; return result; }
    catch (e) { setError(asError(e)); return undefined; }
    finally { lock.current = false; setBusy(false); }
  };
  const conflict = error instanceof ApiError && error.status === 409;
  const uncertain = error instanceof ApiError && error.uncertain;
  const feedback = <>
    {error && <div className="notice error" role="alert"><AlertCircle size={18} /><div><strong>{conflict ? 'This change conflicts with existing data.' : uncertain ? 'Result not confirmed' : 'Could not complete action'}</strong><p>{error.message}</p><ValidationIssues error={error} /><ApiErrorDetails error={error} />{conflict && reload && <button className="text-button" onClick={() => { setError(undefined); reload(); }}>Reload latest record before making changes</button>}{uncertain && <button className="text-button" disabled={busy} onClick={() => void last.current?.()}>Retry this exact request</button>}</div></div>}
    {success && <div className="notice success" role="status"><CircleCheck size={18} /><span>{success}</span><button className="icon-button" aria-label="Dismiss message" onClick={() => setSuccess('')}><X size={15} /></button></div>}
  </>;
  return { run, busy, error, feedback, blocked: busy || uncertain || (conflict && !Object.keys(error.fieldErrors).length), clear: () => { setError(undefined); setSuccess(''); } };
}
export function Loading({ text = 'Loading your workspace…' }: { text?: string }) { return <div className="loading" role="status"><LoaderCircle size={22} className="spin" /><span>{text}</span></div>; }
export function LoadError({ error, retry }: { error: Error; retry: () => void }) { return <div className="notice error" role="alert"><AlertCircle size={20} /><div><strong>Unable to load</strong><p>{error.message}</p><ApiErrorDetails error={error} /><button className="text-button" onClick={retry}>Try again</button></div></div>; }
export function Empty({ title, text, action }: { title: string; text: string; action?: ReactNode }) { return <div className="empty"><span className="empty-icon"><UtensilsCrossed size={28} strokeWidth={1.4} /></span><h3>{title}</h3><p>{text}</p>{action}</div>; }
export function Badge({ status, children }: { status?: string; children?: ReactNode }) { return <span className={`badge ${(status || '').toLowerCase().replaceAll('_', '-')}`}>{children || label(status || '')}</span>; }
export function Button({ children, busy, className = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) { return <button {...props} className={`button ${className}`} disabled={props.disabled || busy}>{busy && <LoaderCircle size={16} className="spin" />}{children}</button>; }
const fieldNames: Record<string, string> = {
  slug: 'Property ID', tenantSlug: 'Property ID', businessName: 'Restaurant name',
  email: 'Email address', startsOn: 'Start date', expiresAt: 'Expiry date', maxBranches: 'Branch limit',
};
function fieldLabel(path: string) {
  return path.split('.').map(part => fieldNames[part] ?? label(part.replace(/([a-z])([A-Z])/g, '$1 $2'))).join(' / ');
}
export function ValidationIssues({ error }: { error: unknown }) {
  if (!(error instanceof ApiError)) return null;
  const issues = Object.entries(error.fieldErrors);
  if (!issues.length) return null;
  return <ul className="validation-issues">{issues.map(([path, message]) =>
    <li key={path}><strong>{fieldLabel(path)}:</strong> {message}</li>)}</ul>;
}
export function ApiErrorDetails({ error }: { error: unknown }) {
  if (!(error instanceof ApiError)) return null;
  const endpoint = error.method && error.path ? `${error.method} ${error.path}` : '';
  const status = error.status ? `HTTP ${error.status}` : 'Network error';
  return <small>{[status, endpoint, error.requestId ? `Request ID: ${error.requestId}` : ''].filter(Boolean).join(' · ')}</small>;
}
export function Field({ label: title, children, hint, error, className = '' }: {
  label: string; children: ReactNode; hint?: string; error?: string; className?: string;
}) {
  const messageId = useId();
  return <label className={`field ${error ? 'field-invalid' : ''} ${className}`}><span>{title}</span>
    {error && isValidElement<{ 'aria-invalid'?: boolean; 'aria-describedby'?: string }>(children)
      ? cloneElement(children, { 'aria-invalid': true, 'aria-describedby': messageId })
      : children}
    {hint && <small>{hint}</small>}
    {error && <small className="field-error" id={messageId}>{error}</small>}
  </label>;
}
export function CheckField({ label: title, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) { return <label className="check-field"><input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} disabled={disabled} /><span>{title}</span></label>; }
export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode }) { return <div className="page-heading"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1>{description && <p>{description}</p>}</div>{actions && <div className="heading-actions min-w-0">{actions}</div>}</div>; }
export function Refresh({ onClick, busy }: { onClick: () => void; busy?: boolean }) { return <button className="button subtle" onClick={onClick} disabled={busy}><RefreshCw size={16} className={busy ? 'spin' : ''} /><span>Refresh</span></button>; }
export function DateFilters({ value, onChange }: { value: DateRange; onChange: (range: DateRange) => void }) {
  const [draft, setDraft] = useState(value);
  const [issue, setIssue] = useState('');
  useEffect(() => setDraft(value), [value.from, value.to]);
  const change = (next: DateRange) => { setDraft(next); setIssue(''); };
  return <form className="date-filter" onSubmit={e => {
    e.preventDefault();
    const start = Date.parse(`${draft.from}T00:00:00Z`);
    const end = Date.parse(`${draft.to}T00:00:00Z`);
    const inclusiveDays = Math.floor((end - start) / 86_400_000) + 1;
    if (!Number.isFinite(start) || !Number.isFinite(end) || inclusiveDays < 1) { setIssue('Choose a valid start and end date.'); return; }
    if (inclusiveDays > 3660) { setIssue('Choose a date range of 10 years or less.'); return; }
    setIssue(''); onChange(draft);
  }}><Field label="From"><input type="date" required value={draft.from} max={draft.to} onChange={e => change({ ...draft, from: e.target.value })} /></Field><Field label="To"><input type="date" required min={draft.from} value={draft.to} onChange={e => change({ ...draft, to: e.target.value })} /></Field>{issue && <small className="field-error" role="alert">{issue}</small>}<Button type="submit" className="secondary">Apply <ChevronRight size={15} /></Button></form>;
}
let modalSequence = 0;
export function Modal({ title, subtitle, children, onClose, wide = false, noClose = false }: { title: string; subtitle?: string; children: ReactNode; onClose: () => void; wide?: boolean; noClose?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [titleId] = useState(() => `modal-${++modalSequence}`);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    const root = ref.current;
    const focusable = () => Array.from(root?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]') || []).filter(el => el.offsetParent !== null);
    (focusable()[0] || root)?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !noClose) closeRef.current();
      if (e.key === 'Tab') { const nodes = focusable(); const first = nodes[0], last = nodes[nodes.length - 1]; if (!first) { e.preventDefault(); return; } if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } }
    };
    document.addEventListener('keydown', handler);
    return () => { document.removeEventListener('keydown', handler); document.body.style.overflow = oldOverflow; previous?.focus(); };
  }, [noClose]);
  return <div className="modal-backdrop"><div ref={ref} className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}><div className="modal-heading"><div><h2 id={titleId}>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{!noClose && <button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={21} /></button>}</div>{children}</div></div>;
}
export function ReasonDialog({ title, text, onClose, onConfirm, danger = false, duplicate = false, children }: { title: string; text: string; onClose: () => void; onConfirm: (reason: string) => Promise<unknown>; danger?: boolean; duplicate?: boolean; children?: ReactNode }) {
  const [reason, setReason] = useState(''); const [ack, setAck] = useState(false); const action = useAction(onClose);
  const submit = (e: FormEvent) => { e.preventDefault(); void action.run(async () => { await onConfirm(duplicate ? `${reason.trim()} — I acknowledge possible duplicate physical output.` : reason.trim()); onClose(); }); };
  return <Modal title={title} subtitle={text} onClose={onClose} noClose={action.busy}><form onSubmit={submit}><fieldset disabled={action.blocked}>{children}<Field label="Required audit reason"><textarea value={reason} onChange={e => setReason(e.target.value)} required minLength={3} maxLength={500} placeholder="Explain why this action is needed" /></Field>{duplicate && <CheckField label="I understand a previous attempt may already have printed. Retrying may create duplicate copies." checked={ack} onChange={setAck} />}</fieldset>{action.feedback}<div className="modal-actions"><Button type="button" className="subtle" onClick={onClose} disabled={action.busy}>Back</Button><Button type="submit" className={danger ? 'danger' : ''} busy={action.busy} disabled={action.blocked || reason.trim().length < 3 || (duplicate && !ack)}>{danger ? 'Confirm cancellation' : 'Confirm action'} <Check size={16} /></Button></div></form></Modal>;
}
export function BackButton({ onClick, children = 'Back' }: { onClick: () => void; children?: ReactNode }) { return <button className="text-button" onClick={onClick}><ArrowLeft size={16} />{children}</button>; }
