let state = { settings: { currency: '£' }, items: [] };
let filter = 'open';
let current = null;

// Pledges made from this browser, so guests can see and undo their own.
const MINE_KEY = 'registry-my-gifts';
const loadMine = () => { try { return JSON.parse(localStorage.getItem(MINE_KEY)) || []; } catch (_) { return []; } };
const saveMine = (m) => { try { localStorage.setItem(MINE_KEY, JSON.stringify(m)); } catch (_) {} };
let mine = loadMine();

async function refresh() {
  state = await api('/api/registry');
  $('#title').textContent = state.settings.title;
  $('#message').textContent = state.settings.message;
  document.title = state.settings.title;
  const savedName = localStorage.getItem('registry-name');
  if (savedName) $('#name').value = savedName;
  render();
}

function render() {
  const cur = state.settings.currency;
  const mineByItem = {};
  mine.forEach((m) => (mineByItem[m.itemId] ||= []).push(m));

  let items = state.items;
  if (filter === 'open') items = items.filter((i) => !i.complete);
  if (filter === 'mine') items = items.filter((i) => mineByItem[i.id]);

  const grid = $('#grid');
  if (!items.length) {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1">${
      filter === 'open' && state.items.length ? 'Everything has been covered — thank you! 💕'
        : filter === 'mine' ? 'You haven\'t picked anything yet.' : 'No items yet — check back soon!'}</div>`;
    return;
  }

  grid.innerHTML = items.map((item) => {
    const my = mineByItem[item.id] || [];
    const badge = item.complete ? 'Covered ✓' : item.contributorCount ? `${item.contributorCount} chipped in` : '';
    return `
    <article class="card${item.complete ? ' done' : ''}">
      <a href="${esc(item.url)}" target="_blank" rel="noopener">${imageBlock(item, badge)}</a>
      <div class="body">
        <div class="site">${esc(item.siteName)}</div>
        <h3><a href="${esc(item.url)}" target="_blank" rel="noopener">${esc(item.title)}</a></h3>
        ${item.price != null ? `<div class="price">${fmt(item.price, cur)}</div>` : ''}
        ${item.description ? `<p class="desc">${esc(item.description)}</p>` : ''}
        ${item.note ? `<p class="note">💬 ${esc(item.note)}</p>` : ''}
        ${progressBlock(item, cur)}
        ${my.map((m) => `<div class="small">You ${m.type === 'full' ? 'are getting this' : `pledged ${fmt(m.amount, cur)}`} · <button class="ghost" data-undo="${m.id}">undo</button></div>`).join('')}
        <div class="actions">
          ${item.complete ? '' : `<button data-give="${item.id}">${item.allowPartial && item.price != null ? 'Buy or chip in' : 'I\'ll get this'}</button>`}
          <a class="btn secondary" href="${esc(item.url)}" target="_blank" rel="noopener">View</a>
        </div>
      </div>
    </article>`;
  }).join('');
}

function openGive(item) {
  current = item;
  const cur = state.settings.currency;
  const canPartial = item.allowPartial && item.price != null;
  $('#give-title').textContent = item.title;
  $('#give-sub').textContent = item.price != null
    ? (item.contributed ? `${fmt(item.remaining, cur)} left of ${fmt(item.price, cur)}` : `${fmt(item.price, cur)}`)
    : 'Let everyone know you\'re getting this so nobody doubles up.';
  $('#mode-pick').hidden = !canPartial;
  $('#give-form').type.value = 'full';
  $('#amount-wrap').hidden = true;
  $('#amount').max = item.remaining ?? '';
  $('#amount').value = '';
  $('#give-error').textContent = '';
  updateSubmitLabel();
  $('#give').showModal();
}

function updateSubmitLabel() {
  const partial = $('#give-form').type.value === 'partial';
  $('#amount-wrap').hidden = !partial;
  $('#give-submit').textContent = partial ? 'Pledge' : (current.price != null && current.contributed ? `Cover the remaining ${fmt(current.remaining, state.settings.currency)}` : 'I\'ll get this');
}

$('#give-form').addEventListener('change', (e) => { if (e.target.name === 'type') updateSubmitLabel(); });

$('#give-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const type = $('#give-form').type.value;
  const name = $('#name').value.trim();
  try {
    $('#give-submit').disabled = true;
    const { contribution } = await api(`/api/items/${current.id}/contribute`, {
      method: 'POST',
      body: { type, name, amount: $('#amount').value, message: $('#msg').value },
    });
    try { localStorage.setItem('registry-name', name); } catch (_) {}
    mine.push(contribution);
    saveMine(mine);
    $('#give').close();
    $('#msg').value = '';
    toast('Thank you! 💕');
    await refresh();
  } catch (err) {
    $('#give-error').textContent = err.message;
    if (/already been covered|Only .* left/.test(err.message)) refresh();
  } finally {
    $('#give-submit').disabled = false;
  }
});

document.addEventListener('click', async (e) => {
  const give = e.target.closest('[data-give]');
  if (give) return openGive(state.items.find((i) => i.id === give.dataset.give));

  const undo = e.target.closest('[data-undo]');
  if (undo) {
    const m = mine.find((x) => x.id === undo.dataset.undo);
    if (!m || !confirm('Undo this pledge?')) return;
    try {
      await api(`/api/items/${m.itemId}/contributions/${m.id}`, { method: 'DELETE', headers: { 'x-cancel-token': m.cancelToken } });
    } catch (err) {
      if (!/not found/i.test(err.message)) return toast(err.message);
    }
    mine = mine.filter((x) => x.id !== m.id);
    saveMine(mine);
    return refresh();
  }

  const f = e.target.closest('[data-f]');
  if (f) {
    filter = f.dataset.f;
    document.querySelectorAll('[data-f]').forEach((b) => b.classList.toggle('on', b === f));
    render();
  }
});

refresh().catch((err) => { $('#grid').innerHTML = `<div class="empty">${esc(err.message)}</div>`; });
setInterval(() => { if (!$('#give').open) refresh().catch(() => {}); }, 30000);
