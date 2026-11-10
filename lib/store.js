// Storage: Upstash Redis when configured (Vercel), otherwise a local JSON file.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const newId = () => crypto.randomBytes(8).toString('hex');
const money = (n) => Math.round(Number(n) * 100) / 100; // pennies, no float drift

function defaultData() {
  return {
    settings: {
      title: 'Our Baby Shower Registry',
      message: 'Thank you so much for celebrating with us! Pick something to buy outright, or chip in towards a bigger item.',
      currency: '£',
      adminKey: crypto.randomBytes(12).toString('hex'),
    },
    items: [],
  };
}

const redisUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const KEY = process.env.REGISTRY_KEY || 'baby-shower:registry';

let backend;
if (redisUrl && redisToken) {
  const { Redis } = require('@upstash/redis');
  const redis = new Redis({ url: redisUrl, token: redisToken });
  backend = {
    kind: 'redis',
    read: () => redis.get(KEY),
    write: (data) => redis.set(KEY, data),
    // Simple lock so two guests pledging at once can't overwrite each other.
    async withLock(fn) {
      const lock = `${KEY}:lock`;
      const token = newId();
      for (let i = 0; i < 50; i++) {
        if (await redis.set(lock, token, { nx: true, px: 5000 })) {
          try { return await fn(); } finally {
            if ((await redis.get(lock)) === token) await redis.del(lock);
          }
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error('The registry is busy, please try again');
    },
  };
} else {
  const dir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
  const file = path.join(dir, 'registry.json');
  let queue = Promise.resolve();
  backend = {
    kind: 'file',
    file,
    read: async () => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null),
    write: async (data) => {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file + '.tmp', JSON.stringify(data, null, 2));
      fs.renameSync(file + '.tmp', file);
    },
    withLock(fn) {
      const run = queue.then(fn, fn);
      queue = run.catch(() => {});
      return run;
    },
  };
}

async function load() {
  let data = await backend.read();
  if (!data) {
    data = defaultData();
    await backend.write(data);
  }
  if (process.env.ADMIN_KEY) data.settings.adminKey = process.env.ADMIN_KEY;
  return data;
}

// Read-modify-write under a lock. fn may mutate data and return a result.
function mutate(fn) {
  return backend.withLock(async () => {
    const data = await load();
    const result = await fn(data);
    await backend.write(data);
    return result;
  });
}

function itemTotals(item) {
  const contributed = money(item.contributions.reduce((s, c) => s + c.amount, 0));
  const fullyClaimed = item.contributions.some((c) => c.type === 'full');
  const price = item.price == null ? null : money(item.price);
  let remaining = null;
  let complete = fullyClaimed;
  if (price != null) {
    remaining = fullyClaimed ? 0 : Math.max(0, money(price - contributed));
    if (remaining === 0) complete = true;
  }
  return { contributed, remaining, complete };
}

module.exports = { load, mutate, newId, money, itemTotals, backend };
