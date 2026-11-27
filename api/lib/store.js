// Announcements live in one Azure Table. PartitionKey = screen id, RowKey = announcement id.
const { TableClient } = require('@azure/data-tables');
const { BlobServiceClient } = require('@azure/storage-blob');
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

// Residents (first name, last name, email) live in their own table, apart from announcements.
// PartitionKey = screen id, RowKey = resident id. Nothing in this table is ever sent to the lobby screen.
let resClient = null, resReady = null;
async function residents() {
  const conn = process.env.STORAGE_CONNECTION;
  if (!conn) { const e = new Error('STORAGE_CONNECTION is not set'); e.code = 'not_configured'; throw e; }
  if (!resClient) resClient = TableClient.fromConnectionString(conn, 'residents');
  if (!resReady) resReady = resClient.createTable().catch((e) => { if (e.statusCode !== 409) { resReady = null; throw e; } });
  await resReady;
  return resClient;
}
async function inBatches(t, actions) {
  for (let i = 0; i < actions.length; i += 100) await t.submitTransaction(actions.slice(i, i + 100));   // Azure Tables: 100 per transaction, one partition
}

// Uploaded poster images live in a private blob container and are only served through /api/image/{id}.
const CONTAINER = 'posters';
let container = null, containerReady = null;
async function blobs() {
  const conn = process.env.STORAGE_CONNECTION;
  if (!conn) { const e = new Error('STORAGE_CONNECTION is not set'); e.code = 'not_configured'; throw e; }
  if (!container) container = BlobServiceClient.fromConnectionString(conn).getContainerClient(CONTAINER);
  if (!containerReady) containerReady = container.createIfNotExists().catch((e) => { containerReady = null; throw e; });
  await containerReady;
  return container;
}

module.exports = {
  async residentList(screen) {
    const t = await residents(), out = [];
    for await (const e of t.listEntities({ queryOptions: { filter: "PartitionKey eq '" + String(screen).replace(/'/g, "''") + "'" } })) out.push(fromEntity(e));
    return out;
  },
  async residentPutMany(screen, rows) {
    await inBatches(await residents(), rows.map(({ id, screen: _s, ...rest }) => ['upsert', { partitionKey: screen, rowKey: id, ...rest }, 'Replace']));
  },
  async residentRemoveMany(screen, ids) {
    await inBatches(await residents(), ids.map((id) => ['delete', { partitionKey: screen, rowKey: id }]));
  },
  async imagePut(id, bytes, type, screen) {
    await (await blobs()).getBlockBlobClient(id).uploadData(Buffer.from(bytes), { blobHTTPHeaders: { blobContentType: type }, metadata: { screen: String(screen) } });
  },
  async imageGet(id) {
    try { const b = (await blobs()).getBlockBlobClient(id); return { bytes: await b.downloadToBuffer(), type: (await b.getProperties()).contentType }; }
    catch (e) { if (e.statusCode === 404) return null; throw e; }
  },
  async imageExists(id) { return (await blobs()).getBlockBlobClient(id).exists(); },
  async imageRemove(id) { await (await blobs()).getBlockBlobClient(id).deleteIfExists(); },
  async imageList() {
    const out = [];
    for await (const b of (await blobs()).listBlobsFlat()) out.push({ id: b.name, createdAt: b.properties.createdOn ? b.properties.createdOn.getTime() : 0 });
    return out;
  },
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
