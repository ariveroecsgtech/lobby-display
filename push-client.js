/* Notifications for the installed apps. window.lobbyPush:
     status()            -> 'unsupported' | 'install' (iPhone: add to the home screen first) | 'ask' | 'on' | 'blocked' | 'off' (server not ready)
     enable(screen, app) -> asks the phone's permission (must be called from a tap) and registers this device
     refresh(screen, app)-> if already allowed, quietly makes sure this device is still registered
   A phone never lets a site turn notifications on by itself: the person has to tap "Allow" once. After that they stay on. */
(function () {
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let serverOn = null;
  const bytes = (b64) => { const s = atob((b64 + '='.repeat((4 - b64.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(s, (c) => c.charCodeAt(0)); };
  async function key() {
    const r = await fetch('/api/push/key'); const d = r.ok ? await r.json() : {};
    serverOn = !!(d.enabled && d.key); return serverOn ? d.key : '';
  }
  async function register(screen, app) {
    const k = await key(); if (!k) return false;
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes(k) });
    const r = await fetch('/api/push/subscribe?screen=' + encodeURIComponent(screen), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON(), app }) });
    return r.ok;
  }
  window.lobbyPush = {
    status() {
      if (ios && !standalone()) return 'install';
      if (!supported) return 'unsupported';
      if (serverOn === false) return 'off';
      return Notification.permission === 'granted' ? 'on' : Notification.permission === 'denied' ? 'blocked' : 'ask';
    },
    async enable(screen, app) {
      if (!supported) return this.status();
      const p = await Notification.requestPermission();
      if (p === 'granted') { try { if (!(await register(screen, app))) return serverOn === false ? 'off' : 'error'; } catch (e) { return 'error'; } }
      return this.status();
    },
    async refresh(screen, app) {
      if (!supported) return this.status();
      try { if (Notification.permission === 'granted') await register(screen, app); else await key(); } catch (e) { /* try again next time the app opens */ }
      return this.status();
    }
  };
})();
