let key = '';
let state = { settings: { currency: '£' }, items: [] };
let editingId = null; // null = new item

const KEY_STORE = 'registry-admin-key';
const adminApi = (path, opts = {}) => api(`/api/admin${path}`, { ...opts, headers: { 'x-admin-key': key, ...(opts.headers || {}) } });

async function unlock(k) {
  key = k;
  try {
    state = await adminApi('/registry');
  } catch (err) {
    $('#login').hidden = false;
    $('#app').hidden = true;
    if (k) $('#login-error').textContent = err.message;
    return;
  }
  try { localStorage.setItem(KEY_STORE, k); } catch (_) {}
  if (location.hash) history.replaceState(null, '', location.pathname);
  $('#login').hidden = true;
  $('#app').hidden = false;
  $('#share-url').value = location.origin + '/';
  $('#s-title').value = state.settings.title;
  $('#s-cur').value = state.settings.currency;
  $('#s-msg').value = state.settings.message;
  render();
}

async function refresh() {
  state = await adminApi('/registry');
  render();
}

function render() {
  const cur = state.settings.currency;
  const items = state.items;
  const priced = items.filter((i) => i.price != null);
  const total = priced.reduce((s, i) => s + i.price, 0);
  const given = items.reduce((s, i) => s + i.contributed, 0);
  $('#stats').innerHTML = `
    <div><b>${items.length}</b>items</div>
    <div><b>${items.filter((i) => i.complete).length}</b>covered</div>
    <div><b>${fmt(given, cur)}</b>pledged</div>
    <div><b>${fmt(Math.max(0, total - given), cur)}</b>still to go</div>`;

  $('#grid').innerHTML = items.length ? items.map((item, idx) => `
    <article class="card${item.complete ? ' done' : ''}">
      ${imageBlock(item, item.complete ? 'Covered ✓' : '')}
      <div class="body">
        <div class="toolbar">
          <button class="ghost" title="Move up" data-move="up" data-id="${item.id}" ${idx === 0 ? 'disabled' : ''}>↑</button>
          <button class="ghost" title="Move down" data-move="down" data-id="${item.id}" ${idx === items.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="ghost" data-edit="${item.id}">Edit</button>
          <button class="danger" data-del="${item.id}">Delete</button>
        </div>
        <div class="site">${esc(item.siteName)}</div>
        <h3><a href="${esc(item.url)}" target="_blank" rel="noopener">${esc(item.title)}</a></h3>
        ${item.price != null ? `<div class="price">${fmt(item.price, cur)}</div>` : '<div class="small">No price · guests just claim it</div>'}
        ${item.note ? `<p class="note">💬 ${esc(item.note)}</p>` : ''}
        ${progressBlock(item, cur)}
        ${!item.allowPartial && item.price != null ? '<div class="small">Buy outright only</div>' : ''}
        ${item.contributions.length ? `<ul class="contribs">${item.contributions.map((c) => `
          <li><span><b>${esc(c.name)}</b> — ${c.type === 'full' && !c.amount ? 'getting this' : `${fmt(c.amount, cur)}${c.type === 'full' ? ' (rest)' : ''}`}
            ${c.message ? `<span class="msg">“${esc(c.message)}”</span>` : ''}</span>
            <button class="danger" title="Remove" data-rm="${c.id}" data-item="${item.id}">✕</button></li>`).join('')}</ul>`
          : '<div class="small">No pledges yet</div>'}
      </div>
    </article>`).join('') : '<div class="empty" style="grid-column:1/-1">Nothing here yet — paste a link above to add your first item.</div>';
}

function fillDraft(d) {
  $('#d-title').value = d.title || '';
  $('#d-price').value = d.price ?? '';
  $('#d-site').value = d.siteName || '';
  $('#d-image').value = d.image || '';
  $('#d-desc').value = d.description || '';
  $('#d-note').value = d.note || '';
  $('#d-partial').checked = d.allowPartial ?? true;
  $('#draft').dataset.url = d.url;
  updateDraftImage();
  $('#draft').hidden = false;
}

function updateDraftImage() {
  const img = $('#d-image').value;
  const el = $('#draft-img');
  el.style.backgroundImage = img ? `url('${img.replace(/'/g, '%27')}')` : '';
  el.classList.toggle('has', !!img);
  el.textContent = img ? '' : '🎁';
}

function closeDraft() {
  $('#draft').hidden = true;
  editingId = null;
  $('#draft-save').textContent = 'Add to registry';
  $('#add-url').value = '';
}

$('#d-image').addEventListener('input', updateDraftImage);

// Shrink photos in the browser (max 1600px, JPEG) so uploads are small and fast.
async function resizeImage(file) {
  if (file.type === 'image/gif') return file; // keep animation
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // transparent PNGs get a white background
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
}

async function uploadPhoto(file) {
  if (!file || !file.type.startsWith('image/')) return toast('Please choose an image');
  const btn = $('#upload-btn');
  btn.firstChild.textContent = 'Uploading…';
  try {
    const blob = await resizeImage(file);
    const res = await fetch('/api/admin/upload', { method: 'POST', headers: { 'x-admin-key': key, 'Content-Type': blob.type }, body: blob });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Upload failed');
    $('#d-image').value = new URL(data.url, location.origin).href;
    updateDraftImage();
  } catch (err) {
    toast(err.message);
  } finally {
    btn.firstChild.textContent = '📷 Upload photo';
    $('#d-file').value = '';
  }
}

$('#d-file').addEventListener('change', (e) => uploadPhoto(e.target.files[0]));
const drop = $('#draft-img');
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('drag'); });
drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('drag'); uploadPhoto(e.dataTransfer.files[0]); });
// Pasting a screenshot while the form is open uploads it too.
document.addEventListener('paste', (e) => {
  if ($('#draft').hidden) return;
  const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
  if (file) { e.preventDefault(); uploadPhoto(file); }
});
$('#draft-cancel').addEventListener('click', closeDraft);

$('#login-form').addEventListener('submit', (e) => { e.preventDefault(); unlock($('#key').value.trim()); });

$('#add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#add-error').textContent = '';
  $('#add-btn').disabled = true;
  $('#add-btn').textContent = 'Loading…';
  try {
    const preview = await adminApi('/preview', { method: 'POST', body: { url: $('#add-url').value.trim() } });
    editingId = null;
    $('#draft-save').textContent = 'Add to registry';
    fillDraft(preview);
    if (preview.warning) $('#add-error').textContent = preview.warning;
    $('#d-title').focus();
  } catch (err) {
    $('#add-error').textContent = err.message;
  } finally {
    $('#add-btn').disabled = false;
    $('#add-btn').textContent = 'Get preview';
  }
});

$('#draft').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    url: $('#draft').dataset.url,
    title: $('#d-title').value,
    price: $('#d-price').value,
    siteName: $('#d-site').value,
    image: $('#d-image').value,
    description: $('#d-desc').value,
    note: $('#d-note').value,
    allowPartial: $('#d-partial').checked,
  };
  try {
    if (editingId) await adminApi(`/items/${editingId}`, { method: 'PUT', body });
    else await adminApi('/items', { method: 'POST', body });
    toast(editingId ? 'Saved' : 'Added to your registry');
    $('#add-error').textContent = '';
    closeDraft();
    refresh();
  } catch (err) {
    $('#add-error').textContent = err.message;
  }
});

$('#settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const { settings } = await adminApi('/settings', { method: 'PUT', body: { title: $('#s-title').value, currency: $('#s-cur').value, message: $('#s-msg').value } });
    state.settings = settings;
    render();
    toast('Settings saved');
  } catch (err) { toast(err.message); }
});

$('#copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('#share-url').value); toast('Link copied!'); }
  catch (_) { $('#share-url').select(); }
});

document.addEventListener('click', async (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  try {
    if (t.dataset.move) {
      await adminApi(`/items/${t.dataset.id}/move`, { method: 'POST', body: { direction: t.dataset.move } });
      return refresh();
    }
    if (t.dataset.edit) {
      const item = state.items.find((i) => i.id === t.dataset.edit);
      editingId = item.id;
      fillDraft(item);
      $('#add-url').value = item.url;
      $('#draft-save').textContent = 'Save changes';
      $('#draft').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (t.dataset.del) {
      const item = state.items.find((i) => i.id === t.dataset.del);
      if (!confirm(`Delete "${item.title}"${item.contributions.length ? ' and its pledges' : ''}?`)) return;
      await adminApi(`/items/${item.id}`, { method: 'DELETE' });
      return refresh();
    }
    if (t.dataset.rm) {
      if (!confirm('Remove this pledge? The amount will go back on the item.')) return;
      await api(`/api/items/${t.dataset.item}/contributions/${t.dataset.rm}`, { method: 'DELETE', headers: { 'x-admin-key': key } });
      return refresh();
    }
  } catch (err) { toast(err.message); }
});

const hashKey = new URLSearchParams(location.hash.slice(1)).get('key');
let stored = '';
try { stored = localStorage.getItem(KEY_STORE) || ''; } catch (_) {}
unlock(hashKey || stored);
