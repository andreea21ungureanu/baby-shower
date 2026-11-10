const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, cur) => cur + Number(n).toLocaleString(undefined, { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

function imageBlock(item, badge) {
  const style = item.image ? ` style="background-image:url('${esc(item.image)}')"` : '';
  return `<div class="img${item.image ? ' has' : ''}"${style}>${item.image ? '' : '🎁'}${badge ? `<span class="badge">${badge}</span>` : ''}</div>`;
}

function progressBlock(item, cur) {
  if (item.price == null) return '';
  const pct = Math.min(100, (item.contributed / item.price) * 100);
  return `
    <div class="progress"><span style="width:${pct}%"></span></div>
    <div class="small">${item.complete ? 'Fully covered 🎉' : `${fmt(item.contributed, cur)} given · <b>${fmt(item.remaining, cur)} to go</b>`}</div>`;
}
