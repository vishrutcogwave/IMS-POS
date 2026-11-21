import { Component, useEffect, useState } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { ArrowRight, BellRing, ChartNoAxesCombined, ChefHat, ChevronDown, ChevronRight, CircleHelp, Flame, LayoutDashboard, LayoutGrid, LogOut, Menu, PanelLeftClose, Printer, ReceiptText, Search, Settings2, ShoppingBag, Store, UserRound, X } from 'lucide-react';
import { api, ApiError, clearSession, configureSession } from './api';
import { Auth, Profile } from './Auth';
import { DashboardPage, FloorPage, ReportsPage } from './Overview';
import { POSPage } from './POS';
import { BillsPage } from './Bills';
import { KitchenPage, PrintingPage } from './Operations';
import { SettingsPage } from './Settings';
import type { Permission, Session } from './types';
import { Button, Empty, label, Loading, Modal, useAction, WorkspaceContext } from './ui';
import type { Navigation, Page } from './ui';

const navigation: { page: Page; title: string; permission: Permission; Icon: typeof Store; group: string }[] = [
  { page: 'dashboard', title: 'Dashboard', permission: 'DASHBOARD', Icon: LayoutDashboard, group: 'WORKSPACE' },
  { page: 'floor', title: 'Floor & tables', permission: 'ORDER', Icon: LayoutGrid, group: 'WORKSPACE' },
  { page: 'pos', title: 'Point of sale', permission: 'ORDER', Icon: ShoppingBag, group: 'WORKSPACE' },
  { page: 'kitchen', title: 'Kitchen', permission: 'KITCHEN', Icon: ChefHat, group: 'WORKSPACE' },
  { page: 'bills', title: 'Bills', permission: 'BILL', Icon: ReceiptText, group: 'WORKSPACE' },
  { page: 'reports', title: 'Reports', permission: 'REPORT', Icon: ChartNoAxesCombined, group: 'MANAGEMENT' },
  { page: 'settings', title: 'Settings', permission: 'SETTINGS', Icon: Settings2, group: 'MANAGEMENT' },
  { page: 'printing', title: 'Print queue', permission: 'PRINT', Icon: Printer, group: 'MANAGEMENT' },
];
export default function App() {
  const [session, setSession] = useState<Session | null>(null); const [booting, setBooting] = useState(true); const [bootError, setBootError] = useState(''); const [message, setMessage] = useState(''); const [outletId, setOutletId] = useState(''); const [location, setLocation] = useState<Navigation>({ page: 'dashboard' }); const [mobileNav, setMobileNav] = useState(false); const [searchOpen, setSearchOpen] = useState(false); const [search, setSearch] = useState(''); const [help, setHelp] = useState(false); const logout = useAction();
  const signedOut = (text = 'Your session has expired. Sign in to continue.') => { clearSession(); setSession(null); setOutletId(''); setMessage(text); setMobileNav(false); setSearchOpen(false); };
  const acceptSession = (value: Session) => { configureSession(value.csrfToken, () => signedOut()); setSession(value); setOutletId(current => value.outlets.some(o => o.id === current) ? current : value.outlets[0]?.id || ''); setMessage(''); };
  const bootstrap = async () => { setBooting(true); setBootError(''); try { acceptSession(await api.me()); } catch (e) { if (!(e instanceof ApiError && e.status === 401)) setBootError(e instanceof Error ? e.message : 'Unable to reach the restaurant server.'); } finally { setBooting(false); } };
  useEffect(() => { void bootstrap(); }, []);
  if (booting) return <div className="boot-screen"><div className="brand-mark"><Flame size={28} /></div><h1>hearth<span>table</span></h1><Loading text="Preparing your restaurant workspace…" /></div>;
  if (bootError && !session) return <div className="boot-screen"><div className="brand-mark"><Flame size={28} /></div><h2>Your workspace is taking a moment.</h2><p>{bootError}</p><Button onClick={() => void bootstrap()}>Reconnect to the server</Button></div>;
  if (!session) return <Auth onSession={acceptSession} message={message} />;
  const can = (permission: Permission) => session.user.permissions.includes(permission);
  const allowed = navigation.filter(n => can(n.permission) && (n.page !== 'settings' || ['OWNER', 'MANAGER'].includes(session.user.role)));
  const page = location.page === 'profile' || allowed.some(n => n.page === location.page) ? location.page : allowed[0]?.page || 'profile';
  const current = navigation.find(n => n.page === page); const outlet = session.outlets.find(o => o.id === outletId);
  const navigate = (to: Navigation) => { setLocation(to); setMobileNav(false); setSearchOpen(false); };
  const refreshSession = async () => acceptSession(await api.me());
  const renderPage = () => {
    if (page === 'profile') return <Profile />;
    if (page === 'settings') return <SettingsPage />;
    if (!outletId) return <div className="page"><Empty title="An outlet is waiting for you" text="You don’t have an accessible outlet yet. Ask an owner to assign access, or configure a new outlet in Settings." action={allowed.some(n => n.page === 'settings') ? <Button onClick={() => navigate({ page: 'settings' })}>Set up an outlet <ArrowRight size={17} /></Button> : <Button className="secondary" onClick={() => navigate({ page: 'profile' })}>View your profile</Button>} /></div>;
    switch (page) {
      case 'dashboard': return <DashboardPage />;
      case 'floor': return <FloorPage />;
      case 'pos': return <POSPage key={`${outletId}-${location.orderId || ''}-${location.tableId || ''}`} initialOrderId={location.orderId} initialTableId={location.tableId} />;
      case 'kitchen': return <KitchenPage />;
      case 'bills': return <BillsPage initialBillId={location.billId} />;
      case 'reports': return <ReportsPage />;
      case 'printing': return <PrintingPage />;
    }
  };
  return <WorkspaceContext.Provider value={{ session, outletId, outlet, can, navigate, refreshSession, signedOut }}><div className="app-shell">{mobileNav && <button className="nav-scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}<aside className={`sidebar ${mobileNav ? 'is-open' : ''}`}><button className="brand" onClick={() => navigate({ page: allowed[0]?.page || 'profile' })} aria-label="Hearth Table home"><span className="brand-mark"><Flame size={24} /></span><span className="brand-type">hearth<span className="brand-light">table</span><small>RESTAURANT WORKSPACE</small></span></button><button className="mobile-nav-close icon-button" aria-label="Close navigation" onClick={() => setMobileNav(false)}><PanelLeftClose size={22} /></button><div className="workspace-identity"><span className="workspace-avatar">{session.tenant.name.slice(0, 1)}</span><div><strong>{session.tenant.name}</strong><span>{session.tenant.slug}</span></div></div><nav aria-label="Main navigation">{['WORKSPACE', 'MANAGEMENT'].map(group => <div className="nav-group" key={group}>{allowed.some(n => n.group === group) && <span className="nav-label">{group}</span>}{allowed.filter(n => n.group === group).map(({ page: destination, title, Icon }) => <button key={destination} className={`nav-item ${page === destination ? 'active' : ''}`} onClick={() => navigate({ page: destination })} title={title} aria-current={page === destination ? 'page' : undefined}><Icon size={19} strokeWidth={1.8} /><span>{title}</span>{page === destination && <span className="nav-active-dot" />}</button>)}</div>)}</nav><div className="sidebar-bottom"><button className="service-note" onClick={() => setHelp(true)}><div><span className="service-note-icon"><CircleHelp size={19} /></span><strong>Here’s to good service.</strong></div><span>Your workspace, explained <ChevronRight size={14} /></span></button><button className="user-menu" onClick={() => navigate({ page: 'profile' })} title="Your profile"><span className="user-avatar">{session.user.name.split(' ').map(s => s[0]).slice(0, 2).join('')}</span><span><strong>{session.user.name}</strong><small>{label(session.user.role)}</small></span><ChevronRight size={16} /></button>{logout.feedback}<button className="signout-button" disabled={logout.blocked} onClick={() => void logout.run(async () => { await api.logout(); signedOut('You have signed out securely.'); })}><LogOut size={16} /><span>{logout.busy ? 'Signing out…' : 'Sign out'}</span></button></div></aside><div className="main-shell"><header className="topbar"><div className="topbar-left"><button className="icon-button menu-toggle" aria-label="Open navigation" onClick={() => setMobileNav(true)}><Menu size={22} /></button><span className="breadcrumb">Workspace <ChevronRight size={13} /><strong>{current?.title || 'Your profile'}</strong></span></div><div className="topbar-right"><button className="command-search" onClick={() => setSearchOpen(true)} aria-label="Find a workspace page"><Search size={17} /><span>Go to…</span></button><div className="outlet-select"><Store size={17} /><select aria-label="Current outlet" value={outletId} disabled={!session.outlets.length} onChange={e => { setOutletId(e.target.value); setLocation({ page }); }}><option value="" disabled>Select outlet</option>{session.outlets.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select><ChevronDown size={14} /></div><span className="topbar-divider" /><button className="topbar-avatar" onClick={() => navigate({ page: 'profile' })} aria-label="Open your profile">{session.user.name.slice(0, 1)}</button></div></header><main className="main-content" id="main-content"><PageBoundary key={`${page}-${outletId}`}>{renderPage()}</PageBoundary></main><footer className="shell-footer"><span><span className="tiny-dot" />{session.tenant.name} · {outlet?.name || 'No outlet selected'}</span><span>Made for the art of hospitality.</span></footer></div></div>{searchOpen && <Modal title="Where would you like to go?" onClose={() => setSearchOpen(false)}><div className="search-box command-input"><Search size={20} /><input autoFocus placeholder="Search your workspace…" value={search} onChange={e => setSearch(e.target.value)} aria-label="Search workspace pages" /></div><div className="command-results">{[...allowed, { page: 'profile' as const, title: 'Your profile', Icon: UserRound }].filter(n => n.title.toLowerCase().includes(search.toLowerCase())).map(({ page: p, title, Icon }) => <button key={p} onClick={() => { navigate({ page: p }); setSearch(''); }}><Icon size={19} /><span>{title}</span><ArrowRight size={17} /></button>)}</div></Modal>}{help && <Modal title="A calmer service starts here" subtitle="A quick guide to your Hearth Table workspace." onClose={() => setHelp(false)}><div className="help-steps"><div><ShoppingBag size={22} /><span><strong>1. Open & build an order</strong><p>Choose a service mode, then add dishes. Each line is saved immediately, with server-verified prices.</p></span></div><div><ChefHat size={22} /><span><strong>2. Send it to the kitchen</strong><p>Unsent lines become routed kitchen tickets. Sent lines are immutable; authorized cancellations leave an audit trail.</p></span></div><div><ReceiptText size={22} /><span><strong>3. Bill & settle with care</strong><p>Split exact item quantities if needed. Record only confirmed payments. Card and UPI are manual, not gateway-connected.</p></span></div><div><BellRing size={22} /><span><strong>4. Check the print desk</strong><p>Queued jobs need a local print agent. Inspect uncertain output before explicitly retrying.</p></span></div></div><div className="notice info">Your visible pages follow the permissions returned by the server. Outlet access is always enforced by the backend.</div><Button className="full" onClick={() => setHelp(false)}>Back to service <X size={16} /></Button></Modal>}</WorkspaceContext.Provider>;
}
class PageBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('Workspace render error', error, info.componentStack); }
  render() { return this.state.failed ? <div className="page"><Empty title="This view couldn’t be displayed" text="Reload the page to fetch a fresh server response. Your saved restaurant data is not changed." action={<Button onClick={() => window.location.reload()}>Reload workspace</Button>} /></div> : this.props.children; }
}
