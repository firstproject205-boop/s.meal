import { sb, getPrefs, Prefs } from './shared';
const app = document.getElementById('app')!;
const el = <K extends keyof HTMLElementTagNameMap>(t: K, text = '', cls = '') => { const e = document.createElement(t); e.textContent = text; if (cls) e.className = cls; return e; };
const card = (...c: HTMLElement[]) => { const d = el('div', '', 'c'); d.append(...c); return d; };
const btn = (t: string, f: () => void, g = false) => { const b = el('button', t, g ? 'g' : ''); b.onclick = f; return b; };
function field(ph: string, type = 'text') { const i = document.createElement('input'); i.placeholder = ph; i.type = type; i.setAttribute('aria-label', ph); return i; }

async function render() {
  app.replaceChildren();
  const { data: s } = await sb.auth.getSession();
  if (!s.session) {
    let mode: 'signin' | 'signup' = 'signin';
    const dn = field('Display name'); dn.maxLength = 60;
    const e = field('Email', 'email'), p = field('Password', 'password'), p2 = field('Confirm password', 'password');
    const m = el('p', '', 'm');
    const setBusy = (busy: boolean) => {
      dn.disabled = e.disabled = p.disabled = p2.disabled = submit.disabled = toggle.disabled = busy;
      submit.textContent = busy ? 'Please wait…' : (mode === 'signin' ? 'Sign in' : 'Sign up');
    };
    const updateMode = (newMode: 'signin' | 'signup') => {
      mode = newMode;
      toggle.textContent = mode === 'signin' ? 'Create an account' : 'Already have an account? Sign in';
      submit.textContent = mode === 'signin' ? 'Sign in' : 'Sign up';
      dn.style.display = mode === 'signup' ? '' : 'none';
      p2.style.display = mode === 'signup' ? '' : 'none';
    };
    const submit = btn('Sign in', async () => {
      m.textContent = '';
      if (!e.value || !p.value) { m.textContent = 'Please fill in all required fields.'; return; }
      if (mode === 'signup') {
        if (p.value.length < 10) { m.textContent = 'Password must be at least 10 characters.'; return; }
        if (p.value !== p2.value) { m.textContent = 'Passwords do not match.'; return; }
        setBusy(true);
        const { data, error } = await sb.auth.signUp({ email: e.value, password: p.value, options: { data: { display_name: dn.value.trim() || undefined } } });
        setBusy(false);
        if (error) { m.textContent = 'Sign-up failed. Try a different email or a stronger password.'; return; }
        if (!data.session) {
          updateMode('signin');
          p.value = ''; p2.value = '';
          m.textContent = 'Check your email to confirm your account, then sign in and enter the invitation code.';
          return;
        }
        render(); return;
      }
      setBusy(true);
      const { error } = await sb.auth.signInWithPassword({ email: e.value, password: p.value });
      setBusy(false);
      if (error) m.textContent = 'Sign-in failed. Check your details.'; else render();
    });
    const toggle = btn('Create an account', () => {
      updateMode(mode === 'signin' ? 'signup' : 'signin');
      m.textContent = '';
    }, true);
    dn.style.display = 'none'; p2.style.display = 'none';
    app.append(card(el('p', 'Sign in to connect. This extension shows gentle reminders from your paired person. You can pause, hide or disconnect at any time.'), dn, e, p, p2, submit, toggle, m));
    return;
  }
  const prefs = await getPrefs();
  if (!prefs) { const t = field('Invitation code'), m = el('p', '', 'm');
    app.append(card(el('p', 'Enter the invitation code you were given.'), t, btn('Continue', async () => {
      const { data, error } = await sb.rpc('redeem_invitation', { token: t.value.trim() }); if (error || !data?.[0]) { m.textContent = 'Invalid or expired invitation.'; return; }
      const rid = data[0].relationship_id as string; app.replaceChildren(card(el('p', `Pair with ${data[0].admin_name}? They will be able to send you reminders. They cannot see if you read them, and you can disconnect any time.`),
        btn('Approve pairing', async () => { const r = await sb.rpc('approve_pairing', { rid }); if (r.error) m.textContent = 'Could not approve.'; else { chrome.runtime.sendMessage({ type: 'sync' }); render(); } }), btn('Cancel', async () => { await sb.rpc('set_relationship_status', { rid, s: 'revoked' }); render(); }, true), m)); }), m)); app.append(btn('Sign out', async () => { await sb.auth.signOut(); render(); }, true)); return; }
  await chrome.runtime.sendMessage({ type: 'sync' }).catch(() => {});
  const { data: items } = await sb.from('inbox_items').select('id,title_snapshot,body_snapshot,category_snapshot,available_at').eq('status', 'available').order('available_at', { ascending: false }).limit(20);
  const { data: rel } = await sb.from('relationships').select('status').eq('id', prefs.relationship_id).single();
  app.append(card(el('b', `Status: ${rel?.status ?? 'unknown'}`), btn(rel?.status === 'paused' ? 'Resume reminders' : 'Pause reminders', async () => { await sb.rpc('set_relationship_status', { rid: prefs.relationship_id, s: rel?.status === 'paused' ? 'active' : 'paused' }); render(); }, true)));
  const inbox = card(el('b', 'Inbox')); if (!items?.length) inbox.append(el('p', 'No messages right now.', 'm'));
  items?.forEach(i => { const d = el('div', '', 'c'); d.append(el('div', `${i.category_snapshot} · ${new Date(i.available_at).toLocaleString()}`, 'm'), el('div', i.body_snapshot), btn('Dismiss', async () => { await sb.from('inbox_items').update({ status: 'dismissed' }).eq('id', i.id); render(); }, true)); inbox.append(d); });
  app.append(inbox);
  const tog = (label: string, k: keyof Prefs) => { const l = el('label'); const c = document.createElement('input'); c.type = 'checkbox'; c.style.width = 'auto'; c.checked = prefs[k] as boolean; c.onchange = async () => { await sb.from('preferences').update({ [k]: c.checked, updated_at: new Date().toISOString() }).eq('relationship_id', prefs.relationship_id); }; l.append(c, ' ' + label); l.style.display = 'block'; return l; };
  const qs = field('Quiet from (HH:MM)'), qe = field('Quiet until (HH:MM)'), cap = field('Max reminders per shift (0-3)', 'number'); qs.value = prefs.quiet_hours_start?.slice(0, 5) ?? ''; qe.value = prefs.quiet_hours_end?.slice(0, 5) ?? ''; cap.value = String(prefs.max_reminders_per_shift);
  app.append(card(el('b', 'Preferences'), tog('Notifications', 'notifications_enabled'), tog('Show message text in notifications', 'show_message_content_in_notifications'), tog('Show companion on pages', 'companion_enabled'), tog('Reduce motion', 'reduced_motion'), qs, qe, cap,
    btn('Save quiet hours & cap', async () => { await sb.from('preferences').update({ quiet_hours_start: qs.value || null, quiet_hours_end: qe.value || null, max_reminders_per_shift: Math.min(3, Math.max(0, +cap.value || 0)), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }).eq('relationship_id', prefs.relationship_id); render(); })));
  app.append(card(el('b', 'Privacy'), el('p', 'Stored on this computer: your sign-in session and a random installation ID. Messages live in the cloud and are not archived locally. No browsing data is collected. The sender cannot see whether you read anything.', 'm'),
    btn('Disconnect & sign out', async () => { if (confirm('Disconnect from this person?')) { await sb.rpc('set_relationship_status', { rid: prefs.relationship_id, s: 'revoked' }); await chrome.storage.local.clear(); await chrome.storage.session.clear(); await sb.auth.signOut(); render(); } }, true)));
}
render();
