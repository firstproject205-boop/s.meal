import { sb, getPrefs, installationId, inQuietHours, underCap, Item } from './shared';

const ALARM = 'smeal-sync';
chrome.runtime.onInstalled.addListener(() => chrome.alarms.create(ALARM, { periodInMinutes: 1 }));
chrome.runtime.onStartup.addListener(() => { chrome.alarms.create(ALARM, { periodInMinutes: 1 }); sync(); });
chrome.alarms.onAlarm.addListener(a => { if (a.name === ALARM) sync(); });
chrome.runtime.onMessage.addListener((m, _s, reply) => {
  if (m?.type === 'sync') { sync().then(() => reply(true)).catch(() => reply(false)); return true; }
  if (m?.type === 'latest') { latest().then(reply).catch(() => reply(null)); return true; }
});

async function latest(): Promise<{ text: string; reduced: boolean } | null> {
  const p = await getPrefs(); if (!p || !p.companion_enabled) return null;
  const { data, error } = await sb.from('inbox_items').select('title_snapshot,body_snapshot').eq('status', 'available').order('available_at', { ascending: false }).limit(1);
  if (error) console.warn('latest query error:', error.message);
  return { text: data?.[0]?.body_snapshot ?? '', reduced: p.reduced_motion };
}

// Sync is idempotent and never replays a backlog: only items made available in the last 30 min can notify.
async function sync() {
  try {
    const { data: s, error: se } = await sb.auth.getSession();
    if (se) { console.warn('getSession error:', se.message); return; }
    if (!s?.session) { console.warn('sync skipped: not signed in'); return; }

    const p = await getPrefs();
    if (!p) { console.warn('sync skipped: preferences not found'); return; }

    const { data: rel, error: rele } = await sb.from('relationships').select('status').eq('id', p.relationship_id).single();
    if (rele) { console.warn('relationship query error:', rele.message); return; }
    if (!rel || rel.status !== 'active') { console.warn('sync skipped: relationship not active'); return; }

    const inst = await installationId();
    const { error: re } = await sb.rpc('register_installation', { rid: p.relationship_id, inst });
    if (re) {
      console.warn('register_installation error:', re.message);
      await chrome.storage.local.remove('smeal_inst');
      return;
    }

    const { error: synce } = await sb.rpc('sync_inbox');
    if (synce) { console.warn('sync_inbox error:', synce.message); }

    const { data: items, error: ite } = await sb.from('inbox_items')
      .select('id,title_snapshot,body_snapshot,category_snapshot,available_at')
      .eq('status', 'available')
      .gt('available_at', new Date(Date.now() - 30 * 60e3).toISOString())
      .order('available_at');
    if (ite) { console.warn('inbox_items query error:', ite.message); return; }

    const sess = await chrome.storage.session.get(['seen', 'stamps']);
    const seen: string[] = sess.seen ?? [];
    let stamps: number[] = sess.stamps ?? [];

    for (const it of (items ?? []) as Item[]) {
      if (seen.includes(it.id)) continue;
      seen.push(it.id);

      const { error: de1 } = await sb.rpc('record_delivery_event', { inbox: it.id, inst, et: 'sent_to_extension', idem: `${inst}:${it.id}:s` });
      if (de1) console.warn('record_delivery_event sent error:', de1.message);

      if (!p.notifications_enabled || inQuietHours(p) || !underCap(p, stamps)) continue;

      chrome.notifications.create(
        it.id,
        {
          type: 'basic',
          iconUrl: chrome.runtime.getURL('icons/icon48.png'),
          title: p.show_message_content_in_notifications ? (it.title_snapshot ?? 's.meal') : 's.meal',
          message: p.show_message_content_in_notifications ? it.body_snapshot : 'You have a new reminder.',
          silent: !p.sound_enabled,
        },
        () => {
          if (chrome.runtime.lastError) {
            console.warn('chrome.notifications.create error:', chrome.runtime.lastError.message);
          }
        }
      );
      stamps.push(Date.now());

      const { error: de2 } = await sb.rpc('record_delivery_event', { inbox: it.id, inst, et: 'notification_requested', idem: `${inst}:${it.id}:n` });
      if (de2) console.warn('record_delivery_event notification error:', de2.message);
    }

    await chrome.storage.session.set({ seen: seen.slice(-200), stamps: stamps.slice(-20) });
  } catch (e) {
    console.warn('smeal sync exception:', (e as Error).message);
  }
}
