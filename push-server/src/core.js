import { createHash } from 'node:crypto';
export const hash = value => createHash('sha256').update(value).digest('hex');
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const requireValue = (condition, message) => { if (!condition) throw new HttpError(400, message); };
export function endpoint(value) {
  requireValue(typeof value === 'string' && value.length <= 4096, 'Invalid push endpoint.');
  let url; try { url = new URL(value); } catch (_) { throw new HttpError(400, 'Invalid push endpoint.'); }
  const h = url.hostname;
  const allowed = h === 'web.push.apple.com' || h.endsWith('.push.apple.com') || h === 'fcm.googleapis.com' || h === 'updates.push.services.mozilla.com' || h.endsWith('.notify.windows.com');
  requireValue(url.protocol === 'https:' && !url.port && !url.username && !url.password && !url.hash && allowed, 'Unrecognized push provider.');
  return url.href;
}
export function subscription(value) {
  requireValue(value && typeof value === 'object', 'Missing subscription.');
  const key = value.keys?.p256dh, auth = value.keys?.auth;
  requireValue(typeof key === 'string' && /^[\w-]+={0,2}$/.test(key) && Buffer.from(key, 'base64url').length === 65 && Buffer.from(key, 'base64url')[0] === 4, 'Invalid subscription key.');
  requireValue(typeof auth === 'string' && /^[\w-]+={0,2}$/.test(auth) && Buffer.from(auth, 'base64url').length === 16, 'Invalid subscription auth.');
  return { endpoint: endpoint(value.endpoint), keys: { p256dh: key, auth } };
}
export function notification(body, app) {
  const recipients = [...new Set((Array.isArray(body.recipients) ? body.recipients : []).map(x => typeof x === 'string' ? x.trim().toLowerCase() : ''))];
  requireValue(recipients.length > 0 && recipients.length <= 100 && recipients.every(x => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x) && x.length < 256), 'Provide 1–100 recipient email addresses.');
  requireValue(typeof body.title === 'string' && body.title.length > 0 && body.title.length <= 120, 'Provide a title up to 120 characters.');
  requireValue(typeof body.body === 'string' && body.body.length <= 1000, 'Provide notification text up to 1000 characters.');
  requireValue(typeof body.eventId === 'string' && body.eventId.length > 0 && body.eventId.length <= 200, 'Provide a stable eventId.');
  // The server chooses the destination; callers cannot redirect users off-site.
  const payload = JSON.stringify({ title: body.title, body: body.body, url: app.baseUrl, tag: hash(app.id + ':' + body.eventId).slice(0, 32) });
  requireValue(Buffer.byteLength(payload) <= 3000, 'Notification is too large.');
  return { recipients, payload };
}
export function createHandlers({ apps, table, send, graph, publicKey }) {
  function select(id) { const app = apps[id]; if (!app) throw new HttpError(400, 'Unknown appId.'); return app; }
  async function identity(request, app) {
    const token = request.headers.get('authorization');
    if (!/^Bearer \S+$/i.test(token || '')) throw new HttpError(401, 'Sign-in required.');
    // Graph validates this delegated Graph token. Never trust email supplied by a browser.
    const me = await graph('/me?$select=id,mail,userPrincipalName', token);
    await graph('/sites/' + app.site + '?$select=id', token);
    if (!me.id || !(me.mail || me.userPrincipalName)) throw new HttpError(403, 'No signed-in identity.');
    return { oid: me.id, email: (me.mail || me.userPrincipalName).trim().toLowerCase(), principal: (me.userPrincipalName || '').trim().toLowerCase() };
  }
  async function subscriptions(request, body) {
    const app = select(body.appId), user = await identity(request, app);
    requireValue(['upsert', 'remove'].includes(body.action), 'Unknown subscription action.');
    const sub = body.action === 'upsert' ? subscription(body.subscription) : null;
    const target = sub?.endpoint || endpoint(body.endpoint), rowKey = hash(target);
    if (body.action === 'remove') {
      const existing = await table.get(app.id, rowKey);
      if (existing && existing.oid !== user.oid) throw new HttpError(403, 'Subscription belongs to another account.');
      if (existing) await table.remove(app.id, rowKey);
    } else {
      await table.put({ partitionKey: app.id, rowKey, ...user, subscription: JSON.stringify(sub), updatedAt: new Date().toISOString() });
    }
    return { ok: true };
  }
  async function dispatch(body) {
    const app = select(body.appId), { recipients, payload } = notification(body, app);
    let sent = 0, expired = 0, failed = 0, matched = 0;
    const rows = await table.find(app.id, recipients);
    requireValue(rows.length <= 200, 'Too many devices. Split this request into smaller groups.');
    const deliver = async row => {
      matched++;
      try {
        await send(subscription(JSON.parse(row.subscription)), payload);
        sent++;
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) { await table.remove(app.id, row.rowKey); expired++; }
        else failed++;
      }
    };
    // Bound concurrency and total work to stay within Azure's HTTP time limit.
    for (let at = 0; at < rows.length; at += 20) await Promise.all(rows.slice(at, at + 20).map(deliver));
    return { matched, sent, expired, failed };
  }
  return { select, subscriptions, dispatch, publicKey };
}
