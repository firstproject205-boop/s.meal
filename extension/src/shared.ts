import { createClient } from '@supabase/supabase-js';
declare const __SUPABASE_URL__: string, __SUPABASE_KEY__: string;
// Only the refresh/session token and installation id are persisted. No message archive.
const storage = { getItem: async (k: string) => (await chrome.storage.local.get(k))[k] ?? null, setItem: (k: string, v: string) => chrome.storage.local.set({ [k]: v }), removeItem: (k: string) => chrome.storage.local.remove(k) };
export const sb = createClient(__SUPABASE_URL__, __SUPABASE_KEY__, { auth: { storage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
export type Prefs = { relationship_id: string; timezone: string; quiet_hours_start: string | null; quiet_hours_end: string | null; max_reminders_per_shift: number; shift_start: string | null; shift_end: string | null; notifications_enabled: boolean; show_message_content_in_notifications: boolean; companion_enabled: boolean; sound_enabled: boolean; reduced_motion: boolean };
export type Item = { id: string; title_snapshot: string | null; body_snapshot: string; category_snapshot: string; available_at: string };
export async function installationId(): Promise<string> { const k = 'smeal_inst'; const v = (await chrome.storage.local.get(k))[k]; if (v) return v; const id = crypto.randomUUID(); await chrome.storage.local.set({ [k]: id }); return id; }
const mins = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
export function localMinutes(tz: string, d = new Date()) { const p = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d); const h = Number(p.find(x => x.type === 'hour')?.value ?? 0), m = Number(p.find(x => x.type === 'minute')?.value ?? 0); return h * 60 + m; }
export function inWindow(now: number, start: string | null, end: string | null) { if (!start || !end) return false; const s = mins(start), e = mins(end); return s <= e ? now >= s && now < e : now >= s || now < e; }
export const inQuietHours = (p: Prefs, d = new Date()) => inWindow(localMinutes(p.timezone, d), p.quiet_hours_start, p.quiet_hours_end);
export function shiftWindowMs(p: Prefs) { if (!p.shift_start || !p.shift_end) return 24 * 3600e3; const s = mins(p.shift_start), e = mins(p.shift_end); return ((e - s + 1440) % 1440 || 1440) * 60e3; }
// cap: count notifications requested within one shift length; pure & testable
export const underCap = (p: Prefs, stamps: number[], now = Date.now()) => stamps.filter(t => now - t < shiftWindowMs(p)).length < p.max_reminders_per_shift;
export async function getPrefs(): Promise<Prefs | null> { const { data } = await sb.from('preferences').select('*').limit(1); return (data?.[0] as Prefs) ?? null; }
