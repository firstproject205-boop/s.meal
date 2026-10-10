# s.meal
Private, consent-based reminder system: React admin site (phone-first) + MV3 Chrome extension + Supabase (Postgres/RLS/RPC).

## Setup
1. Use a **dev** Supabase project. `supabase link --project-ref <ref>` then `supabase db push` (DB password via env/prompt — never in files).
2. Copy `.env.example` → `.env`, fill public URL + anon/publishable key only.
3. Admin: `cd admin && npm i && npm run dev` (build: `npm run build`, deploy `dist/` to any HTTPS static host).
4. Extension: `cd extension && npm i && SUPABASE_URL=… SUPABASE_ANON_KEY=… npm run build`, then `chrome://extensions` → Developer mode → Load unpacked → `extension/dist`.
5. Create two Supabase Auth users (admin, recipient). Admin: Pairing → Create invitation. Recipient: popup → sign in → enter code → approve.

## Security model
- Clients get only anon key. All privileged logic is `SECURITY DEFINER` SQL functions with `auth.uid()` checks (no service-role key anywhere).
- Invitations: random 24-byte token, SHA-256 hash stored, 24h expiry, single use, row-locked redemption; no SELECT policy on `invitations`.
- Admin cannot read `inbox_items` or `preferences`; only operational `delivery_events`. No read receipts.
- Admin can only revoke; only the recipient can pause/resume. Revocation revokes devices and cancels schedules.
- Column-level grants block changing ownership/status fields via the API.

## Behaviour / limits
- Scheduling: `process_due_schedules` (pg_cron every minute if available; also run on each extension sync). Occurrences >1h late are skipped (no backlog burst). Idempotent via `scheduled_occurrence_key`. DST: nonexistent local times shift forward, ambiguous use first occurrence.
- Cap, quiet hours and notification gating run in the extension per recipient prefs (cap window = shift length, tracked in session storage).
- Delivery states: `queued` = in cloud inbox; `sent_to_extension` = extension fetched it; `notification_requested` = Chrome asked to show it. None prove it was seen. Chrome alarms (5 min) are best-effort; nothing is delivered while the browser is closed.
- Local storage: Supabase session + random installation ID (`chrome.storage.local`, cleared on disconnect); seen-IDs/notification timestamps (`storage.session`, cleared on browser close). OS/browser notification logs and extension install records are outside our control.
- 90-day event cleanup: `cleanup_delivery_events()` via pg_cron — **verify** the job exists in your project (`select * from cron.job`).
- Companion: 2D fallback only (Three.js not included). Content script matches all https pages with a small exclude list; disclose this to the recipient.

## Not done / unverified
Nothing here has been built, run, or tested against a live Supabase project. Missing: automated tests (RLS, scheduling, extension), account-deletion workflow (inbox deletion + export only), settings screens for admin quiet-hours defaults, PWA, MFA setup, extension icons. Defaults (24h invite, 2 devices, 90 days) need your confirmation before release.
