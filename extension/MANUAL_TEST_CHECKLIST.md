# Extension Manual Test Checklist

This checklist verifies the **s.meal** Chrome MV3 Extension behavior against a live or staged Supabase environment.

## 1. Setup & Installation
- [ ] In `extension/`, run build:
  ```bash
  SUPABASE_URL=https://<your-project-ref>.supabase.co SUPABASE_ANON_KEY=<your-anon-key> npm run build
  ```
- [ ] Open `chrome://extensions/` in Chrome.
- [ ] Enable **Developer mode** (toggle in upper right).
- [ ] Click **Load unpacked** and select `s-meal/extension/dist`.
- [ ] Verify the extension appears with icon, name "s.meal", version "0.1.0", and permissions `alarms`, `notifications`, `storage`.

## 2. Authentication & Pairing
- [ ] Click the extension icon in the toolbar to open popup (`popup.html`).
- [ ] Verify signed-out state: shows sign-in form with email and password fields.
- [ ] Sign in with the **recipient** user credentials.
- [ ] Verify that an invitation code prompt appears.
- [ ] Enter an invalid/expired code: verify error message `"Invalid or expired invitation."`.
- [ ] Generate a valid invitation token from Admin portal (`/pairing`) and enter it in extension.
- [ ] Verify confirmation screen appears showing: `"Pair with <Admin Name>?"`.
- [ ] Click **Approve pairing**:
  - [ ] Verify status transitions to `Status: active`.
  - [ ] Verify default preferences are loaded.
  - [ ] Verify `chrome.storage.local` contains `smeal_inst` (installation UUID).

## 3. Background Sync & Idempotency
- [ ] Open extension background service worker console (`chrome://extensions` > "service worker" link).
- [ ] Verify periodic alarm `smeal-sync` is registered (5-minute interval).
- [ ] Send a message from Admin portal and trigger a sync.
- [ ] Verify delivery event `sent_to_extension` is recorded in database.
- [ ] Verify seen item IDs are tracked in `chrome.storage.session` and never re-notified if already seen.
- [ ] Verify stale items (>30 min since `available_at`) do not trigger notifications.

## 4. Notifications, Quiet Hours & Frequency Cap
- [ ] Toggle **Notifications** in extension popup; test disabled state (no OS notification generated).
- [ ] Test **Show message text in notifications**:
  - Off: Notification displays generic title/body (`s.meal` / `You have a new reminder.`).
  - On: Notification displays actual reminder title and body.
- [ ] Set **Quiet hours** (e.g., covering current time):
  - [ ] Trigger sync.
  - [ ] Verify delivery event `sent_to_extension` is recorded, but notification is suppressed.
- [ ] Set **Max reminders per shift** (e.g. 1):
  - [ ] Send 2 reminders within shift window.
  - [ ] Verify first notification is displayed and second is blocked by cap.

## 5. Companion Overlay (Content Script)
- [ ] Navigate to any regular HTTPS page (e.g. `https://example.com`).
- [ ] Verify shadow DOM companion appears in bottom-right corner with rice-ball icon 🍙 and latest reminder text.
- [ ] Click **Hide**: verify companion disappears and `smeal_hidden` is set in session storage.
- [ ] Navigate to an excluded page (e.g. `https://accounts.google.com` or page with password input):
  - [ ] Verify companion script terminates early and does not render.

## 6. Disconnect & Revocation
- [ ] In extension popup, click **Pause reminders**: verify status becomes `paused`.
- [ ] Click **Resume reminders**: verify status returns to `active`.
- [ ] Click **Disconnect & sign out**:
  - [ ] Verify confirmation modal appears.
  - [ ] Verify relationship status in DB is marked `revoked`.
  - [ ] Verify device installation is marked `revoked`.
  - [ ] Verify `chrome.storage.local` and `chrome.storage.session` are cleared.
