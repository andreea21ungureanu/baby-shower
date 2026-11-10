const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'registry.json');

function newId() {
  return crypto.randomBytes(8).toString('hex');
}

function defaultData() {
  return {
    settings: {
      title: 'Our Baby Shower Registry',
      message: 'Thank you so much for celebrating with us! Pick something to buy outright, or chip in towards a bigger item.',
      currency: '£',
      adminKey: process.env.ADMIN_KEY || crypto.randomBytes(12).toString('hex'),
    },
    items: [],
  };
}

let cache = null;

function load() {
  if (cache) return cache;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DATA_FILE)) {
    cache = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (process.env.ADMIN_KEY) cache.settings.adminKey = process.env.ADMIN_KEY;
  } else {
    cache = defaultData();
    save();
  }
  return cache;
}

function save() {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

// Round to pennies to avoid float drift.
const money = (n) => Math.round(Number(n) * 100) / 100;

function itemTotals(item) {
  const contributed = money(item.contributions.reduce((s, c) => s + c.amount, 0));
  const fullyClaimed = item.contributions.some((c) => c.type === 'full');
  const price = item.price == null ? null : money(item.price);
  let remaining = null;
  let complete = fullyClaimed;
  if (price != null) {
    remaining = Math.max(0, money(price - contributed));
    if (remaining === 0) complete = true;
    if (fullyClaimed) remaining = 0;
  }
  return { contributed, remaining, complete };
}

module.exports = { load, save, newId, money, itemTotals, DATA_FILE };
