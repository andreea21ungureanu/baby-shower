const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { load, mutate, newId, money, itemTotals, backend } = require('./lib/store');
const { fetchPreview } = require('./lib/preview');
const { saveImage, LOCAL_DIR } = require('./lib/uploads');

const app = express();
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.use('/uploads', express.static(LOCAL_DIR, { maxAge: '30d' }));

class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const fail = (msg, code = 400) => { throw new HttpError(code, msg); };
const str = (v, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
// Wrap async handlers so thrown errors become JSON responses.
const h = (fn) => (req, res) => Promise.resolve(fn(req, res)).then(
  (out) => res.json(out),
  (err) => {
    if (!(err instanceof HttpError)) console.error(err);
    res.status(err instanceof HttpError ? err.code : 500).json({ error: err instanceof HttpError ? err.message : 'Something went wrong' });
  },
);

function parsePrice(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = money(v);
  return Number.isFinite(n) && n > 0 ? n : NaN;
}

const publicItem = (item) => ({
  id: item.id, url: item.url, title: item.title, description: item.description, image: item.image,
  siteName: item.siteName, price: item.price, allowPartial: item.allowPartial, note: item.note,
  contributorCount: item.contributions.length, ...itemTotals(item),
});
const adminItem = (item) => ({ ...publicItem(item), contributions: item.contributions.map(({ cancelToken, ...c }) => c) });
const findItem = (data, id) => data.items.find((i) => i.id === id) || fail('Item not found', 404);
const publicSettings = ({ adminKey, ...s }) => s;

// ---------- Guest API ----------

app.get('/api/registry', h(async () => {
  const data = await load();
  return { settings: publicSettings(data.settings), items: data.items.map(publicItem) };
}));

app.post('/api/items/:id/contribute', h((req) => mutate((data) => {
  const item = findItem(data, req.params.id);
  const name = str(req.body.name, 80);
  const message = str(req.body.message, 500);
  let type = req.body.type === 'partial' ? 'partial' : 'full';
  if (!name) fail('Please tell us your name');

  const { remaining, complete } = itemTotals(item);
  if (complete) fail('Sorry, this item has already been covered!', 409);

  let amount;
  if (type === 'full') {
    amount = remaining ?? 0; // whatever is left (or 0 for unpriced items)
  } else {
    if (!item.allowPartial || item.price == null) fail('This item can only be bought outright');
    amount = money(req.body.amount);
    if (!Number.isFinite(amount) || amount <= 0) fail('Please enter an amount');
    if (amount > remaining) fail(`Only ${remaining.toFixed(2)} is left on this item`);
    if (amount === remaining) type = 'full';
  }

  const c = { id: newId(), name, message, type, amount, createdAt: new Date().toISOString(), cancelToken: crypto.randomBytes(16).toString('hex') };
  item.contributions.push(c);
  return { item: publicItem(item), contribution: { id: c.id, itemId: item.id, amount, type, cancelToken: c.cancelToken } };
})));

// Guests can undo their own pledge with the token they got; the owner can remove any.
app.delete('/api/items/:id/contributions/:cid', h((req) => mutate((data) => {
  const item = findItem(data, req.params.id);
  const idx = item.contributions.findIndex((c) => c.id === req.params.cid);
  if (idx === -1) fail('Contribution not found', 404);
  const isAdmin = req.get('x-admin-key') === data.settings.adminKey;
  if (!isAdmin && String(req.get('x-cancel-token') || '') !== item.contributions[idx].cancelToken) fail('Not allowed', 403);
  item.contributions.splice(idx, 1);
  return { item: isAdmin ? adminItem(item) : publicItem(item) };
})));

// ---------- Owner API ----------

const admin = express.Router();
admin.use((req, res, next) => {
  (async () => {
    if (backend.kind === 'redis' && !process.env.ADMIN_KEY) fail('Set the ADMIN_KEY environment variable to use the admin page', 503);
    if (req.get('x-admin-key') !== (await load()).settings.adminKey) fail('Wrong admin key', 401);
  })().then(() => next(), (err) => res.status(err.code || 500).json({ error: err.message }));
});

admin.get('/registry', h(async () => {
  const data = await load();
  return { settings: publicSettings(data.settings), items: data.items.map(adminItem) };
}));

admin.put('/settings', h((req) => mutate((data) => {
  const s = data.settings;
  if ('title' in req.body) s.title = str(req.body.title, 120) || s.title;
  if ('message' in req.body) s.message = str(req.body.message, 1000);
  if ('currency' in req.body) s.currency = str(req.body.currency, 5) || s.currency;
  return { settings: publicSettings(s) };
})));

// Photos are resized in the browser first, so they stay well under Vercel's 4.5MB request limit.
admin.post('/upload', express.raw({ type: 'image/*', limit: '4mb' }), h(async (req) => {
  if (!Buffer.isBuffer(req.body) || !req.body.length) fail('No image received');
  try {
    return { url: await saveImage(req.body, req.get('content-type')) };
  } catch (err) {
    if (err.code === 400) fail(err.message);
    throw err;
  }
}));

admin.post('/preview', h(async (req) => {
  const url = str(req.body.url, 2000);
  try {
    return await fetchPreview(url);
  } catch (err) {
    let hostname;
    try { hostname = new URL(url).hostname.replace(/^www\./, ''); } catch (_) { fail('That doesn\'t look like a valid link'); }
    // Still let the owner add the item by hand.
    return { url, title: '', description: '', image: null, siteName: hostname, price: null, warning: `Couldn't load a preview (${err.message}). You can fill in the details yourself.` };
  }
}));

function applyItemFields(item, body) {
  if ('url' in body) {
    const url = str(body.url, 2000);
    try { if (!/^https?:$/.test(new URL(url).protocol)) throw 0; } catch (_) { fail('Please enter a valid http(s) link'); }
    item.url = url;
  }
  if ('title' in body) item.title = str(body.title, 200);
  if ('description' in body) item.description = str(body.description, 1000);
  if ('image' in body) { const img = str(body.image, 2000); item.image = /^https?:\/\//i.test(img) ? img : null; }
  if ('siteName' in body) item.siteName = str(body.siteName, 100);
  if ('note' in body) item.note = str(body.note, 500);
  if ('price' in body) {
    const p = parsePrice(body.price);
    if (Number.isNaN(p)) fail('Price must be a positive number');
    item.price = p;
  }
  if ('allowPartial' in body) item.allowPartial = Boolean(body.allowPartial);
  if (!item.title) item.title = item.siteName || 'Untitled item';
}

admin.post('/items', h((req) => mutate((data) => {
  if (!('url' in req.body)) fail('A link is required');
  const item = { id: newId(), url: '', title: '', description: '', image: null, siteName: '', note: '', price: null, allowPartial: true, contributions: [], createdAt: new Date().toISOString() };
  applyItemFields(item, req.body);
  data.items.push(item);
  return { item: adminItem(item) };
})));

admin.put('/items/:id', h((req) => mutate((data) => {
  const item = findItem(data, req.params.id);
  const copy = { ...item };
  applyItemFields(copy, req.body);
  Object.assign(item, copy);
  return { item: adminItem(item) };
})));

admin.post('/items/:id/move', h((req) => mutate((data) => {
  const idx = data.items.indexOf(findItem(data, req.params.id));
  const to = idx + (req.body.direction === 'up' ? -1 : 1);
  if (to >= 0 && to < data.items.length) [data.items[idx], data.items[to]] = [data.items[to], data.items[idx]];
  return { ok: true };
})));

admin.delete('/items/:id', h((req) => mutate((data) => {
  data.items.splice(data.items.indexOf(findItem(data, req.params.id)), 1);
  return { ok: true };
})));

app.use('/api/admin', admin);

// Body-parser errors (e.g. oversized upload) arrive here rather than in h().
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'That image is too large' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid request' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
});

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  load().then((data) => app.listen(port, () => {
    console.log(`\n🍼 Baby shower registry running (${backend.kind} storage)`);
    console.log(`   Guest page (share this):  http://localhost:${port}/`);
    console.log(`   Your admin page:          http://localhost:${port}/admin#key=${data.settings.adminKey}\n`);
  }));
}

module.exports = app;
