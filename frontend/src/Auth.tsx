import { useState } from 'react';
import { Brand } from './Brand';
import { api } from './api';
import { platformRequest } from './Platform';
import { Button, Field, PageHeader, useAction, useWorkspace } from './ui';
import type { Session } from './types';

const PLATFORM_PROPERTY_ID = '@platform';

export function Auth({ onSession, onPlatformSession, message }: {
  onSession: (session: Session) => void;
  onPlatformSession: (token: string) => void;
  message: string;
}) {
  const [propertyId, setPropertyId] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const action = useAction();

  return <main className="shared-sign-in">
    <div className="hotel-sign-in-scene" aria-hidden="true">
      <img className="hotel-sign-in-image" src="/hotel-sign-in.jpg" alt="" fetchPriority="high" />
    </div>
    <section className="card shared-sign-in-card">
      <div className="shared-sign-in-brand"><Brand /></div>
      <h1>Sign in</h1>
      {message && <p className="notice info" role="status">{message}</p>}
      <form onSubmit={event => {
        event.preventDefault();
        const property = propertyId.trim().toLowerCase();
        const email = username.trim();
        void action.run(async () => {
          if (property === PLATFORM_PROPERTY_ID) {
            const { token } = await platformRequest<{ token: string }>('/login', '', 'POST', { email, password });
            onPlatformSession(token);
          } else {
            onSession(await api.login({ tenantSlug: property, email, password }));
          }
        });
      }}>
        <fieldset disabled={action.blocked}>
          <Field label="Property ID"><input value={propertyId} onChange={event => setPropertyId(event.target.value)} autoComplete="organization" autoCapitalize="none" spellCheck={false} maxLength={64} required /></Field>
          <Field label="Username"><input type="email" value={username} onChange={event => setUsername(event.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={254} required /></Field>
          <Field label="Password"><input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" maxLength={256} required /></Field>
        </fieldset>
        {action.feedback}
        <Button className="full" type="submit" busy={action.busy} disabled={action.blocked}>Sign in</Button>
      </form>
    </section>
  </main>;
}

export function Profile() {
  const { session, refreshSession, signedOut } = useWorkspace();
  const [name, setName] = useState(session.user.name);
  const [current, setCurrent] = useState(''); const [next, setNext] = useState(''); const [confirm, setConfirm] = useState('');
  const profile = useAction(); const password = useAction(); const logout = useAction();
  return <div className="page"><PageHeader eyebrow="YOUR ACCOUNT" title="A space of your own" description="Manage your profile and keep your restaurant account secure." /><div className="profile-grid"><section className="card"><div className="section-heading"><h2>Profile details</h2><span className="badge">{session.user.role}</span></div><form onSubmit={e => { e.preventDefault(); void profile.run(async () => { await api.profile(name.trim()); await refreshSession(); }, 'Your name has been updated.'); }}><fieldset disabled={profile.blocked}><Field label="Full name"><input value={name} onChange={e => setName(e.target.value)} required /></Field><Field label="Email address"><input value={session.user.email} disabled /></Field><Field label="Workspace"><input value={`${session.tenant.name} · ${session.tenant.slug}`} disabled /></Field></fieldset>{profile.feedback}<Button busy={profile.busy} disabled={profile.blocked || !name.trim()}>Save profile</Button></form><div className="section-divider" /><h3>Active permissions</h3><div className="permission-list">{session.user.permissions.map(p => <span key={p} className="badge">{p.toLowerCase()}</span>)}</div><p className="muted small-text">Permissions and outlet access are controlled by your administrator.</p></section><section className="card"><h2>Change password</h2><p className="muted">Changing your password signs out all active sessions, including this one.</p><form onSubmit={e => { e.preventDefault(); if (next !== confirm) return; void password.run(async () => { await api.password(current, next); signedOut('Password changed. Please sign in again.'); }); }}><fieldset disabled={password.blocked}><Field label="Current password"><input type="password" value={current} onChange={e => setCurrent(e.target.value)} autoComplete="current-password" required /></Field><Field label="New password" hint="Use at least 12 characters."><input type="password" minLength={12} value={next} onChange={e => setNext(e.target.value)} autoComplete="new-password" required /></Field><Field label="Confirm new password"><input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required minLength={12} autoComplete="new-password" /></Field>{confirm && next !== confirm && <p className="field-error">Passwords do not match.</p>}</fieldset>{password.feedback}<Button busy={password.busy} disabled={password.blocked || next !== confirm}>Update password & sign out</Button></form><div className="section-divider" /><h3>End this session</h3><p className="muted">Always sign out on shared restaurant devices.</p>{logout.feedback}<Button className="secondary" busy={logout.busy} disabled={logout.blocked} onClick={() => void logout.run(async () => { await api.logout(); signedOut('You have signed out securely.'); })}>Sign out</Button></section></div></div>;
}
