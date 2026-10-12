# s.meal – Troubleshooting Guide

If notifications do not appear or the extension inbox shows nothing, follow these steps to diagnose and resolve the issue.

---

## 1. Rebuilding the Extension with Environment Variables

The extension requires your public Supabase URL and Anon Key injected at build time.

### PowerShell (Windows)
```powershell
$env:SUPABASE_URL="https://YOUR-PROJECT.supabase.co"
$env:SUPABASE_ANON_KEY="your-publishable-anon-key"
cd extension
npm run build
```

### Bash (macOS / Linux)
```bash
export SUPABASE_URL="https://YOUR-PROJECT.supabase.co"
export SUPABASE_ANON_KEY="your-publishable-anon-key"
cd extension
npm run build
```

---

## 2. Reloading the Extension in Chrome

After rebuilding:
1. Open `chrome://extensions` in Google Chrome.
2. Ensure **Developer mode** is enabled (toggle in the top-right corner).
3. Find the **s.meal** card and click the **Reload** button (circular arrow).

---

## 3. Inspecting Logs & Diagnosing Issues

### Service Worker Console (Background Sync & Notifications)
1. Navigate to `chrome://extensions`.
2. On the **s.meal** card, locate **Inspect views** and click **service worker**.
3. A DevTools window will open. Switch to the **Console** tab.
4. You will see detailed step-by-step logs from `sync()`:
   - `sync skipped: not signed in` – Recipient must sign in via the extension popup.
   - `sync skipped: preferences not found` – Relationship pairing is not yet approved.
   - `sync skipped: relationship not active` – Pairing status is pending or paused.
   - `inbox_items query error` – Database or RLS issue.
   - `chrome.notifications.create error` – Notification creation failed.

### Popup Console
1. Click the **s.meal** puzzle icon in the Chrome toolbar to open the extension popup.
2. **Right-click** anywhere inside the popup window and click **Inspect**.
3. Switch to the **Console** tab to view client-side errors, network requests, or auth issues.

---

## 4. Notification Settings & Focus Assist

If the service worker logs show `notification_requested` but no banner pops up:

### Windows Focus Assist / Do Not Disturb
1. Open Windows **Settings → System → Notifications**.
2. Check if **Do Not Disturb** (or **Focus Assist**) is turned **ON**. If active, Windows suppresses notification banners silently and sends them straight to the notification center.
3. Under **Notification from apps and other senders**, ensure **Google Chrome** is set to **On** with **Show notification banners** checked.

### Chrome Notification Permissions
1. In Chrome, open `chrome://settings/content/notifications`.
2. Ensure **Sites can ask to send notifications** is selected.
3. Confirm that Chrome is allowed to send OS-level notifications on your device.

---

## 5. Testing Flow
1. On the Admin site (`/messages`), choose a message and click **Send test message now**. It will schedule delivery for 1 minute in the future.
2. In the Extension popup, click **Refresh** (or wait for the 1-minute background alarm).
3. Verify the message appears in the Inbox card and triggers a notification.
