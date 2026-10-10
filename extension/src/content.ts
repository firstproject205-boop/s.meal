// Companion overlay (2D fallback). Reads nothing from the page; skips frames, password fields and login-like pages.
(async () => {
  if (window.top !== window || document.querySelector('input[type=password]') || /login|signin|password|account/i.test(location.pathname)) return;
  if ((await chrome.storage.session.get('smeal_hidden')).smeal_hidden) return;
  const r = await chrome.runtime.sendMessage({ type: 'latest' }).catch(() => null); if (!r) return;
  const host = document.createElement('div'); host.style.cssText = 'all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483647;pointer-events:none';
  const root = host.attachShadow({ mode: 'closed' });
  const st = document.createElement('style'); st.textContent = `.w{pointer-events:auto;font:14px system-ui;display:flex;flex-direction:column;align-items:flex-end;gap:6px}.b{background:#fff;color:#3b2f2f;border-radius:14px;padding:8px 12px;max-width:240px;box-shadow:0 2px 10px #0003}.f{font-size:34px;line-height:1;${r.reduced ? '' : 'animation:s 3s ease-in-out infinite;'}}@keyframes s{50%{transform:translateY(-4px)}}button{all:unset;cursor:pointer;font-size:12px;color:#8a7a76;padding:2px 6px}button:focus-visible{outline:2px solid #d9776b}`;
  const w = document.createElement('div'); w.className = 'w'; w.setAttribute('role', 'complementary'); w.setAttribute('aria-label', 's.meal companion');
  if (r.text) { const b = document.createElement('div'); b.className = 'b'; b.textContent = r.text; w.append(b); }
  const f = document.createElement('div'); f.className = 'f'; f.textContent = '🍙'; f.setAttribute('aria-hidden', 'true');
  const x = document.createElement('button'); x.textContent = 'Hide'; x.setAttribute('aria-label', 'Hide companion'); x.onclick = () => { chrome.storage.session.set({ smeal_hidden: true }); host.remove(); };
  w.append(f, x); root.append(st, w); document.documentElement.append(host);
})();
