export class FakeTable {
  rows = new Map();
  version = 0;
  key(p, r) { return JSON.stringify([p, r]); }
  error(statusCode) { return Object.assign(new Error(String(statusCode)), { statusCode }); }
  async createEntity(entity) {
    const key = this.key(entity.partitionKey, entity.rowKey);
    if (this.rows.has(key)) throw this.error(409);
    const etag = String(++this.version);
    this.rows.set(key, { ...entity, etag }); return { etag };
  }
  async getEntity(p, r) {
    const row = this.rows.get(this.key(p, r));
    if (!row) throw this.error(404);
    return { ...row };
  }
  async updateEntity(entity, mode, options) {
    const row = await this.getEntity(entity.partitionKey, entity.rowKey);
    if (row.etag !== options.etag) throw this.error(412);
    // Recheck after the async read, as the actual service does atomically.
    if (this.rows.get(this.key(entity.partitionKey, entity.rowKey)).etag !== options.etag) throw this.error(412);
    const etag = String(++this.version);
    this.rows.set(this.key(entity.partitionKey, entity.rowKey), { ...entity, etag }); return { etag };
  }
  async deleteEntity(p, r, options) {
    const row = await this.getEntity(p, r);
    if (row.etag !== options.etag || this.rows.get(this.key(p, r)).etag !== options.etag) throw this.error(412);
    this.rows.delete(this.key(p, r)); return {};
  }
}
