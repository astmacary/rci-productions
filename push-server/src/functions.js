import { app } from '@azure/functions';
import { TableClient, odata } from '@azure/data-tables';
import webpush from 'web-push';
import { apps } from './apps.js';
import { createHandlers, HttpError } from './core.js';

let handlers;
function service() {
  if (handlers) return handlers;
  for (const name of ['PUSH_STORAGE_CONNECTION_STRING', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT']) {
    if (!process.env[name]) throw new Error('Missing service configuration: ' + name);
  }
  const client = TableClient.fromConnectionString(process.env.PUSH_STORAGE_CONNECTION_STRING, 'PushSubscriptions');
  let initialized;
  const init = () => initialized ||= client.createTable().catch(e => { if (e.statusCode !== 409) { initialized = undefined; throw e; } });
  const table = {
    async get(p, r) { await init(); try { return await client.getEntity(p, r); } catch (e) { if (e.statusCode !== 404) throw e; return null; } },
    async put(row) { await init(); await client.upsertEntity(row, 'Replace'); },
    async remove(p, r) { await init(); try { await client.deleteEntity(p, r); } catch (e) { if (e.statusCode !== 404) throw e; } },
    async find(appId, recipients) {
      await init();
      const people = recipients.map(email => `(${odata`email eq ${email}`} or ${odata`principal eq ${email}`})`).join(' or ');
      const filter = `${odata`PartitionKey eq ${appId}`} and (${people})`;
      const rows = [];
      for await (const row of client.listEntities({ queryOptions: { filter } })) { rows.push(row); if (rows.length > 200) break; }
      return rows;
    }
  };
  webpush.setVapidDetails(process.env.VAPID_SUBJECT, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  handlers = createHandlers({ apps, table, publicKey: process.env.VAPID_PUBLIC_KEY,
    send: (sub, payload) => webpush.sendNotification(sub, payload, { TTL: 3600, urgency: 'normal', timeout: 10000 }),
    graph: async (path, authorization) => {
      const res = await fetch('https://graph.microsoft.com/v1.0' + path, { headers: { Authorization: authorization }, signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new HttpError(res.status === 401 ? 401 : res.status === 403 || res.status === 404 ? 403 : 503, 'Microsoft could not verify access to this team.');
      return res.json();
    }
  });
  return handlers;
}
const json = (status, data, headers = {}) => ({ status, jsonBody: data, headers: { 'Cache-Control': 'no-store', ...headers } });
async function parse(request) {
  if (Number(request.headers.get('content-length') || 0) > 32768) throw new HttpError(413, 'Request is too large.');
  const text = await request.text();
  if (Buffer.byteLength(text) > 32768) throw new HttpError(413, 'Request is too large.');
  try { const data = JSON.parse(text); if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(); return data; }
  catch (_) { throw new HttpError(400, 'Invalid JSON.'); }
}
function cors(request, appId) {
  const origin = request.headers.get('origin');
  if (!apps[appId]) throw new HttpError(400, 'Unknown appId.');
  if (!origin || !apps[appId].origins.includes(origin)) throw new HttpError(403, 'Origin is not allowed.');
  return { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' };
}
function failure(e, headers, context) {
  if (!e.status) context.error('Push service request failed.'); // Never log tokens or subscriptions.
  return json(e.status || 503, { error: e.status ? e.message : 'Push service is unavailable.' }, headers);
}
app.http('push-config', { route: 'push/config', methods: ['GET', 'OPTIONS'], authLevel: 'anonymous', handler: async (request, context) => {
  let headers = {};
  try {
    headers = cors(request, request.query.get('appId'));
    if (request.method === 'OPTIONS') return { status: 204, headers };
    return json(200, { publicKey: service().publicKey }, headers);
  } catch (e) { return failure(e, headers, context); }
} });
app.http('push-subscriptions', { route: 'push/subscriptions', methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler: async (request, context) => {
  let headers = {};
  try {
    if (request.method === 'OPTIONS') {
      const origin = request.headers.get('origin');
      const app = Object.values(apps).find(a => a.origins.includes(origin));
      headers = cors(request, app?.id); return { status: 204, headers };
    }
    const body = await parse(request); headers = cors(request, body.appId);
    return json(200, await service().subscriptions(request, body), headers);
  } catch (e) { return failure(e, headers, context); }
} });
// Function key is for Power Automate only. Never put it in an app or GitHub.
app.http('push-send', { route: 'push/send', methods: ['POST'], authLevel: 'function', handler: async (request, context) => {
  try {
    const result = await service().dispatch(await parse(request));
    return json(result.failed ? 503 : 200, result);
  } catch (e) { return failure(e, {}, context); }
} });
