/* New-version check, shared by the lobby screen and the manager app.
   window.lobbyUpdate(files, onNew): every few minutes (and whenever the app comes back to the front) it re-reads the
   app's own files and compares them with what was loaded. When a new version has been published, onNew() runs once. */
(function () {
  const EVERY = 5 * 60 * 1000;
  async function fingerprint(files) {
    let all = '';
    for (const f of files) { const r = await fetch(f, { cache: 'no-store' }); if (!r.ok) throw new Error('unavailable'); all += f + '\n' + (await r.text()) + '\n'; }
    const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(all));
    return Array.from(new Uint8Array(h), (b) => b.toString(16).padStart(2, '0')).join('');
  }
  window.lobbyUpdate = function (files, onNew) {
    if (!/^https?:$/.test(location.protocol) || !window.crypto || !crypto.subtle) return;
    let base = null, told = false, busy = false, last = 0;
    const check = async () => {
      if (told || busy || Date.now() - last < 30000) return;
      busy = true; last = Date.now();
      try { const now = await fingerprint(files); if (base === null) base = now; else if (now !== base) { told = true; onNew(); } }
      catch (e) { /* offline or mid-deploy: try again next time */ }
      busy = false;
    };
    check(); setInterval(check, EVERY);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  };
})();
