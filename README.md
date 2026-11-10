# 🍼 Baby Shower Registry

A small, self-hosted gift registry. Paste product links, get preview cards (image, title, price pulled from the page), and share one link with guests. Guests can **buy an item outright** or **chip in** towards it — the amount comes off what's left, and the item is marked covered once it's fully funded.

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

## Sharing it with people

`localhost` only works on your machine. To share, deploy it to any Node host with a persistent disk, e.g. Render, Railway or Fly.io:

1. Create a new web service from this repo — build `npm install`, start `npm start`.
2. Set `ADMIN_KEY` and attach a persistent volume, pointing `DATA_DIR` at it.
3. Send guests the site URL; use `/admin` yourself.

## Tests

```bash
npm test
```
