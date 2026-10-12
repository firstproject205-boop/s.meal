import { useEffect, useState, FormEvent } from 'react';
import { Routes, Route, Navigate, NavLink, useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase, Rel, Msg } from './supabase';

const msgOf = (e: unknown) => (e as { message?: string })?.message ?? 'Something went wrong';

function Login() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState(''), [pw, setPw] = useState(''), [pw2, setPw2] = useState(''), [displayName, setDisplayName] = useState('');
  const [err, setErr] = useState(''), [info, setInfo] = useState(''), [busy, setBusy] = useState(false);

  const go = async (e: FormEvent) => {
    e.preventDefault(); setErr(''); setInfo('');
    if (mode === 'signup') {
      if (pw !== pw2) { setErr('Passwords do not match.'); return; }
      if (pw.length < 10) { setErr('Password must be at least 10 characters.'); return; }
      setBusy(true);
      const display_name = displayName.trim();
      const { data, error } = await supabase.auth.signUp({ email, password: pw, options: { data: { display_name }, emailRedirectTo: window.location.origin } });
      setBusy(false);
      if (error) { setErr('Sign-up failed. Try a different email or a stronger password.'); return; }
      if (!data.session) { setInfo('Check your email to confirm your account, then sign in.'); setMode('signin'); setPw(''); setPw2(''); return; }
    } else {
      setBusy(true);
      const { error } = await supabase.auth.signInWithPassword({ email, password: pw });
      setBusy(false);
      if (error) setErr('Sign-in failed. Check your details.');
    }
  };

  const reset = async () => {
    if (!email) { setErr('Enter your email address first.'); return; }
    setErr(''); setBusy(true);
    await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + '/account' });
    setBusy(false);
    setInfo('If that account exists, a recovery email was sent.');
  };

  return <main><h1>s.meal</h1><form className="card" onSubmit={go}>
    <p className="mut" style={{ textAlign: 'center' }}>{mode === 'signin' ? 'Sign in to your account' : 'Create a new account'}</p>
    {mode === 'signup' && <label>Display name<input maxLength={60} value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Your name" autoComplete="name" disabled={busy} /></label>}
    <label>Email<input type="email" required value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" disabled={busy} /></label>
    <label>Password{mode === 'signup' && ' (10+ characters)'}<input type="password" required minLength={mode === 'signup' ? 10 : undefined} value={pw} onChange={e => setPw(e.target.value)} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} disabled={busy} /></label>
    {mode === 'signup' && <label>Confirm password<input type="password" required minLength={10} value={pw2} onChange={e => setPw2(e.target.value)} autoComplete="new-password" disabled={busy} /></label>}
    {err && <p className="err" role="alert">{err}</p>}{info && <p className="mut">{info}</p>}
    <button disabled={busy}>{busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Sign up'}</button>
    {mode === 'signin' && <button type="button" className="ghost" onClick={reset} disabled={busy}>Forgot password</button>}
    <button type="button" className="ghost" onClick={() => { setMode(m => m === 'signin' ? 'signup' : 'signin'); setErr(''); setInfo(''); }} disabled={busy}>{mode === 'signin' ? 'Create an account' : 'Already have an account? Sign in'}</button>
  </form></main>;
}

function useRel() {
  const [rel, setRel] = useState<Rel | null>(null); const [loading, setL] = useState(true);
  const load = async () => { const { data } = await supabase.from('relationships').select('id,status,recipient_user_id').order('created_at', { ascending: false }).limit(1); setRel(data?.[0] ?? null); setL(false); };
  useEffect(() => { load(); }, []); return { rel, loading, reload: load };
}

function Dashboard() {
  const { rel, loading } = useRel(); const [ev, setEv] = useState<{ id: string; event_type: string; occurred_at: string }[]>([]);
  const [up, setUp] = useState<{ id: string; next_run_at: string; timezone: string }[]>([]);
  useEffect(() => { supabase.from('delivery_events').select('id,event_type,occurred_at').order('occurred_at', { ascending: false }).limit(10).then(r => setEv(r.data ?? []));
    supabase.from('schedules').select('id,next_run_at,timezone').eq('status', 'active').order('next_run_at').limit(5).then(r => setUp(r.data ?? [])); }, []);
  if (loading) return <p>Loading…</p>;
  if (!rel) return <><h2>Dashboard</h2><div className="card"><p><NavLink to="/pairing">Go to Pairing</NavLink> and create an invitation first.</p></div></>;
  return <><h2>Dashboard</h2>
    <div className="card">Pairing: <b>{rel.status}</b></div>
    <div className="card"><b>Upcoming</b>{up.length === 0 && <p className="mut">Nothing scheduled.</p>}{up.map(u => <p key={u.id}>{new Date(u.next_run_at).toLocaleString()} <span className="mut">({u.timezone})</span></p>)}</div>
    <div className="card"><b>Recent delivery events</b>{ev.length === 0 && <p className="mut">No events yet.</p>}{ev.map(e => <p key={e.id}>{e.event_type} · {new Date(e.occurred_at).toLocaleString()}</p>)}
      <p className="mut">“Queued” = placed in the recipient's cloud inbox. “Sent to extension” = the extension fetched it. Neither means it was seen. Delivery can be delayed if the laptop is off or the browser is closed. Events are kept 90 days.</p></div></>;
}

function Messages() {
  const { rel, loading } = useRel(); const [list, setList] = useState<Msg[]>([]); const [body, setBody] = useState(''), [title, setTitle] = useState(''), [cat, setCat] = useState('encouragement'); const [err, setErr] = useState('');
  const [tz, setTz] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone), [time, setTime] = useState('22:00'), [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]), [pick, setPick] = useState('');
  const load = () => supabase.from('messages').select('*').neq('status', 'deleted').order('created_at', { ascending: false }).then(r => setList((r.data as Msg[]) ?? []));
  useEffect(() => { load(); }, []);
  if (loading) return <p>Loading…</p>;
  if (!rel) return <><h2>Messages</h2><div className="card"><p><NavLink to="/pairing">Go to Pairing</NavLink> and create an invitation first.</p></div></>;
  const add = async (e: FormEvent) => { e.preventDefault(); setErr(''); if (!rel) return setErr('Create a pairing first.');
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from('messages').insert({ relationship_id: rel.id, created_by: u.user!.id, title: title || null, body: body.trim(), category: cat }); if (error) setErr(msgOf(error)); else { setBody(''); setTitle(''); load(); } };
  const del = async (id: string) => { if (confirm('Delete this message? Its future schedules will be cancelled. Already delivered copies stay in the recipient\'s inbox.')) { await supabase.from('messages').update({ status: 'deleted', deleted_at: new Date().toISOString() }).eq('id', id); load(); } };
  const sched = async (type: 'recurring' | 'once') => { setErr(''); if (!rel || !pick) return setErr('Pick a message.'); const { data: u } = await supabase.auth.getUser();
    const row = type === 'recurring' ? { schedule_type: type, local_time: time, weekdays: days } : { schedule_type: type, starts_at: new Date(Date.now() + 5 * 60000).toISOString() };
    const { error } = await supabase.from('schedules').insert({ relationship_id: rel.id, message_id: pick, created_by: u.user!.id, timezone: tz, ...row }); setErr(error ? msgOf(error) : 'Scheduled ✓'); };
  const [testStatus, setTestStatus] = useState('');
  const sendTestNow = async () => {
    setErr(''); setTestStatus('');
    if (!rel || !pick) return setErr('Pick a message.');
    const { data: u } = await supabase.auth.getUser();
    const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const testStartsAt = new Date(Date.now() + 60000);
    const { error } = await supabase.from('schedules').insert({
      relationship_id: rel.id,
      message_id: pick,
      created_by: u.user!.id,
      timezone: browserTz,
      schedule_type: 'once',
      starts_at: testStartsAt.toISOString()
    });
    if (error) setErr(msgOf(error));
    else setTestStatus(`Scheduled for ${testStartsAt.toLocaleTimeString()}`);
  };
  return <><h2>Messages</h2>
    <form className="card" onSubmit={add}><input placeholder="Title (optional)" maxLength={100} value={title} onChange={e => setTitle(e.target.value)} aria-label="Title" />
      <textarea required rows={3} maxLength={1000} placeholder="Write something kind…" value={body} onChange={e => setBody(e.target.value)} aria-label="Message" />
      <select value={cat} onChange={e => setCat(e.target.value)} aria-label="Category"><option value="romance">Romance</option><option value="encouragement">Encouragement</option><option value="self_care">Self-care</option></select>
      <p className="mut">Preview: <b>{title || 'You have a new reminder'}</b> — {body.slice(0, 80)}</p><button>Save message</button></form>
    {err && <p role="alert" className={err.includes('✓') ? '' : 'err'}>{err}</p>}
    {testStatus && <p role="status">{testStatus}</p>}
    <div className="card"><b>Schedule</b><select value={pick} onChange={e => { setPick(e.target.value); setTestStatus(''); }} aria-label="Message to schedule"><option value="">Choose message…</option>{list.filter(m => m.status === 'active').map(m => <option key={m.id} value={m.id}>{m.body.slice(0, 40)}</option>)}</select>
      <input value={tz} onChange={e => setTz(e.target.value)} aria-label="IANA timezone" /><input type="time" value={time} onChange={e => setTime(e.target.value)} aria-label="Local time" />
      <div>{[1, 2, 3, 4, 5, 6, 7].map(d => <label key={d} style={{ marginRight: 8 }}><input type="checkbox" style={{ width: 'auto' }} checked={days.includes(d)} onChange={() => setDays(x => x.includes(d) ? x.filter(y => y !== d) : [...x, d])} />{'MTWTFSS'[d - 1]}</label>)}</div>
      <button type="button" onClick={() => sched('recurring')}>Schedule recurring</button>
      <button type="button" className="ghost" onClick={() => sched('once')}>Send once (in 5 min)</button>
      <button type="button" className="ghost" onClick={sendTestNow}>Send test message now</button></div>
    {list.map(m => <div className="card" key={m.id}><span className="mut">{m.category} · {m.status}</span><p>{m.title && <b>{m.title}<br /></b>}{m.body}</p><button className="ghost" onClick={() => del(m.id)}>Delete</button></div>)}</>;
}

function Schedules() {
  const [l, setL] = useState<{ id: string; status: string; schedule_type: string; next_run_at: string | null; timezone: string; local_time: string | null }[]>([]);
  const load = () => supabase.from('schedules').select('id,status,schedule_type,next_run_at,timezone,local_time').order('created_at', { ascending: false }).then(r => setL(r.data ?? []));
  useEffect(() => { load(); }, []);
  const set = async (id: string, status: string) => { await supabase.from('schedules').update({ status }).eq('id', id); load(); };
  return <><h2>Schedules</h2>{l.length === 0 && <p className="mut">No schedules.</p>}{l.map(s => <div className="card" key={s.id}>
    <b>{s.schedule_type}</b> {s.local_time ?? ''} <span className="mut">{s.timezone} · {s.status}</span><p className="mut">Next: {s.next_run_at ? new Date(s.next_run_at).toLocaleString() : '—'}</p>
    {s.status === 'active' && <button className="ghost" onClick={() => set(s.id, 'paused')}>Pause</button>}{s.status === 'paused' && <button onClick={() => set(s.id, 'active')}>Resume</button>}
    {s.status !== 'cancelled' && <button className="ghost" onClick={() => confirm('Cancel this schedule?') && set(s.id, 'cancelled')}>Cancel</button>}</div>)}</>;
}

function Pairing() {
  const { rel, reload } = useRel(); const [tok, setTok] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  const [devs, setDevs] = useState<{ id: string; status: string; last_seen_at: string | null }[]>([]);
  const loadD = () => supabase.from('device_installations').select('id,status,last_seen_at').then(r => setDevs(r.data ?? []));
  useEffect(() => { loadD(); }, []);
  const inv = async () => { setErr(''); setBusy(true); const { data, error } = await supabase.rpc('create_invitation'); setBusy(false); if (error) setErr(msgOf(error)); else { setTok(data as string); reload(); } };
  const revoke = async () => { if (confirm('Disconnect this relationship? Devices will be revoked and schedules cancelled.') && rel) { await supabase.rpc('set_relationship_status', { rid: rel.id, s: 'revoked' }); reload(); loadD(); } };
  const rd = async (id: string) => { await supabase.rpc('revoke_device', { did: id }); loadD(); };
  return <><h2>Pairing & devices</h2><div className="card">Status: <b>{rel?.status ?? 'none'}</b>
    {(!rel || rel.status === 'pending' || rel.status === 'revoked') && <button onClick={inv} disabled={busy}>{busy ? 'Generating invitation…' : 'Create invitation (24h, single use)'}</button>}
    {tok && <><p>Share this code with the recipient privately. It is shown once:</p><code style={{ wordBreak: 'break-all' }}>{tok}</code></>}
    {err && <p className="err" role="alert">{err}</p>}
    {rel && rel.status !== 'revoked' && <button className="ghost" onClick={revoke}>Disconnect</button>}
    <p className="mut">The recipient must sign in, enter the code, and approve before anything is sent.</p></div>
    {devs.map(d => <div className="card" key={d.id}>Device · {d.status}<p className="mut">Last seen {d.last_seen_at ? new Date(d.last_seen_at).toLocaleString() : 'never'}</p>{d.status === 'active' && <button className="ghost" onClick={() => rd(d.id)}>Revoke</button>}</div>)}</>;
}

const Privacy = () => <><h2>Privacy</h2><div className="card"><p>Stored in the cloud: authored messages, schedules, recipient inbox snapshots, preferences, pairing records, and delivery events (deleted after 90 days).</p>
  <p>There are no read receipts. The extension collects no browsing history, keystrokes, screenshots or location. The recipient controls pause, quiet hours, the reminder cap, and disconnect. Some traces (browser extension records, OS notification logs, backups) are outside our control.</p></div></>;

function Account({ recovery, onPasswordReset }: { recovery?: boolean; onPasswordReset?: () => void }) {
  const [pw, setPw] = useState(''), [m, setM] = useState(''), [busy, setBusy] = useState(false);
  const [isRecovery, setIsRecovery] = useState(Boolean(recovery));
  useEffect(() => {
    if (recovery) setIsRecovery(true);
    const { data: l } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setIsRecovery(true);
    });
    return () => l.subscription.unsubscribe();
  }, [recovery]);
  const upd = async (e: FormEvent) => {
    e.preventDefault();
    if (pw.length < 10) { setM('Password must be at least 10 characters.'); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    setM(error ? msgOf(error) : 'Password updated');
    setPw('');
    if (!error) {
      setIsRecovery(false);
      if (onPasswordReset) onPasswordReset();
    }
  };
  return <><h2>Account</h2>
    {isRecovery && <div className="card"><p><b>Password recovery:</b> Set your new password below.</p></div>}
    <form className="card" onSubmit={upd}>
      <label>New password (10+ characters)
        <input type="password" minLength={10} required value={pw} onChange={e => setPw(e.target.value)} placeholder="New password (10+ chars)" autoComplete="new-password" disabled={busy} />
      </label>
      <button disabled={busy}>{busy ? 'Updating…' : 'Change password'}</button>
      {m && <p role="status">{m}</p>}
    </form>
    <div className="card"><button onClick={async () => { const { data } = await supabase.rpc('export_my_data'); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); a.download = 's-meal-export.json'; a.click(); }}>Export my data</button>
      <button className="ghost" onClick={() => supabase.auth.signOut()}>Sign out</button></div></>;
}

function Settings() {
  const [name, setName] = useState(''), [msg, setMsg] = useState('');
  const [requests, setRequests] = useState<{ id: string; scope: string; status: string; created_at: string; completed_at: string | null }[]>([]);
  const load = async () => {
    const { data: u } = await supabase.auth.getUser();
    if (u?.user) {
      const { data } = await supabase.from('profiles').select('display_name').eq('id', u.user.id).single();
      if (data?.display_name) setName(data.display_name);
      const { data: reqs } = await supabase.from('deletion_requests').select('id,scope,status,created_at,completed_at').order('created_at', { ascending: false });
      setRequests(reqs ?? []);
    }
  };
  useEffect(() => { load(); }, []);
  const saveProfile = async (e: FormEvent) => {
    e.preventDefault(); setMsg('');
    const { data: u } = await supabase.auth.getUser(); if (!u?.user) return;
    const { error } = await supabase.from('profiles').update({ display_name: name.trim() || null, updated_at: new Date().toISOString() }).eq('id', u.user.id);
    setMsg(error ? msgOf(error) : 'Profile updated ✓');
  };
  const reqDelete = async (scope: 'account' | 'inbox') => {
    if (!confirm(`Are you sure you want to request ${scope} deletion? This action cannot be reversed.`)) return;
    setMsg('');
    if (scope === 'inbox') {
      const { error } = await supabase.rpc('delete_my_inbox');
      setMsg(error ? msgOf(error) : 'Inbox cleared ✓');
    } else {
      const { error } = await supabase.rpc('request_account_deletion', { s: 'account' });
      setMsg(error ? msgOf(error) : 'Account deletion requested ✓');
    }
    load();
  };
  return <><h2>Settings</h2>
    <form className="card" onSubmit={saveProfile}><b>Profile defaults</b>
      <label>Display name<input maxLength={60} value={name} onChange={e => setName(e.target.value)} placeholder="Your display name" /></label>
      <button>Save profile</button>
      {msg && <p className={msg.includes('✓') ? '' : 'err'} role="status">{msg}</p>}
    </form>
    <div className="card"><b>Data & account deletion</b>
      <p className="mut">You can delete your inbox items immediately, or file a full account deletion request.</p>
      <button type="button" className="ghost" onClick={() => reqDelete('inbox')}>Clear my inbox items</button>
      <button type="button" className="ghost" style={{ marginTop: 8 }} onClick={() => reqDelete('account')}>Request full account deletion</button>
    </div>
    {requests.length > 0 && <div className="card"><b>Deletion requests</b>
      {requests.map(r => <p key={r.id}><b>{r.scope}</b> · <span className="mut">{r.status}</span> ({new Date(r.created_at).toLocaleString()})</p>)}
    </div>}</>;
}

export default function App() {
  const [s, setS] = useState<Session | null>(null), [ready, setReady] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const navigate = useNavigate();
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setS(data.session); setReady(true); });
    const { data: l } = supabase.auth.onAuthStateChange((event, x) => {
      setS(x);
      if (event === 'PASSWORD_RECOVERY') {
        setRecovery(true);
        navigate('/account');
      }
    });
    return () => l.subscription.unsubscribe();
  }, [navigate]);
  if (!ready) return <main>Loading…</main>;
  if (!s) return <Routes><Route path="*" element={<Login />} /></Routes>;
  return <><main><Routes><Route path="/dashboard" element={<Dashboard />} /><Route path="/messages" element={<Messages />} /><Route path="/messages/new" element={<Navigate to="/messages" />} /><Route path="/schedules" element={<Schedules />} />
    <Route path="/pairing" element={<Pairing />} /><Route path="/devices" element={<Pairing />} /><Route path="/settings" element={<Settings />} /><Route path="/privacy" element={<Privacy />} /><Route path="/account" element={<Account recovery={recovery} onPasswordReset={() => setRecovery(false)} />} /><Route path="*" element={<Navigate to="/dashboard" />} /></Routes></main>
    <nav aria-label="Main">{['dashboard', 'messages', 'schedules', 'pairing', 'settings', 'privacy', 'account'].map(p => <NavLink key={p} to={'/' + p} className={({ isActive }) => isActive ? 'active' : ''}>{p}</NavLink>)}</nav></>;
}
