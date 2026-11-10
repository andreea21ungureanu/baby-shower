const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { load, save, newId, money, itemTotals } = require('./lib/store');
const { fetchPreview } = require('./lib/preview');

const app = express();
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

const str = (v, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });

function parsePrice(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = money(v);
  return Number.isFinite(n) && n > 0 ? n : NaN;
}

function publicItem(item) {
  return {
    id: item.id,
    url: item.url,
    title: item.title,
    description: item.description,
    image: item.image,
    siteName: item.siteName,
    price: item.price,
    allowPartial: item.allowPartial,
    note: item.note,
    contributorCount: item.contributions.length,
    ...itemTotals(item),
  };
}

function adminItem(item) {
  return {
    ...publicItem(item),
    contributions: item.contributions.map(({ cancelToken, ...c }) => c),
  };
}

// ---------- Guest API ----------

app.get('/api/registry', (req, res) => {
  const data = load();
  const { title, message, currency } = data.settings;
  res.json({ settings: { title, message, currency }, items: data.items.map(publicItem) });
});

app.post('/api/items/:id/contribute', (req, res) => {
  const data = load();
  const item = data.items.find((i) => i.id === req.params.id);
  if (!item) return bad(res, 'Item not found', 404);

  const name = str(req.body.name, 80);
  const message = str(req.body.message, 500);
  const type = req.body.type === 'partial' ? 'partial' : 'full';
  if (!name) return bad(res, 'Please tell us your name');

  const { remaining, complete } = itemTotals(item);
  if (complete) return bad(res, 'Sorry, this item has already been covered!', 409);

  let amount;
  if (type === 'full') {
    amount = remaining ?? 0; // whatever is left (or 0 for unpriced items)
  } else {
    if (!item.allowPartial || item.price == null) return bad(res, 'This item can only be bought outright');
    amount = money(req.body.amount);
    if (!Number.isFinite(amount) || amount <= 0) return bad(res, 'Please enter an amount');
    if (amount > remaining) return bad(res, `Only ${remaining.toFixed(2)} is left on this item`);
  }

  const contribution = {
    id: newId(),
    name,
    message,
    type: type === 'partial' && amount === remaining ? 'full' : type,
    amount,
    createdAt: new Date().toISOString(),
    cancelToken: crypto.randomBytes(16).toString('hex'),
  };
  item.contributions.push(contribution);
  save();
  res.json({
    item: publicItem(item),
    contribution: { id: contribution.id, itemId: item.id, amount, type: contribution.type, cancelToken: contribution.cancelToken },
  });
});

// Guests can undo their own pledge using the token returned when they made it.
app.delete('/api/items/:id/contributions/:cid', (req, res) => {
  const data = load();
  const item = data.items.find((i) => i.id === req.params.id);
  if (!item) return bad(res, 'Item not found', 404);
  const idx = item.contributions.findIndex((c) => c.id === req.params.cid);
  if (idx === -1) return bad(res, 'Contribution not found', 404);
  const token = String(req.get('x-cancel-token') || '');
  const isAdmin = req.get('x-admin-key') === data.settings.adminKey;
  if (!isAdmin && token !== item.contributions[idx].cancelToken) return bad(res, 'Not allowed', 403);
  item.contributions.splice(idx, 1);
  save();
  res.json({ item: isAdmin ? adminItem(item) : publicItem(item) });
});

// ---------- Owner API ----------

const admin = express.Router();
admin.use((req, res, next) => {
  if (req.get('x-admin-key') !== load().settings.adminKey) return bad(res, 'Wrong admin key', 401);
  next();
});

admin.get('/registry', (req, res) => {
  const data = load();
  const { adminKey, ...settings } = data.settings;
  res.json({ settings, items: data.items.map(adminItem) });
});

admin.put('/settings', (req, res) => {
  const data = load();
  if ('title' in req.body) data.settings.title = str(req.body.title, 120) || data.settings.title;
  if ('message' in req.body) data.settings.message = str(req.body.message, 1000);
  if ('currency' in req.body) data.settings.currency = str(req.body.currency, 5) || data.settings.currency;
  save();
  const { adminKey, ...settings } = data.settings;
  res.json({ settings });
});

admin.post('/preview', async (req, res) => {
  const url = str(req.body.url, 2000);
  try {
    res.json(await fetchPreview(url));
  } catch (err) {
    // Still let the owner add the item manually.
    let hostname = '';
    try { hostname = new URL(url).hostname.replace(/^www\./, ''); } catch (_) { return bad(res, 'That doesn\'t look like a valid link'); }
    res.json({ url, title: '', description: '', image: null, siteName: hostname, price: null, warning: `Couldn't load a preview (${err.message}). You can fill in the details yourself.` });
  }
});

function applyItemFields(item, body) {
  if ('url' in body) {
    const url = str(body.url, 2000);
    try { if (!/^https?:$/.test(new URL(url).protocol)) throw 0; } catch (_) { return 'Please enter a valid http(s) link'; }
    item.url = url;
  }
  if ('title' in body) item.title = str(body.title, 200);
  if ('description' in body) item.description = str(body.description, 1000);
  if ('image' in body) {
    const img = str(body.image, 2000);
    item.image = /^https?:\/\//i.test(img) ? img : null;
  }
  if ('siteName' in body) item.siteName = str(body.siteName, 100);
  if ('note' in body) item.note = str(body.note, 500);
  if ('price' in body) {
    const p = parsePrice(body.price);
    if (Number.isNaN(p)) return 'Price must be a positive number';
    item.price = p;
  }
  if ('allowPartial' in body) item.allowPartial = Boolean(body.allowPartial);
  if (!item.title) item.title = item.siteName || 'Untitled item';
  return null;
}

admin.post('/items', (req, res) => {
  const data = load();
  const item = { id: newId(), url: '', title: '', description: '', image: null, siteName: '', note: '', price: null, allowPartial: true, contributions: [], createdAt: new Date().toISOString() };
  if (!('url' in req.body)) return bad(res, 'A link is required');
  const err = applyItemFields(item, req.body);
  if (err) return bad(res, err);
  data.items.push(item);
  save();
  res.json({ item: adminItem(item) });
});

admin.put('/items/:id', (req, res) => {
  const data = load();
  const item = data.items.find((i) => i.id === req.params.id);
  if (!item) return bad(res, 'Item not found', 404);
  const copy = { ...item };
  const err = applyItemFields(copy, req.body);
  if (err) return bad(res, err);
  Object.assign(item, copy);
  save();
  res.json({ item: adminItem(item) });
});

admin.post('/items/:id/move', (req, res) => {
  const data = load();
  const idx = data.items.findIndex((i) => i.id === req.params.id);
  if (idx === -1) return bad(res, 'Item not found', 404);
  const to = idx + (req.body.direction === 'up' ? -1 : 1);
  if (to >= 0 && to < data.items.length) {
    [data.items[idx], data.items[to]] = [data.items[to], data.items[idx]];
    save();
  }
  res.json({ ok: true });
});

admin.delete('/items/:id', (req, res) => {
  const data = load();
  const idx = data.items.findIndex((i) => i.id === req.params.id);
  if (idx === -1) return bad(res, 'Item not found', 404);
  data.items.splice(idx, 1);
  save();
  res.json({ ok: true });
});

app.use('/api/admin', admin);

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const data = load();
  app.listen(port, () => {
    console.log(`\n🍼 Baby shower registry running`);
    console.log(`   Guest page (share this):  http://localhost:${port}/`);
    console.log(`   Your admin page:          http://localhost:${port}/admin#key=${data.settings.adminKey}\n`);
  });
}

module.exports = app;
