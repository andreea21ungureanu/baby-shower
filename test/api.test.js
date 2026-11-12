const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'registry-'));
process.env.ADMIN_KEY = 'secret';
process.env.ALLOW_PRIVATE_PREVIEWS = '1';
const app = require('../server');
const { metaTags, jsonLdProduct } = require('../lib/preview');

let base, server, shop;
const call = async (p, { method = 'GET', body, headers = {} } = {}) => {
  const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body && JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};
const adminH = { 'x-admin-key': 'secret' };

before(async () => {
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  shop = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end(`<html><head><title>Fallback</title>
      <meta property="og:title" content="Cosy Pram &amp; Carrycot">
      <meta property="og:image" content="/img/pram.jpg">
      <meta name="description" content="A lovely pram">
      <meta property="product:price:amount" content="1,250.00"></head></html>`);
  }).listen(0);
});
after(() => { server.close(); shop.close(); });

test('parses meta and JSON-LD', () => {
  assert.equal(metaTags('<meta content=\'x\' property="og:title">')['og:title'], 'x');
  const ld = jsonLdProduct('<script type="application/ld+json">{"@type":"Product","name":"Cot","offers":{"price":"199"}}</script>');
  assert.deepEqual([ld.title, ld.price], ['Cot', 199]);
});

test('admin endpoints require key', async () => {
  assert.equal((await call('/api/admin/registry')).status, 401);
});

test('full flow: preview, add, chip in, buy rest, undo', async () => {
  const shopUrl = `http://127.0.0.1:${shop.address().port}/pram`;
  const pv = (await call('/api/admin/preview', { method: 'POST', headers: adminH, body: { url: shopUrl } })).body;
  assert.equal(pv.title, 'Cosy Pram & Carrycot');
  assert.equal(pv.price, 1250);
  assert.match(pv.image, /\/img\/pram\.jpg$/);

  const { item } = (await call('/api/admin/items', { method: 'POST', headers: adminH, body: { ...pv, price: 100 } })).body;
  const c1 = await call(`/api/items/${item.id}/contribute`, { method: 'POST', body: { name: 'Gran', type: 'partial', amount: 30 } });
  assert.equal(c1.body.item.remaining, 70);

  const tooMuch = await call(`/api/items/${item.id}/contribute`, { method: 'POST', body: { name: 'Bob', type: 'partial', amount: 80 } });
  assert.equal(tooMuch.status, 400);

  const rest = await call(`/api/items/${item.id}/contribute`, { method: 'POST', body: { name: 'Aunt', type: 'full' } });
  assert.equal(rest.body.contribution.amount, 70);
  assert.equal(rest.body.item.complete, true);

  const again = await call(`/api/items/${item.id}/contribute`, { method: 'POST', body: { name: 'Late', type: 'full' } });
  assert.equal(again.status, 409);

  // Guest can't remove someone else's pledge, but can undo their own.
  const { id, cancelToken } = rest.body.contribution;
  assert.equal((await call(`/api/items/${item.id}/contributions/${id}`, { method: 'DELETE', headers: { 'x-cancel-token': 'nope' } })).status, 403);
  const undone = await call(`/api/items/${item.id}/contributions/${id}`, { method: 'DELETE', headers: { 'x-cancel-token': cancelToken } });
  assert.equal(undone.body.item.remaining, 70);

  // Public view hides names; admin view shows them without tokens.
  const pub = (await call('/api/registry')).body.items[0];
  assert.equal(pub.contributions, undefined);
  const adm = (await call('/api/admin/registry', { headers: adminH })).body.items[0];
  assert.equal(adm.contributions[0].name, 'Gran');
  assert.equal(adm.contributions[0].cancelToken, undefined);
});

test('unpriced items are simply claimed', async () => {
  const { item } = (await call('/api/admin/items', { method: 'POST', headers: adminH, body: { url: 'https://example.com/x', title: 'Muslins' } })).body;
  const r = await call(`/api/items/${item.id}/contribute`, { method: 'POST', body: { name: 'Sam', type: 'full' } });
  assert.equal(r.body.item.complete, true);
  assert.equal((await call(`/api/items/${item.id}/contribute`, { method: 'POST', body: { name: 'Sam', type: 'partial', amount: 5 } })).status, 409);
});

test('owner can upload a photo; guests cannot', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const up = (headers) => fetch(base + '/api/admin/upload', { method: 'POST', headers: { 'Content-Type': 'image/png', ...headers }, body: png });
  assert.equal((await up({})).status, 401);
  const res = await up(adminH);
  const { url } = await res.json();
  assert.match(url, /^\/uploads\/[a-f0-9]+\.png$/);
  assert.equal((await fetch(base + url)).status, 200);
  const txt = await fetch(base + '/api/admin/upload', { method: 'POST', headers: { 'Content-Type': 'image/svg+xml', ...adminH }, body: '<svg/>' });
  assert.equal(txt.status, 400);
});
