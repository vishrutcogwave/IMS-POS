import { dispatchPcPrint, pcBridgeReady, pcPrinting } from './pcPrinting';
import { Component, useEffect, useState } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { ArrowRight, BellRing, ChartNoAxesCombined, ChevronDown, ChevronRight, CircleHelp, LayoutDashboard, LayoutGrid, LogOut, Menu, PanelLeftClose, Printer, ReceiptText, Search, Settings2, Store, UserRound, X } from 'lucide-react';
import { api, ApiError, clearSession, configureSession, type BranchPrintState } from './api';
import { Auth, Profile } from './Auth';
import { Brand, brandTitle } from './Brand';
import Platform from './Platform';
import { DashboardPage, TablesPage, ReportsPage } from './Overview';
import { POSPage } from './POS';
import { BillsPage } from './Bills';
import { PrintingPage } from './Operations';
import { SettingsPage } from './Settings';
import { PrintUtilityPage } from './PcPrintSetup';
import type { Permission, Session } from './types';
import { Button, Empty, label, Loading, Modal, useAction, WorkspaceContext } from './ui';
import type { Navigation, Page } from './ui';

const navigation: { page: Page; title: string; permission?: Permission; Icon: typeof Store; group: string }[] = [
  { page: 'dashboard', title: 'Dashboard', permission: 'DASHBOARD', Icon: LayoutDashboard, group: 'WORKSPACE' },
  { page: 'floor', title: 'Tables', permission: 'ORDER', Icon: LayoutGrid, group: 'WORKSPACE' },


  { page: 'bills', title: 'Bills', permission: 'BILL', Icon: ReceiptText, group: 'WORKSPACE' },
  { page: 'reports', title: 'Reports', permission: 'REPORT', Icon: ChartNoAxesCombined, group: 'MANAGEMENT' },
  { page: 'settings', title: 'Masters', permission: 'SETTINGS', Icon: Settings2, group: 'MANAGEMENT' },
  { page: 'utility', title: 'Utility Settings', Icon: Printer, group: 'MANAGEMENT' },
];
export default function App() {
  const [session, setSession] = useState<Session | null>(null); const [booting, setBooting] = useState(true); const [bootError, setBootError] = useState(''); const [message, setMessage] = useState(''); const [outletId, setOutletId] = useState(''); const [branchId, setBranchId] = useState(() => localStorage.getItem('pos_active_branch') || ''); const [location, setLocation] = useState<Navigation>({ page: 'floor' }); const [mobileNav, setMobileNav] = useState(false); const [searchOpen, setSearchOpen] = useState(false); const [search, setSearch] = useState(''); const [help, setHelp] = useState(false); const logout = useAction();
  const [platformToken, setPlatformToken] = useState(() => sessionStorage.getItem('pos_platform_token') || '');
  const updatePlatformToken = (token: string) => {
    if (token) sessionStorage.setItem('pos_platform_token', token);
    else sessionStorage.removeItem('pos_platform_token');
    setPlatformToken(token);
  };
  const signedOut = (text = 'Your session has expired. Sign in to continue.') => { clearSession(); setSession(null); setOutletId(''); setBranchId(''); setMessage(text); setMobileNav(false); setSearchOpen(false); };
  const [branchPrint, setBranchPrint] = useState<BranchPrintState>();
  const [pcPrintError, setPcPrintError] = useState('');
  useEffect(() => {
    if (!session?.user.permissions.includes('PRINT')) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function printPending() {
      try {
        const config = pcPrinting();
        if (!config || stopped) return;
        const outlets = session?.outlets ?? [];
        const legacy = [];
        for (const outlet of outlets) if (!(await api.printPcStatus(outlet.id)).paired) legacy.push(outlet);
        if (!legacy.length || stopped) return;
        await pcBridgeReady(config);
        let failure = '';
        for (const outlet of legacy) {
          if (stopped) return;
          const { jobs } = await api.claimLocalPrint(outlet.id);
          for (const job of jobs) {
            const result = await dispatchPcPrint(config, job);
            await api.acknowledgeLocalPrint(job.id, job.claim_token, result);
            if (result.status !== 'PRINTED') failure = result.message;
          }
        }
        if (failure && !stopped) setPcPrintError(failure);
      } catch {
        if (!stopped) setPcPrintError('Windows printing is unavailable. Check the bridge in Utility Settings.');
      } finally {
        if (!stopped) timer = setTimeout(printPending, 4000);
      }
    }
    void printPending();
    return () => { stopped = true; clearTimeout(timer); };
  }, [session]);
  useEffect(() => {
    setBranchPrint(undefined);
    if (branchId === 'ALL' || !outletId || !session?.user.permissions.some(permission => ['ORDER','BILL','PRINT','SETTINGS'].includes(permission))) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const current = await api.printPcStatus(outletId, location.orderId);
        if (!stopped) setBranchPrint(current);
      } catch {
        // Keep the last confirmed status during a transient connection failure.
      } finally {
        if (!stopped) timer = setTimeout(poll,3000);
      }
    }
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [session, outletId, location.orderId, branchId]);
  const acceptSession = (value: Session) => { configureSession(value.csrfToken, () => signedOut()); const branches = (value.branches?.length ? value.branches.map(branch => [branch.id, branch.name] as const) : [...new Map(value.outlets.map(o => [o.branch_id, o.branch_name || o.branch_id] as const)).entries()]); const saved = localStorage.getItem('pos_active_branch') || ''; const chosen = branches.some(([id]) => id === branchId) ? branchId : saved === 'ALL' && value.user.role === 'OWNER' && branches.length > 1 ? 'ALL' : branches.some(([id]) => id === saved) ? saved : branches[0]?.[0] || ''; const chosenOutlet = value.outlets.find(o => o.id === outletId && (chosen === 'ALL' || o.branch_id === chosen)) || value.outlets.find(o => o.branch_id === chosen) || (chosen === 'ALL' ? value.outlets[0] : undefined); setSession(value); setBranchId(chosen); localStorage.setItem('pos_active_branch', chosen); setOutletId(chosenOutlet?.id || ''); setMessage(''); };
  const bootstrap = async () => { setBooting(true); setBootError(''); try { acceptSession(await api.me()); } catch (e) { if (e instanceof ApiError && e.status === 403) setMessage(e.message); else if (!(e instanceof ApiError && e.status === 401)) setBootError(e instanceof Error ? e.message : 'Unable to reach the restaurant server.'); } finally { setBooting(false); } };
  useEffect(() => { void bootstrap(); }, []);
  if (booting) return <div className="boot-screen"><div className="boot-brand"><Brand /></div><Loading text="Preparing your restaurant workspace…" /></div>;
  if (bootError && !session) return <div className="boot-screen"><div className="boot-brand"><Brand /></div><h2>Your workspace is taking a moment.</h2><p>{bootError}</p><Button onClick={() => void bootstrap()}>Reconnect to the server</Button></div>;
  if (platformToken) return <Platform token={platformToken} onSignOut={() => { updatePlatformToken(''); setMessage('You have signed out.'); }} />;
  if (!session) return <Auth onSession={acceptSession} onPlatformSession={updatePlatformToken} message={message} />;
  const can = (permission: Permission) => session.user.permissions.includes(permission);
  const allowed = navigation.filter(n => (!n.permission || can(n.permission)) && (n.page !== 'settings' || ['OWNER', 'MANAGER'].includes(session.user.role)));
  const page = location.page === 'profile' || (location.page === 'pos' && can('ORDER') && !!(location.orderId || location.tableId)) || allowed.some(n => n.page === location.page) ? location.page : allowed[0]?.page || 'profile';
  const current = navigation.find(n => n.page === (page === 'pos' ? 'floor' : page)); const outlet = session.outlets.find(o => o.id === outletId); const branches = (session.branches?.length ? session.branches.map(branch => [branch.id, branch.name] as const) : [...new Map(session.outlets.map(o => [o.branch_id, o.branch_name || o.branch_id] as const)).entries()]); const allBranches = branchId === 'ALL' && session.user.role === 'OWNER'; const selectedBranchId = allBranches ? 'ALL' : branchId; const branchName = allBranches ? 'All branches' : branches.find(([id]) => id === branchId)?.[1] || 'Select branch';
  const navigate = (to: Navigation) => { setLocation(to); setMobileNav(false); setSearchOpen(false); };
  const refreshSession = async () => acceptSession(await api.me());
  const renderPage = () => {
    if (allBranches && !['dashboard','reports','profile'].includes(page)) return <div className="page"><Empty title="Choose one branch to continue" text="Floor, bills, and printing actions work within one hotel branch at a time. Select a branch from the top menu." /></div>;
    if (page === 'profile') return <Profile />;
    if (page === 'settings') return <SettingsPage onOutletChange={setOutletId} />;
    if (page === 'utility') return <PrintUtilityPage />;
    if (!outletId && !['dashboard','reports','settings','profile','floor'].includes(page)) return <div className="page"><Empty title="A branch setup is waiting for you" text="This branch has no service setup yet. Ask an owner to configure it in Masters." action={allowed.some(n => n.page === 'settings') ? <Button onClick={() => navigate({ page: 'settings' })}>Set up an outlet <ArrowRight size={17} /></Button> : <Button className="secondary" onClick={() => navigate({ page: 'profile' })}>View your profile</Button>} /></div>;
    switch (page) {
      case 'dashboard': return <DashboardPage />;
      case 'floor': return <TablesPage />;
      case 'pos': return <POSPage key={`${outletId}-${location.orderId || ''}-${location.tableId || ''}`} initialOrderId={location.orderId} initialTableId={location.tableId} />;

      case 'bills': return <BillsPage initialBillId={location.billId} />;
      case 'reports': return <ReportsPage />;
      case 'printing': return <PrintingPage />;
    }
  };
  return <WorkspaceContext.Provider value={{ session, outletId, outlet, branchId: selectedBranchId, branchName, allBranches, can, selectOutlet: setOutletId, navigate, refreshSession, signedOut }}><div className="app-shell">{mobileNav && <button className="nav-scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}<aside className={`sidebar ${mobileNav ? 'is-open' : ''}`}><button className="brand" onClick={() => navigate({ page: allowed[0]?.page || 'profile' })} aria-label={brandTitle + ' home'}><Brand /></button><button className="mobile-nav-close icon-button" aria-label="Close navigation" onClick={() => setMobileNav(false)}><PanelLeftClose size={22} /></button><div className="workspace-identity"><span className="workspace-avatar">{session.tenant.name.slice(0, 1)}</span><div><strong>{session.tenant.name}</strong><span>{session.tenant.slug}</span></div></div><nav aria-label="Main navigation">{['WORKSPACE', 'MANAGEMENT'].map(group => <div className="nav-group" key={group}>{allowed.some(n => n.group === group) && <span className="nav-label">{group}</span>}{allowed.filter(n => n.group === group).map(({ page: destination, title, Icon }) => <button key={destination} className={`nav-item ${page === destination ? 'active' : ''}`} onClick={() => navigate({ page: destination })} title={title} aria-current={page === destination ? 'page' : undefined}><Icon size={19} strokeWidth={1.8} /><span>{title}</span>{page === destination && <span className="nav-active-dot" />}</button>)}</div>)}</nav><div className="sidebar-bottom"><button className="service-note" onClick={() => setHelp(true)}><div><span className="service-note-icon"><CircleHelp size={19} /></span><strong>Here’s to good service.</strong></div><span>Your workspace, explained <ChevronRight size={14} /></span></button><button className="user-menu" onClick={() => navigate({ page: 'profile' })} title="Your profile"><span className="user-avatar">{session.user.name.split(' ').map(s => s[0]).slice(0, 2).join('')}</span><span><strong>{session.user.name}</strong><small>{label(session.user.role)}</small></span><ChevronRight size={16} /></button>{logout.feedback}<button className="signout-button" disabled={logout.blocked} onClick={() => void logout.run(async () => { await api.logout(); signedOut('You have signed out securely.'); })}><LogOut size={16} /><span>{logout.busy ? 'Signing out…' : 'Sign out'}</span></button></div></aside><div className="main-shell"><header className="topbar"><div className="topbar-left"><button className="icon-button menu-toggle" aria-label="Open navigation" onClick={() => setMobileNav(true)}><Menu size={22} /></button><span className="breadcrumb">Workspace <ChevronRight size={13} /><strong>{current?.title || 'Your profile'}</strong></span></div><div className="topbar-right"><button className="command-search" onClick={() => setSearchOpen(true)} aria-label="Find a workspace page"><Search size={17} /><span>Go to…</span></button><div className="outlet-select"><Store size={17} /><select aria-label="Current branch" value={selectedBranchId} disabled={!branches.length} onChange={e => { const next = e.target.value; setBranchId(next); localStorage.setItem('pos_active_branch', next); const nextOutlet = next === 'ALL' ? session.outlets[0] : session.outlets.find(o => o.branch_id === next); if (nextOutlet) setOutletId(nextOutlet.id); setLocation({ page: next === 'ALL' ? 'dashboard' : ['floor','pos','bills'].includes(page) ? 'floor' : page }); }}><option value="" disabled>Select branch</option>{session.user.role === 'OWNER' && branches.length > 1 && <option value="ALL">All branches</option>}{branches.map(([id,name]) => <option key={id} value={id}>{name}</option>)}</select><ChevronDown size={14} /></div><span className="topbar-divider" /><button className="topbar-avatar" onClick={() => navigate({ page: 'profile' })} aria-label="Open your profile">{session.user.name.slice(0, 1)}</button></div></header><main className="main-content" id="main-content">{pcPrintError && <div className="notice warning" role="status">{pcPrintError} <button className="text-button" onClick={() => setPcPrintError('')}>Dismiss</button></div>}<PageBoundary key={page === 'settings' ? page : page + '-' + outletId}>{renderPage()}</PageBoundary>{branchPrint?.paired && <BranchPrintFeedback state={branchPrint} />}</main><footer className="shell-footer"><span><span className="tiny-dot" />{session.tenant.name} · {branchName}</span><span>Made for the art of hospitality.</span></footer></div></div>{searchOpen && <Modal title="Where would you like to go?" onClose={() => setSearchOpen(false)}><div className="search-box command-input"><Search size={20} /><input autoFocus placeholder="Search your workspace…" value={search} onChange={e => setSearch(e.target.value)} aria-label="Search workspace pages" /></div><div className="command-results">{[...allowed, { page: 'profile' as const, title: 'Your profile', Icon: UserRound }].filter(n => n.title.toLowerCase().includes(search.toLowerCase())).map(({ page: p, title, Icon }) => <button key={p} onClick={() => { navigate({ page: p }); setSearch(''); }}><Icon size={19} /><span>{title}</span><ArrowRight size={17} /></button>)}</div></Modal>}{help && <Modal title="A calmer service starts here" subtitle="A quick guide to your POS workspace." onClose={() => setHelp(false)}><div className="help-steps"><div><LayoutGrid size={22} /><span><strong>1. Open & build an order</strong><p>Choose an outlet and table, then add dishes. Each line is saved immediately, with server-verified prices.</p></span></div><div><Printer size={22} /><span><strong>2. Send the KOT</strong><p>Unsent lines become category-routed KOTs. Sent lines are immutable; authorized cancellations leave an audit trail.</p></span></div><div><ReceiptText size={22} /><span><strong>3. Bill & settle with care</strong><p>Split exact item quantities if needed. Record only confirmed payments. Card and UPI are manual, not gateway-connected.</p></span></div><div><BellRing size={22} /><span><strong>4. Check the print desk</strong><p>Queued jobs need a local print agent. Inspect uncertain output before explicitly retrying.</p></span></div></div><div className="notice info">Your visible pages follow the permissions returned by the server. Outlet access is always enforced by the backend.</div><Button className="full" onClick={() => setHelp(false)}>Back to service <X size={16} /></Button></Modal>}</WorkspaceContext.Provider>;
}
class PageBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('Workspace render error', error, info.componentStack); }
  render() { return this.state.failed ? <div className="page"><Empty title="This view couldn’t be displayed" text="Reload the page to fetch a fresh server response. Your saved restaurant data is not changed." action={<Button onClick={() => window.location.reload()}>Reload workspace</Button>} /></div> : this.props.children; }
}

function BranchPrintFeedback({ state }: { state: BranchPrintState }) {
  const labels = { QUEUED: 'Queued', SENT_TO_PRINTER: 'Sent to printer', FAILED: 'Failed', NEEDS_REVIEW: 'Needs review' };
  const important = state.jobs.filter(job => job.status === 'NEEDS_REVIEW' || job.status === 'FAILED');
  return <section className="card" aria-label="Branch print status">
    {!state.online && <p className="notice warning">Branch print PC is offline. Jobs stay queued until it reconnects or they expire.</p>}
    {important.length > 0 && <div className="notice warning" role="status">
      {important.slice(0,3).map(job => <p key={job.id}>{job.document_type.replace('_',' ')} · {labels[job.status]}{job.error ? ' · '+job.error : ''}
        {job.status === 'NEEDS_REVIEW' && ' Check the physical printer before resending.'}</p>)}
    </div>}
    <details open>
      <summary>Print status</summary>
      {state.jobs.length ? <ul>{state.jobs.map(job => <li key={job.id}>{job.document_type.replace('_',' ')} · {labels[job.status]}</li>)}</ul> : <p>No print jobs yet.</p>}
    </details>
  </section>;
}