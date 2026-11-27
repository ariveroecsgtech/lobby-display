// Announcements live in one Azure Table. PartitionKey = screen id, RowKey = announcement id.
const { TableClient } = require('@azure/data-tables');
const TABLE = 'announcements';
let client = null, ready = null;

function table() {
  const conn = process.env.STORAGE_CONNECTION;
  if (!conn) { const e = new Error('STORAGE_CONNECTION is not set'); e.code = 'not_configured'; throw e; }
  if (!client) client = TableClient.fromConnectionString(conn, TABLE);
  return client;
}
async function ensure() {
  if (!ready) ready = table().createTable().catch((e) => { if (e.statusCode !== 409) { ready = null; throw e; } });
  await ready;
  return table();
}
const fromEntity = (e) => {
  const { partitionKey, rowKey, etag, timestamp, ...rest } = e;
  delete rest['odata.metadata'];
  return { ...rest, screen: partitionKey, id: rowKey };
};

module.exports = {
  async list(screen) {
    const t = await ensure(), out = [];
    for await (const e of t.listEntities({ queryOptions: { filter: "PartitionKey eq '" + String(screen).replace(/'/g, "''") + "'" } })) out.push(fromEntity(e));
    return out;
  },
  async put(item) {
    const { screen, id, ...rest } = item;
    await (await ensure()).upsertEntity({ partitionKey: screen, rowKey: id, ...rest }, 'Replace');
  },
  async remove(screen, id) {
    try { await (await ensure()).deleteEntity(screen, id); } catch (e) { if (e.statusCode !== 404) throw e; }
  }
};
