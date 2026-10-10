import { sb, getPrefs, installationId, inQuietHours, underCap, Item } from './shared';
const ALARM = 'smeal-sync';
chrome.runtime.onInstalled.addListener(() => chrome.alarms.create(ALARM, { periodInMinutes: 5 }));
chrome.runtime.onStartup.addListener(() => { chrome.alarms.create(ALARM, { periodInMinutes: 5 }); sync(); });
chrome.alarms.onAlarm.addListener(a => { if (a.name === ALARM) sync(); });
chrome.runtime.onMessage.addListener((m, _s, reply) => { if (m?.type === 'sync') { sync().then(() => reply(true)); return true; } if (m?.type === 'latest') { latest().then(reply); return true; } });

async function latest(): Promise<{ text: string; reduced: boolean } | null> {
  const p = await getPrefs(); if (!p || !p.companion_enabled) return null;
  const { data } = await sb.from('inbox_items').select('title_snapshot,body_snapshot').eq('status', 'available').order('available_at', { ascending: false }).limit(1);
  return { text: data?.[0]?.body_snapshot ?? '', reduced: p.reduced_motion };
}
// Sync is idempotent and never replays a backlog: only items made available in the last 30 min can notify.
async function sync() {
  try {
    const { data: s } = await sb.auth.getSession(); if (!s.session) return;
    const p = await getPrefs(); if (!p) return;
    const { data: rel } = await sb.from('relationships').select('status').eq('id', p.relationship_id).single();
    if (!rel || rel.status !== 'active') return;
    const inst = await installationId();
    const { error: re } = await sb.rpc('register_installation', { rid: p.relationship_id, inst }); if (re) { await chrome.storage.local.remove('smeal_inst'); return; }
    await sb.rpc('sync_inbox');
    const { data: items } = await sb.from('inbox_items').select('id,title_snapshot,body_snapshot,category_snapshot,available_at').eq('status', 'available').gt('available_at', new Date(Date.now() - 30 * 60e3).toISOString()).order('available_at');
    const sess = await chrome.storage.session.get(['seen', 'stamps']); const seen: string[] = sess.seen ?? []; let stamps: number[] = sess.stamps ?? [];
    for (const it of (items ?? []) as Item[]) {
      if (seen.includes(it.id)) continue; seen.push(it.id);
      await sb.rpc('record_delivery_event', { inbox: it.id, inst, et: 'sent_to_extension', idem: `${inst}:${it.id}:s` });
      if (!p.notifications_enabled || inQuietHours(p) || !underCap(p, stamps)) continue;
      chrome.notifications.create(it.id, { type: 'basic', iconUrl: 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==', title: p.show_message_content_in_notifications ? (it.title_snapshot ?? 's.meal') : 's.meal', message: p.show_message_content_in_notifications ? it.body_snapshot : 'You have a new reminder.', silent: !p.sound_enabled });
      stamps.push(Date.now()); await sb.rpc('record_delivery_event', { inbox: it.id, inst, et: 'notification_requested', idem: `${inst}:${it.id}:n` });
    }
    await chrome.storage.session.set({ seen: seen.slice(-200), stamps: stamps.slice(-20) });
  } catch (e) { console.warn('smeal sync failed', (e as Error).message); }
}
