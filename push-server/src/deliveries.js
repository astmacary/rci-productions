import { hash } from './core.js';

// Receipts share the existing table but never share a subscription partition.
// Conditional creates/updates protect against overlapping flow runs and workers.
export function createDeliveryReceipts(client, ready, now = Date.now) {
  const handle = (entity, result) => {
    if (!result.etag) throw new Error('Delivery receipt has no ETag.');
    return { ...entity, etag: result.etag };
  };
  return {
    async claim(appId, eventId, deviceKey) {
      await ready();
      const partitionKey = 'delivery:' + appId, rowKey = hash(JSON.stringify([eventId, deviceKey]));
      for (let attempt = 0; attempt < 3; attempt++) {
        const entity = { partitionKey, rowKey, status: 'pending', leaseUntil: now() + 60000 };
        try { return handle(entity, await client.createEntity(entity)); }
        catch (error) { if (error.statusCode !== 409) throw error; }
        let existing;
        try { existing = await client.getEntity(partitionKey, rowKey); }
        catch (error) { if (error.statusCode === 404) continue; throw error; }
        if (existing.status === 'sent') return 'sent';
        if (existing.leaseUntil > now()) return 'busy';
        if (!existing.etag) throw new Error('Delivery receipt has no ETag.');
        try { return handle(entity, await client.updateEntity(entity, 'Replace', { etag: existing.etag })); }
        catch (error) { if (![404, 412].includes(error.statusCode)) throw error; }
      }
      return 'busy';
    },
    async complete(receipt) {
      const { etag, ...entity } = receipt;
      await client.updateEntity({ ...entity, status: 'sent', leaseUntil: 0, completedAt: new Date(now()).toISOString() }, 'Replace', { etag });
    },
    async release(receipt) {
      try { await client.deleteEntity(receipt.partitionKey, receipt.rowKey, { etag: receipt.etag }); }
      catch (error) { if (![404, 412].includes(error.statusCode)) throw error; }
    }
  };
}
