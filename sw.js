// Dream Hair by Loveth: makes the shop and the admin installable, and shows a
// friendly page instead of the browser's error when there's no connection.
// Nothing is cached: prices, stock and orders always come fresh from the network.
const OFFLINE = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>You're offline</title><body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#1A0609;color:#F5F5F7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;text-align:center;padding:32px;box-sizing:border-box">
<div><div style="font-family:Georgia,serif;font-size:56px;letter-spacing:-3px">HL</div><h1 style="font-size:24px;font-weight:600">You're offline</h1>
<p style="color:#C9B5B2;font-size:16px;line-height:1.5">Check your connection, then try again.</p>
<button onclick="location.reload()" style="margin-top:12px;min-height:48px;padding:0 24px;border-radius:980px;border:none;background:#F5F5F7;color:#1A0609;font:inherit;font-weight:600">Try again</button></div></body></html>`;
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).catch(() => new Response(OFFLINE, { headers: { 'content-type': 'text/html; charset=utf-8' } })));
});
