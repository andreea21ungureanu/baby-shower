# 🍼 Baby Shower Registry

A small gift registry you can host free on Vercel. Paste product links, get preview cards (image, title, price pulled from the page), and share one link with guests. Guests can **buy an item outright** or **chip in** towards it — the amount comes off what's left, and the item is marked covered once it's fully funded.

## Run it

```bash
npm install
npm start
```

The terminal prints two links:

- **Guest page** – `http://localhost:3000/` – share this one.
- **Admin page** – `http://localhost:3000/admin#key=…` – keep this private. Your browser remembers the key after the first visit.

Set `ADMIN_KEY=something-memorable` to choose your own key, `PORT` to change the port, and `DATA_DIR` to change where data is stored (default `./data/registry.json`).

## Features

**You (admin)**
- Paste a link → preview is fetched automatically (Open Graph / JSON-LD), then edit title, price, image, description before saving
- Add a note per item ("grey please!"), allow or disallow chipping in, leave price blank for simple "claim it" items
- See who pledged what (with their messages), remove pledges, reorder and delete items
- Totals: items, covered, pledged, still to go

**Guests**
- Browse "Still needed" / "Everything" / "My gifts"
- Buy it all, or chip in any amount up to what's left
- Undo their own pledge from the same browser
- Guests see progress and counts, not other guests' names

## Deploy to Vercel

1. Import this repo at **vercel.com/new**. No build settings needed; `vercel.json` handles it.
2. In the project, go to **Storage → Create Database → Upstash (Redis)** (free tier) and connect it. Vercel adds the `KV_REST_API_URL` / `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_*`) env vars automatically.
3. Under **Settings → Environment Variables**, add `ADMIN_KEY` set to a private password of your choice.
4. Redeploy. Share `https://<your-app>.vercel.app/` with guests and use `https://<your-app>.vercel.app/admin` yourself (enter your `ADMIN_KEY`).

Without Redis env vars the app falls back to a local JSON file, which is what `npm start` uses.

## Tests

```bash
npm test
```
