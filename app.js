// Grocer UI: four tabs (Pantry, List, Scan, Spend) rendered from one state
// object. Every change goes through commit(), which saves and refreshes the badge.

import * as S from './store.js';
import { fullName } from './phnames.js';

const { CATEGORIES, UNITS, LOCATIONS, CURRENCIES } = S;

let state = S.load();
let tab = 'pantry';
try { tab = sessionStorage.getItem('larder.tab') || 'pantry'; } catch { /* storage blocked */ }

const ui = {
  search: '',
  loc: 'All',
  lowOnly: false,
  month: S.today().slice(0, 7),
  scan: null, // { token, kind, phase: loading|review|error, previews, data, error }
};

const view = document.getElementById('view');
const dialog = document.getElementById('modal');
const modalForm = document.getElementById('modal-body');
let modalSubmit = null;
const MAX_PHOTOS = 6;

// ---------- helpers ----------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fq = (n) => String(S.round(n, 2));

function money(n) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: state.settings.currency }).format(n || 0);
  } catch {
    return (n || 0).toFixed(2);
  }
}

const options = (list, selected) => list.map((v) => `<option value="${esc(v)}"${v === selected ? ' selected' : ''}>${esc(v)}</option>`).join('');
const findItem = (id) => state.items.find((i) => i.id === id);
const sortedItems = () => [...state.items].sort((a, b) => a.name.localeCompare(b.name));
const sum = (arr, f) => arr.reduce((t, x) => t + (f(x) || 0), 0);

function commit() {
  if (!S.save(state)) toast('Could not save - browser storage is full or blocked');
  updateBadge();
}

let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function applyTheme() {
  const t = state.settings.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  const paper = getComputedStyle(document.documentElement).getPropertyValue('--paper').trim();
  document.querySelector('meta[name="theme-color"]').setAttribute('content', paper || '#f7f3e9');
}

// ---------- rendering ----------

const VIEWS = { pantry: viewPantry, list: viewList, scan: viewScan, spend: viewSpend };

function render() {
  if (!VIEWS[tab]) tab = 'pantry';
  document.querySelectorAll('.tabs button').forEach((b) => {
    if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  view.innerHTML = VIEWS[tab]();
  updateBadge();
}

function setTab(t) {
  tab = t;
  try { sessionStorage.setItem('larder.tab', t); } catch { /* ignore */ }
  render();
  window.scrollTo(0, 0);
}

function updateBadge() {
  const n = listEntries().filter((e) => !state.checked[e.key]).length
    + state.extras.filter((x) => !state.checked['extra:' + x.id]).length;
  const badge = document.getElementById('list-badge');
  badge.hidden = n === 0;
  badge.textContent = n > 99 ? '99+' : String(n);
}

// ---------- Pantry ----------

function viewPantry() {
  if (!state.items.length) {
    return `<div class="empty">
      <h2>Your pantry is empty</h2>
      <p>Add what you have on hand, or scan your next grocery receipt and Grocer fills it in for you.</p>
      <div class="btn-row" style="justify-content:center">
        <button class="btn primary" data-act="add-item">Add an item</button>
        <button class="btn" data-act="goto" data-tab="scan">Scan a receipt</button>
        <button class="btn" data-act="demo">Load demo data</button>
      </div>
    </div>`;
  }
  return `
    <input type="search" id="search" placeholder="Search pantry" value="${esc(ui.search)}" aria-label="Search pantry" autocomplete="off">
    <div class="chips" style="margin-top:10px">
      ${['All', ...LOCATIONS].map((l) => `<button class="chip" data-act="loc" data-loc="${l}" aria-pressed="${ui.loc === l}">${l}</button>`).join('')}
      <button class="chip" data-act="low-only" aria-pressed="${ui.lowOnly}">Low &amp; out only</button>
    </div>
    <div id="pantry-list">${pantryList()}</div>
    <button class="btn primary fab" data-act="add-item">+ Add item</button>`;
}

// Search text: "Hunt's Pork & Beans" is found by "hunts pork and beans", "pork beans" or "hunt".
const searchable = (s) => String(s || '').toLowerCase().replace(/['’`]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();

function pantryList() {
  const q = searchable(ui.search).split(' ').filter((w) => w && w !== 'and');
  const hit = (i) => { const t = searchable(`${i.name} ${i.notes || ''}`); return q.every((w) => t.includes(w)); };
  const out = state.items.filter((i) => S.statusOf(i) === 'out').length;
  const low = state.items.filter((i) => S.statusOf(i) === 'low').length;
  const summary = `<div class="summary"><span><b>${state.items.length}</b> items</span><span><b>${out}</b> out</span><span><b>${low}</b> running low</span></div>`;
  const items = state.items.filter((i) =>
    (ui.loc === 'All' || i.location === ui.loc)
    && (!q.length || hit(i))
    && (!ui.lowOnly || S.statusOf(i) !== 'ok'));
  if (!items.length) return summary + '<p class="empty">No items match.</p>';
  const groups = CATEGORIES.map((c) => [c, items.filter((i) => i.category === c).sort((a, b) => a.name.localeCompare(b.name))])
    .filter(([, list]) => list.length);
  return summary + groups.map(([c, list]) => `<h3>${esc(c)}</h3><div class="rows">${list.map(itemRow).join('')}</div>`).join('');
}

function itemRow(i) {
  const st = S.statusOf(i);
  const days = S.daysUntil(i.expires);
  let pills = '';
  if (st === 'out') pills += '<span class="pill out">Out</span>';
  if (st === 'low') pills += '<span class="pill low">Low</span>';
  if (days !== null && days <= 3) {
    const label = days < 0 ? 'Expired' : days === 0 ? 'Expires today' : `Expires in ${days}d`;
    pills += `<span class="pill exp">${label}</span>`;
  }
  return `<div class="row">
    <div class="row-main" role="button" tabindex="0" data-act="edit-item" data-id="${esc(i.id)}">
      <div class="row-name">${esc(i.name)}</div>
      <div class="row-sub">${pills}<span>${esc(i.location)}</span>${i.lastPrice ? `<span class="money">${money(i.lastPrice)}/${esc(i.unit)}</span>` : ''}</div>
    </div>
    <div class="qty">
      <button data-act="dec" data-id="${esc(i.id)}" aria-label="Use some ${esc(i.name)}">&minus;</button>
      <div class="qty-val">${fq(i.qty)} <small>${esc(i.unit)}</small></div>
      <button data-act="inc" data-id="${esc(i.id)}" aria-label="Add some ${esc(i.name)}">+</button>
    </div>
  </div>`;
}

function refreshPantryList() {
  const el = document.getElementById('pantry-list');
  if (el) el.innerHTML = pantryList();
}

function openItemModal(existing) {
  const i = existing || S.newItem({});
  const history = (existing?.priceHistory || []).slice(-5).reverse();
  openModal(`
    <h2>${existing ? 'Edit item' : 'Add item'}</h2>
    <div class="stack">
      <label class="field">Name<input type="text" name="name" value="${esc(existing ? i.name : '')}" required autocomplete="off"></label>
      <div class="grid2">
        <label class="field">Category<select name="category">${options(CATEGORIES, i.category)}</select></label>
        <label class="field">Stored in<select name="location">${options(LOCATIONS, i.location)}</select></label>
      </div>
      <div class="grid3">
        <label class="field">On hand<input type="number" name="qty" min="0" step="any" inputmode="decimal" value="${fq(i.qty)}"></label>
        <label class="field">Unit<select name="unit">${options(UNITS, i.unit)}</select></label>
        <label class="field">Expires<input type="date" name="expires" value="${esc(i.expires)}"></label>
      </div>
      <div class="grid2">
        <label class="field">Low alert at<input type="number" name="low" min="0" step="any" inputmode="decimal" value="${fq(i.low)}">
          <div class="hint">On the list at or below this. 0 = only when out.</div></label>
        <label class="field">Ideal stock<input type="number" name="par" min="0" step="any" inputmode="decimal" value="${fq(i.par)}">
          <div class="hint">The list tops you back up to this.</div></label>
      </div>
      <label class="field">Notes<input type="text" name="notes" value="${esc(i.notes)}" placeholder="Brand, size, where to buy" autocomplete="off"></label>
      ${history.length ? `<div><h3 style="margin-top:8px">Recent prices</h3>${history.map((h) => `<div class="small"><span class="money">${money(h.price)}</span>/${esc(i.unit)} <span class="muted">· ${esc(h.date)}${h.store ? ' · ' + esc(h.store) : ''}</span></div>`).join('')}</div>` : ''}
    </div>
    <div class="btn-row">
      <button class="btn primary" type="submit">Save</button>
      <button class="btn" type="button" data-close>Cancel</button>
      ${existing ? `<button class="btn danger" type="button" data-act="delete-item" data-id="${esc(i.id)}">Delete</button>` : ''}
    </div>`, (fd) => {
    const name = String(fd.get('name') || '').trim();
    if (!name) { toast('Give the item a name'); return false; }
    const low = Math.max(0, S.round(S.num(fd.get('low'))));
    S.changeUnit(i, fd.get('unit'));
    if (existing) renameItem(i, name);
    Object.assign(i, {
      name,
      category: fd.get('category'),
      location: fd.get('location'),
      qty: Math.max(0, S.round(S.num(fd.get('qty')))),
      low,
      par: Math.max(low, S.round(S.num(fd.get('par')))),
      expires: fd.get('expires') || '',
      notes: String(fd.get('notes') || '').trim(),
      updatedAt: Date.now(),
    });
    if (!existing) state.items.push(i);
    commit();
    render();
    toast(existing ? 'Saved' : `Added ${name}`);
  });
}

// ---------- Shopping list ----------

function listEntries() {
  return state.items
    .filter((i) => S.statusOf(i) !== 'ok')
    .map((i) => {
      const need = S.needOf(i);
      return { key: 'item:' + i.id, item: i, need, est: i.lastPrice ? i.lastPrice * need : null };
    });
}

function viewList() {
  const entries = listEntries();
  const extras = state.extras;
  const est = sum(entries, (e) => e.est);
  const unpriced = entries.filter((e) => e.est === null).length;
  const ticked = entries.filter((e) => state.checked[e.key]).length + extras.filter((x) => state.checked['extra:' + x.id]).length;

  const section = (title, list) => list.length ? `<h3>${title}</h3><div class="rows">${list.map((e) => `
    <label class="row${state.checked[e.key] ? ' done' : ''}">
      <input type="checkbox" class="check" data-act="tick" data-key="${esc(e.key)}"${state.checked[e.key] ? ' checked' : ''}>
      <div class="row-main"><div class="row-name">${esc(e.item.name)}</div>
        <div class="row-sub"><span>Buy ${fq(e.need)} ${esc(e.item.unit)}</span><span>· have ${fq(e.item.qty)}</span></div></div>
      <div class="small money">${e.est !== null ? money(e.est) : ''}</div>
    </label>`).join('')}</div>` : '';

  const extrasHtml = `<h3>Extras</h3>
    ${extras.length ? `<div class="rows">${extras.map((x) => `
      <div class="row${state.checked['extra:' + x.id] ? ' done' : ''}">
        <input type="checkbox" class="check" data-act="tick" data-key="extra:${esc(x.id)}" aria-label="Got ${esc(x.name)}"${state.checked['extra:' + x.id] ? ' checked' : ''}>
        <div class="row-main"><div class="row-name">${esc(x.name)}</div>${x.note ? `<div class="row-sub">${esc(x.note)}</div>` : ''}</div>
        <button class="icon-btn" data-act="remove-extra" data-id="${esc(x.id)}" aria-label="Remove ${esc(x.name)}">&times;</button>
      </div>`).join('')}</div>` : ''}
    <form id="extra-form" style="display:flex;gap:8px;margin-top:8px">
      <input type="text" name="name" placeholder="Add something else" aria-label="Item to add" autocomplete="off" style="flex:2">
      <input type="text" name="note" placeholder="How much" aria-label="How much" autocomplete="off" style="flex:1">
      <button class="btn" type="submit">Add</button>
    </form>`;

  if (!entries.length && !extras.length) {
    return `${cartPanel()}<h2>Shopping list</h2>
      <div class="card"><b>Nothing to buy.</b> <span class="muted">Items show up here automatically when they run low in the pantry.</span></div>
      ${extrasHtml}`;
  }

  return `${cartPanel()}<h2>Shopping list</h2>
    <div class="summary"><span><b>${entries.length + extras.length}</b> to buy</span>
      <span>Estimated <b class="money">${money(est)}</b>${unpriced ? ` + ${unpriced} unpriced` : ''}</span></div>
    ${section('Out of stock', entries.filter((e) => S.statusOf(e.item) === 'out'))}
    ${section('Running low', entries.filter((e) => S.statusOf(e.item) === 'low'))}
    ${extrasHtml}
    <div class="btn-row">
      <button class="btn" data-act="copy-list">Copy list</button>
      <button class="btn" data-act="restock"${ticked ? '' : ' disabled'}>Restock ticked (${ticked})</button>
    </div>
    <p class="small muted">Tick things off in the store. Then scan the receipt to restock and log the cost in one go, or use "Restock ticked" if you have no receipt.</p>`;
}

function restockTicked() {
  let n = 0;
  for (const e of listEntries()) {
    if (!state.checked[e.key]) continue;
    e.item.qty = S.round(e.item.qty + e.need);
    e.item.updatedAt = Date.now();
    n++;
  }
  const before = state.extras.length;
  state.extras = state.extras.filter((x) => !state.checked['extra:' + x.id]);
  n += before - state.extras.length;
  state.checked = {};
  commit();
  render();
  toast(`Restocked ${n} item${n === 1 ? '' : 's'}`);
}

async function copyList() {
  const lines = listEntries().map((e) => `- ${e.item.name}: ${fq(e.need)} ${e.item.unit}`)
    .concat(state.extras.map((x) => `- ${x.name}${x.note ? ': ' + x.note : ''}`));
  const text = `Shopping list\n${lines.join('\n')}`;
  try {
    await navigator.clipboard.writeText(text);
    toast('List copied');
  } catch {
    openModal(`<h2>Shopping list</h2><textarea rows="12" readonly>${esc(text)}</textarea>
      <div class="btn-row"><button class="btn" type="button" data-close>Close</button></div>`);
    modalForm.querySelector('textarea').select();
  }
}

// ---------- Cart (shopping in the store) ----------
// Photograph each item with its shelf price tag as it goes in the trolley; the
// cart keeps a running total. Checking out saves the trip once: items into the
// pantry, prices into each item's history, the total into spending - the same
// as scanning that trip's receipt, so do one or the other.

const cartTotal = () => S.round(sum(state.cart.lines, (l) => l.price * l.qty), 2);

function cartPanel() {
  const c = state.cart;
  const buttons = `<div class="btn-row">
      <button class="btn primary" data-act="cart-photo" data-camera="1">Snap item + price</button>
      <button class="btn" data-act="cart-photo">Choose photo</button>
      <button class="btn" data-act="cart-add">Add by hand</button>
    </div>`;
  if (!c.lines.length) {
    return `<div class="card cart" id="cart">
      <h2 style="margin:0 0 4px">Cart</h2>
      <p class="muted small" style="margin:0">Shopping now? Photograph each item with its price tag as it goes in the trolley. Grocer keeps a running total; check out to save the trip to your pantry and spending.</p>
      ${buttons}</div>`;
  }
  const count = sum(c.lines, (l) => l.qty);
  return `<div class="card cart" id="cart">
    <div class="cart-head"><h2 style="margin:0">Cart</h2><b class="money cart-total">${money(cartTotal())}</b></div>
    <label class="field" style="margin-top:8px">Store<input type="text" data-cart="store" value="${esc(c.store)}" placeholder="Which store?" autocomplete="off"></label>
    <div class="rows" style="margin-top:10px">${c.lines.map((l) => `<div class="row">
      <div class="row-main" role="button" tabindex="0" data-act="cart-edit" data-id="${esc(l.id)}">
        <div class="row-name">${esc(l.name)}</div>
        <div class="row-sub"><span class="money">${money(l.price)}</span>${l.qty > 1 ? `<span>x ${l.qty} = <span class="money">${money(l.price * l.qty)}</span></span>` : ''}</div>
      </div>
      <div class="qty">
        <button data-act="cart-dec" data-id="${esc(l.id)}" aria-label="One less ${esc(l.name)}">&minus;</button>
        <div class="qty-val">${l.qty}</div>
        <button data-act="cart-inc" data-id="${esc(l.id)}" aria-label="One more ${esc(l.name)}">+</button>
      </div></div>`).join('')}</div>
    ${buttons}
    <div class="btn-row"><button class="btn primary" data-act="cart-checkout">Check out ${money(cartTotal())} (${count} item${count === 1 ? '' : 's'})</button>
      <button class="btn danger" data-act="cart-clear">Empty cart</button></div>
  </div>`;
}

// The cart is part of the List tab; redraw just it, so the list's ticks and the
// half-typed "add something else" box stay as they are.
function refreshCart() {
  const el = document.getElementById('cart');
  if (el) el.outerHTML = cartPanel();
  else render();
  updateBadge();
}

function pickCartPhoto(camera) {
  if (ui.scan?.phase === 'loading') { toast('Wait for the receipt being read on the Scan tab'); return; }
  if (!readerReady()) {
    toast(state.settings.provider === 'local' ? 'Set the Qwen server address first' : 'Add your Anthropic API key first');
    openSettings();
    return;
  }
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  if (camera) input.capture = 'environment';
  input.hidden = true;
  input.addEventListener('change', () => {
    const file = input.files[0];
    input.remove();
    if (file) readCartPhoto(file);
  });
  document.body.appendChild(input);
  input.click();
}

let tagRead = null; // token of the photo being read; closing the dialog drops its result

async function readCartPhoto(file) {
  const token = S.uid();
  tagRead = token;
  openModal(`<h2>Reading the price tag</h2>
    <div class="loading"><div class="spinner"></div><span id="tag-progress">${state.settings.provider === 'device' ? 'Finding the tag...' : 'This usually takes 5 to 20 seconds.'}</span></div>
    <div class="btn-row"><button class="btn" type="button" data-close>Cancel</button></div>`);
  let read = null;
  let preview = '';
  let error = '';
  try {
    if (state.settings.provider === 'device') {
      const tp = await import('./tagprep.js');
      const r = await tp.readShelfPhoto(file, (f) => {
        const el = document.getElementById('tag-progress');
        if (el) el.textContent = `Reading the tag... ${Math.round(f * 100)}%`;
      });
      preview = r.preview;
      read = r;
    } else {
      const ai = await import('./ai.js');
      const img = await ai.prepareImage(file);
      preview = img.preview;
      const r = await ai.readTag(state.settings, [img], state.items);
      read = { store: r.store || '', name: r.name || '', printed: r.name || '', category: r.category, price: r.price > 0 ? r.price : null, check: false, match: validId(r.match_id) };
    }
  } catch (err) {
    error = err?.message || String(err);
  }
  if (tagRead !== token) return; // cancelled
  tagRead = null;
  const readName = String(read?.name || '').trim();
  const name = readName ? yourName(readName) : '';
  // Only a confident match fills the form: the reader's own, the item this tag text
  // was saved as before, or the exact name. A loose word match ("Milk" inside
  // "Alaska Condensed Milk") would swap a specific product for a generic one.
  const hit = read?.match ? { id: read.match } : (findItem(learnedItem(read?.printed || '')) || itemNamed(name) || null);
  openCartLine({
    name: hit ? findItem(hit.id).name : name,
    readName,
    printed: read?.printed || '',
    price: read?.price ?? '',
    qty: 1,
    match: hit?.id || '',
    category: pick(CATEGORIES, read?.category, 'Other'),
    check: !!read?.check,
    store: read?.store || '',
  }, { preview, error, unread: !read || (!readName && !read.price) });
}

// Add (or edit) one cart line. line.id present = editing.
function openCartLine(line, { preview = '', error = '', unread = false } = {}) {
  const editing = !!line.id;
  let note = '';
  if (error) note = `<div class="notice">Couldn't read that photo: ${esc(error)} Type the item in instead.</div>`;
  else if (unread) note = '<div class="notice">No price tag found in that photo. Type it in, or retake it closer with the tag in the middle.</div>';
  else if (!editing && !line.price) note = '<div class="notice">Couldn\'t read the price. Type it in.</div>';
  else if (!editing && line.check) note = '<div class="notice">Check the price - it was hard to read.</div>';
  openModal(`<h2>${editing ? 'Edit cart item' : 'Add to cart'}</h2>
    ${preview ? `<div class="thumbs"><img src="${preview}" alt="Your photo"></div>` : ''}
    ${note}
    <div class="stack">
      <label class="field">Item<input type="text" name="name" value="${esc(line.name)}" required autocomplete="off" placeholder="e.g. Argentina Corned Beef 260g"></label>
      <div class="grid2">
        <label class="field">Price each<input type="number" name="price" step="0.01" min="0" inputmode="decimal" value="${line.price === '' ? '' : line.price}" required></label>
        <label class="field">Qty<input type="number" name="qty" step="1" min="1" inputmode="numeric" value="${line.qty}"></label>
      </div>
      <label class="field">Pantry item<select name="match"><option value="">+ New item</option>${sortedItems().map((it) => `<option value="${esc(it.id)}"${it.id === line.match ? ' selected' : ''}>${esc(it.name)}</option>`).join('')}</select>
        <div class="hint">Restocks this pantry item at checkout. A different product? Pick + New item.</div></label>
      ${!state.cart.store && !editing ? `<label class="field">Store<input type="text" name="store" value="${esc(line.store || lastStore())}" placeholder="Which store?" autocomplete="off"></label>` : ''}
    </div>
    <div class="btn-row">
      <button class="btn primary" type="submit">${editing ? 'Save' : 'Add to cart'}</button>
      <button class="btn" type="button" data-close>Cancel</button>
      ${editing ? `<button class="btn danger" type="button" data-act="cart-remove" data-id="${esc(line.id)}">Remove</button>` : ''}
    </div>`, (fd) => {
    const picked = findItem(String(fd.get('match') || ''));
    let name = String(fd.get('name') || '').trim();
    const price = S.round(S.num(fd.get('price')), 2);
    if (!name && picked) name = picked.name;
    if (!name) { toast('Name the item'); return false; }
    if (!(price > 0)) { toast('Enter the price'); return false; }
    // A name you typed over the reader's is used for that product from now on.
    if (line.readName && name !== line.name) rememberRename(line.readName, name);
    const fields = {
      name,
      price,
      qty: Math.max(1, Math.round(S.num(fd.get('qty'), 1))),
      match: picked ? picked.id : '',
      category: picked ? picked.category : line.category,
      check: false,
    };
    if (editing) Object.assign(state.cart.lines.find((l) => l.id === line.id) || {}, fields);
    else state.cart.lines.push({ id: S.uid(), printed: line.printed || '', ...fields });
    const store = String(fd.get('store') || '').trim();
    if (store && !state.cart.store) state.cart.store = store.slice(0, 60);
    // On the shopping list? Tick it off.
    const listKey = picked && S.statusOf(picked) !== 'ok' ? 'item:' + picked.id : '';
    if (listKey) state.checked[listKey] = true;
    commit();
    if (tab !== 'list') setTab('list');
    else {
      refreshCart();
      const box = listKey && view.querySelector(`[data-act="tick"][data-key="${CSS.escape(listKey)}"]`);
      if (box) { box.checked = true; box.closest('.row').classList.add('done'); }
    }
    toast(editing ? 'Saved' : `Added ${name} - cart ${money(cartTotal())}`);
  });
}

// The store of the most recent trip, as a starting guess.
function lastStore() {
  const p = [...state.purchases].sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt))[0];
  return p && p.store !== 'Unknown store' ? p.store : '';
}

function checkoutCart() {
  const c = state.cart;
  if (!c.lines.length) return;
  const total = cartTotal();
  const store = c.store.trim() || 'Unknown store';
  if (!confirm(`Check out ${money(total)} at ${store}?\n\nItems go into the pantry and the total into spending. Don't also scan this trip's receipt, or it counts twice.`)) return;
  const date = S.today();
  let added = 0;
  const lines = [];
  for (const l of c.lines) {
    let item = findItem(l.match) || itemNamed(l.name);
    if (!item) {
      item = S.newItem({ name: l.name, category: l.category, unit: 'pcs', qty: 0, low: S.defaultLow(l.qty, 'pcs'), par: l.qty });
      state.items.push(item);
      added++;
    }
    // Counted in pcs/packs: add the count. Measured (g, L): add the pack size the
    // tag or name gives ("MEAT340G"); with no size, add the count and keep no
    // price - a whole pack's price recorded as the price of 1 g would be nonsense.
    const countable = S.stepOf(item.unit) === 1;
    const size = countable ? 1 : S.packQty(l.printed, item.unit) || S.packQty(l.name, item.unit);
    const qty = size ? S.round(size * l.qty) : l.qty;
    item.qty = S.round(item.qty + qty);
    item.updatedAt = Date.now();
    if (size) S.recordPrice(item, (l.price * l.qty) / qty, date, store);
    if (l.printed) S.remember(state.aliases, S.aliasKey(l.printed), item.id);
    delete state.checked['item:' + item.id];
    lines.push({ name: item.name, itemId: item.id, category: item.category, qty, unit: item.unit, lineTotal: S.round(l.price * l.qty, 2) });
  }
  state.purchases.push({ id: S.uid(), date, store, total, lines, source: 'cart', createdAt: Date.now() });
  state.cart = { store: '', lines: [] };
  ui.month = date.slice(0, 7);
  commit();
  render();
  toast(`Checked out ${money(total)} at ${store}: ${lines.length} item${lines.length === 1 ? '' : 's'} in the pantry${added ? `, ${added} new` : ''}`);
}

// ---------- Scan ----------

function viewScan() {
  if (ui.scan) return scanPanel();
  const p = state.settings.provider;
  const photo = (kind, primary) => `<button class="btn${primary ? ' primary' : ''}" data-act="pick" data-kind="${kind}" data-camera="1">Take photo</button>
      <button class="btn" data-act="pick" data-kind="${kind}">Choose photos</button>`;
  const barcodeBtn = (primary) => `<button class="btn${primary ? ' primary' : ''}" data-act="barcodes">Scan barcodes</button>`;
  const card = (title, text, buttons) => `<div class="card scan-card">
    <h2>${title}</h2><p class="muted">${text}</p><div class="btn-row">${buttons}</div></div>`;

  let notice = '';
  if (p === 'local') notice = `<div class="notice">Reading photos with Qwen on this PC (${esc(state.settings.localUrl)}). Start <b>start-qwen</b> first. <a href="#" data-act="settings">Change</a></div>`;
  else if (p === 'anthropic' && !readerReady()) notice = '<div class="notice">Claude needs an Anthropic API key, or switch to reading on this phone. <a href="#" data-act="settings">Open Settings</a>.</div>';

  const receipt = p === 'device'
    ? card('Receipt', 'Snap your receipt after shopping. Grocer reads the text right here on your phone, restocks the pantry and logs what you spent. Fix a line once and it remembers it next time. Lay it flat in good light; photograph a long receipt in overlapping parts and choose them together.', photo('receipt', true))
    : card('Receipt', 'Snap your receipt after shopping. Grocer reads each line, restocks the pantry and logs what you spent. Long receipt? Photograph it in parts and choose all the photos together.', photo('receipt', true));
  const groceries = p === 'device'
    ? card('Groceries', 'Scan barcodes one after another. Grocer looks each up in Open Food Facts, a free product database, and remembers it for next time.', barcodeBtn(true))
    : card('Groceries', 'Photograph items on the bench, in the fridge or on a shelf, or scan their barcodes one by one.', photo('items', true) + barcodeBtn(false));
  const footer = {
    device: 'Receipts are read on this device and barcodes are looked up in Open Food Facts. No AI service is used.',
    local: 'Photos are read by Qwen running on your own PC: free and private, but only from this computer.',
    anthropic: "Photos are read by Anthropic's Claude using your own API key, about a few cents per scan. Nothing is kept on any server.",
  }[p] || '';
  return `${notice}<div class="scan-cards">${receipt}${groceries}</div><p class="small muted">${footer}</p>`;
}

function readerReady() {
  const p = state.settings.provider;
  if (p === 'local') return !!state.settings.localUrl;
  if (p === 'anthropic') return !!state.settings.apiKey;
  return true;
}

function pickPhotos(kind, camera) {
  if (!readerReady()) {
    toast(state.settings.provider === 'local' ? 'Set the Qwen server address first' : 'Add your Anthropic API key first');
    openSettings();
    return;
  }
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  if (camera) input.capture = 'environment';
  else input.multiple = true;
  input.hidden = true;
  input.addEventListener('change', () => {
    const files = [...input.files];
    input.remove();
    if (files.length) startScan(kind, files);
  });
  document.body.appendChild(input);
  input.click();
}

async function startScan(kind, files) {
  const token = S.uid();
  ui.scan = { token, kind, phase: 'loading', previews: [], data: null };
  render();
  const onDevice = state.settings.provider === 'device' && kind === 'receipt';
  try {
    const ai = await import('./ai.js');
    // One photo at a time: decoding several 12 MP photos at once can crash iOS Safari.
    // Text reading wants more pixels per line than Claude/Qwen do.
    const images = [];
    for (const f of files.slice(0, MAX_PHOTOS)) images.push(await ai.prepareImage(f, onDevice ? 3200 : undefined, { forText: onDevice }));
    if (ui.scan?.token !== token) return;
    if (files.length > MAX_PHOTOS) toast(`Only the first ${MAX_PHOTOS} photos are read - scan the rest separately`);
    ui.scan.previews = images.map((i) => i.preview);
    if (tab === 'scan') render();
    let raw;
    if (onDevice) {
      const ocr = await import('./ocr.js');
      const texts = await ocr.readReceiptText(images, (f) => {
        const el = document.getElementById('scan-progress');
        if (el) el.textContent = `Reading the text... ${Math.round(f * 100)}%`;
      });
      if (ui.scan?.token !== token) return;
      ui.scan.ocrText = texts.join('\n\n--- next photo ---\n\n');
      raw = ocr.parseReceiptPhotos(texts, { dayFirst: state.settings.currency !== 'USD', match: matchReceiptLine });
    } else {
      raw = kind === 'receipt'
        ? await ai.readReceipt(state.settings, images, state.items)
        : await ai.readItems(state.settings, images, state.items);
    }
    if (ui.scan?.token !== token) return;
    ui.scan.data = kind === 'receipt' ? normalizeReceipt(raw) : normalizeItems(raw);
    ui.scan.phase = 'review';
    if (!ui.scan.data.lines.length) {
      ui.scan.phase = 'error';
      ui.scan.error = kind === 'receipt' ? 'No purchased lines were found on that receipt.' : 'No groceries were recognised in that photo.';
    }
  } catch (err) {
    if (ui.scan?.token !== token) return;
    ui.scan.phase = 'error';
    ui.scan.error = err?.message || String(err);
  }
  if (tab === 'scan') render();
  else toast(ui.scan.phase === 'review' ? 'Scan ready to review' : 'Scan failed - see the Scan tab');
}

const validId = (id) => (id && findItem(id) ? id : '');
const pick = (list, v, fallback) => (list.includes(v) ? v : fallback);

// Quantity + unit for a review line: matched lines use the pantry item's unit,
// and countable units (pcs, packs, cans) are whole numbers (3.4 bananas -> 3).
function qtyUnit(l, match) {
  const unit = match ? findItem(match).unit : pick(UNITS, l.unit, 'pcs');
  let qty = S.num(l.qty) > 0 ? S.round(S.num(l.qty)) : 1;
  if (S.stepOf(unit) === 1) qty = Math.max(1, Math.round(qty));
  return { qty, unit };
}

// The store name you confirmed for this receipt's tax number (TIN/ABN) or header
// line before - the header is often faint and misread differently each time.
function learnedStore(h) {
  if (!h) return '';
  if (h.tin && state.stores['tin:' + h.tin]) return state.stores['tin:' + h.tin];
  const key = S.aliasKey(h.header || '');
  if (key.length < 4) return '';
  if (state.stores['h:' + key]) return state.stores['h:' + key];
  const max = key.length >= 14 ? 3 : key.length >= 8 ? 2 : 1;
  for (const [k, name] of Object.entries(state.stores)) {
    if (k.startsWith('h:') && editDistance(k.slice(2), key, max) <= max) return name;
  }
  return '';
}

function normalizeReceipt(r) {
  return {
    store: learnedStore(r.storeHints) || String(r.store || '').trim(),
    storeHints: r.storeHints || null,
    date: S.validDate(r.date) || S.today(),
    total: S.round(S.num(r.total), 2),
    itemsCount: Number.isInteger(r.itemsCount) ? r.itemsCount : null,
    totalGuessed: !!r.totalGuessed,
    lines: (r.lines || []).map((l) => {
      // A line you saved on an earlier receipt wins over any reader's guess.
      const learned = l.skip ? '' : validId(state.barcodes[l.barcode]) || learnedItem(l.receipt_text);
      // A product you renamed before gets your name, and the pantry item already called that.
      const readName = String(l.name || l.receipt_text || 'Item').trim();
      const renamed = l.skip ? readName : yourName(readName);
      const byName = l.skip ? '' : itemNamed(renamed)?.id || '';
      const match = learned || byName || validId(l.match_id);
      // The reader expressed qty for its own match; re-express it for the learned item.
      let line = l;
      if (match && match !== l.match_id) {
        const conv = S.convertQty(S.num(l.qty), l.unit, findItem(match).unit);
        if (conv !== null) line = { ...l, qty: conv };
      }
      const name = match ? findItem(match).name : renamed;
      return {
        include: !l.skip && !l.duplicate,
        duplicate: !!l.duplicate,
        receiptText: String(l.receipt_text || ''),
        name,
        readName,
        shown: name,
        category: pick(CATEGORIES, l.category, 'Other'),
        ...qtyUnit(line, match),
        lineTotal: S.round(S.num(l.line_total), 2),
        match,
        guess: !learned && !byName && !!l.guess && !!match,
        check: !!l.check,
        barcode: /^\d{8,14}$/.test(l.barcode || '') ? l.barcode : '',
      };
    }),
  };
}

function normalizeItems(r) {
  return {
    mode: 'add',
    lines: (r.items || []).map((l) => {
      const readName = fullName(l.brand, l.name, l.size) || 'Item';
      const renamed = yourName(readName);
      const match = validId(l.match_id) || itemNamed(renamed)?.id || '';
      const category = pick(CATEGORIES, l.category, 'Other');
      const name = match ? findItem(match).name : renamed;
      return {
        include: true,
        name,
        readName,
        shown: name,
        notes: [l.brand, l.size].filter(Boolean).join(', '),
        category,
        location: pick(LOCATIONS, l.location, S.defaultLocation(category)),
        ...qtyUnit(l, match),
        expires: S.validDate(l.expires),
        match,
      };
    }),
  };
}

function scanPanel() {
  const s = ui.scan;
  const thumbs = s.previews.length ? `<div class="thumbs">${s.previews.map((p) => `<img src="${p}" alt="Scanned photo">`).join('')}</div>` : '';
  const noun = s.kind === 'receipt' ? 'receipt' : 'groceries';
  if (s.phase === 'loading') {
    return `<h2>Reading your ${noun}</h2>${thumbs}
      <div class="loading"><div class="spinner"></div><span id="scan-progress">${state.settings.provider === 'device' && s.kind === 'receipt'
    ? 'Getting the text reader ready (a one-off download the first time)...'
    : 'This usually takes 10 to 40 seconds.'}</span></div>
      <button class="btn" data-act="scan-cancel">Cancel</button>`;
  }
  if (s.phase === 'error') {
    return `<h2>Couldn't read that</h2>${thumbs}
      <div class="notice">${esc(s.error)}</div>
      <div class="btn-row"><button class="btn primary" data-act="pick" data-kind="${s.kind}">Try other photos</button>
      <button class="btn" data-act="scan-cancel">Back</button></div>`;
  }
  return s.kind === 'receipt' ? receiptReview(s, thumbs) : itemsReview(s, thumbs);
}

function matchSelect(i, line) {
  return `<select data-line="${i}" data-field="match" aria-label="Pantry item">
    <option value="">+ New item</option>${sortedItems().map((it) => `<option value="${esc(it.id)}"${it.id === line.match ? ' selected' : ''}>${esc(it.name)} (${esc(it.unit)})</option>`).join('')}
  </select>`;
}

// A receipt already saved: same date and total (to the cent), or same store and total.
function sameReceiptSaved(d) {
  if (!(d.total > 0)) return null;
  return state.purchases.find((p) => p.source === 'receipt' && Math.abs(p.total - d.total) < 0.01
    && (p.date === d.date || (d.store && p.store.toLowerCase() === d.store.toLowerCase()))) || null;
}

// A cart already checked out at this store on the receipt's date: probably the same trip.
function sameDayCart(d) {
  const anyStore = (s) => !s || s === 'Unknown store';
  return state.purchases.find((p) => p.source === 'cart' && p.date === d.date && (anyStore(d.store) || anyStore(p.store) || p.store.toLowerCase() === d.store.toLowerCase())) || null;
}

function receiptReview(s, thumbs) {
  const d = s.data;
  const already = sameReceiptSaved(d);
  const cartTrip = already ? null : sameDayCart(d);
  return `<h2>Check the receipt</h2>
    ${already ? `<div class="notice"><b>This receipt looks already saved</b>: ${esc(already.store)}, ${esc(already.date)}, ${money(already.total)}. Saving it again would count the shopping twice; discard unless it really is a second trip.</div>` : ''}
    ${cartTrip ? `<div class="notice"><b>You checked out a cart</b> at ${esc(cartTrip.store)} on ${esc(cartTrip.date)} (${money(cartTrip.total)}). If this receipt is the same trip, saving it would count the shopping twice.</div>` : ''}
    <p class="muted">Fix anything misread and untick lines that shouldn't go in the pantry (they still count toward the total). Names you change are remembered for next time.</p>
    ${thumbs}
    <div class="card"><div class="grid3">
      <label class="field">Store<input type="text" data-head="store" value="${esc(d.store)}" autocomplete="off"></label>
      <label class="field">Date<input type="date" data-head="date" value="${esc(d.date)}"></label>
      <label class="field">Total paid<input type="number" step="0.01" inputmode="decimal" data-head="total" value="${d.total}"></label>
    </div></div>
    <div class="card">
      ${d.lines.map((l, i) => `<div class="review-line${l.include ? '' : ' skipped'}" data-row="${i}">
        <div class="review-head">
          <input type="checkbox" class="check" data-line="${i}" data-field="include" aria-label="Add to pantry"${l.include ? ' checked' : ''}>
          <input type="text" data-line="${i}" data-field="name" value="${esc(l.name)}" aria-label="Name" autocomplete="off">
        </div>
        ${l.receiptText ? `<div class="receipt-text">${esc(l.receiptText)}${l.guess ? ' <span class="pill low">matched by name - check</span>' : ''}${l.check ? ' <span class="pill low">check price</span>' : ''}${l.duplicate ? ' <span class="pill low">repeat from overlapping photos? tick if you bought it twice</span>' : ''}</div>` : ''}
        <div class="review-grid four">
          <label class="field">Qty<input type="number" step="any" min="0" inputmode="decimal" data-line="${i}" data-field="qty" value="${l.qty}"></label>
          <label class="field">Unit<select data-line="${i}" data-field="unit">${options(UNITS, l.unit)}</select></label>
          <label class="field">Paid<input type="number" step="0.01" inputmode="decimal" data-line="${i}" data-field="lineTotal" value="${l.lineTotal}"></label>
          <label class="field">Pantry item${matchSelect(i, l)}</label>
        </div>
        ${l.match ? '' : `<label class="field" style="margin-top:8px">Category<select data-line="${i}" data-field="category">${options(CATEGORIES, l.category)}</select></label>`}
      </div>`).join('')}
      <div id="scan-totals">${receiptTotals(d)}</div>
    </div>
    ${s.ocrText ? `<details class="card small"><summary>Text read from the photo</summary><pre class="receipt-text" style="white-space:pre-wrap">${esc(s.ocrText)}</pre>
      <p class="hint">Missing a line? Add it to the pantry by hand, or retake the photo flat and well lit.</p></details>` : ''}
    <div class="btn-row">
      <button class="btn primary" data-act="scan-apply">Save to pantry &amp; spending</button>
      <button class="btn" data-act="scan-cancel">Discard</button>
    </div>`;
}

function receiptTotals(d) {
  const lines = sum(d.lines.filter((l) => l.include), (l) => l.lineTotal);
  const all = sum(d.lines, (l) => l.lineTotal);
  const other = S.round(d.total - lines, 2);
  const gap = S.round(d.total - all, 2);
  const count = sum(d.lines.filter((l) => !l.skip && l.lineTotal > 0), (l) => l.qty);
  const warn = [];
  if (d.totalGuessed) warn.push("The receipt's total couldn't be read, so Total is what the lines add up to. Type the real total above.");
  if (Math.abs(gap) >= 0.01 && d.total > 0) {
    warn.push(`The lines add up to ${money(all)}, ${money(Math.abs(gap))} ${gap > 0 ? 'short of' : 'over'} the receipt total: a line may be missing or misread. Lines marked "check price" are the likeliest.`);
  }
  if (d.itemsCount && Math.round(count) !== d.itemsCount) warn.push(`The receipt says ${d.itemsCount} items; ${Math.round(count)} were found.`);
  return `<div class="totals"><span>Ticked lines <b class="money">${money(lines)}</b></span>
    <span>Other / adjustments <b class="money">${money(other)}</b></span>
    <span>Total <b class="money">${money(d.total)}</b></span></div>
    ${warn.length ? `<p class="hint">${warn.map(esc).join(' ')}</p>` : ''}`;
}

function itemsReview(s, thumbs) {
  const d = s.data;
  return `<h2>Check the groceries</h2>
    ${thumbs}
    <div class="card">
      <div class="small" style="margin-bottom:8px">${s.fromBarcodes ? 'These scans are:' : 'These photos show:'}</div>
      <div class="seg" role="group" aria-label="What the photo shows">
        <button type="button" data-act="items-mode" data-mode="add" aria-pressed="${d.mode === 'add'}">New groceries (add)</button>
        <button type="button" data-act="items-mode" data-mode="set" aria-pressed="${d.mode === 'set'}">Everything on hand (count)</button>
      </div>
      <p class="hint">${d.mode === 'add' ? 'Quantities are added to what the pantry already has.' : 'Quantities replace the pantry count for matched items.'}</p>
    </div>
    <div class="card">
      ${d.lines.map((l, i) => `<div class="review-line${l.include ? '' : ' skipped'}" data-row="${i}">
        <div class="review-head">
          <input type="checkbox" class="check" data-line="${i}" data-field="include" aria-label="Include"${l.include ? ' checked' : ''}>
          <input type="text" data-line="${i}" data-field="name" value="${esc(l.name)}" aria-label="Name" autocomplete="off">
        </div>
        ${l.notes ? `<div class="receipt-text">${esc(l.notes)}</div>` : ''}
        <div class="review-grid four">
          <label class="field">Qty<input type="number" step="any" min="0" inputmode="decimal" data-line="${i}" data-field="qty" value="${l.qty}"></label>
          <label class="field">Unit<select data-line="${i}" data-field="unit">${options(UNITS, l.unit)}</select></label>
          <label class="field">Expires<input type="date" data-line="${i}" data-field="expires" value="${esc(l.expires)}"></label>
          <label class="field">Pantry item${matchSelect(i, l)}</label>
        </div>
        ${l.match ? '' : `<div class="grid2" style="margin-top:8px">
          <label class="field">Category<select data-line="${i}" data-field="category">${options(CATEGORIES, l.category)}</select></label>
          <label class="field">Stored in<select data-line="${i}" data-field="location">${options(LOCATIONS, l.location)}</select></label></div>`}
      </div>`).join('')}
    </div>
    <div class="btn-row">
      <button class="btn primary" data-act="scan-apply">Save to pantry</button>
      <button class="btn" data-act="scan-cancel">Discard</button>
    </div>`;
}

function onScanField(el) {
  const d = ui.scan?.data;
  if (!d) return;
  if (el.dataset.head) {
    const k = el.dataset.head;
    d[k] = k === 'total' ? S.round(S.num(el.value), 2) : el.value;
    if (k === 'total') d.totalGuessed = false;
  } else {
    const line = d.lines[Number(el.dataset.line)];
    const f = el.dataset.field;
    if (!line) return;
    if (f === 'include') {
      line.include = el.checked;
      el.closest('.review-line').classList.toggle('skipped', !el.checked);
    } else if (f === 'qty' || f === 'lineTotal') {
      line[f] = S.round(S.num(el.value), f === 'lineTotal' ? 2 : 3);
    } else if (f === 'match') {
      line.match = el.value;
      const target = findItem(line.match);
      if (target) { line.name = target.name; line.picked = true; } // picking an item names the product after it
      if (target && target.unit !== line.unit) {
        const converted = S.convertQty(line.qty, line.unit, target.unit);
        if (converted !== null) line.qty = converted;
        else toast(`Check the qty: ${target.name} is counted in ${target.unit}`);
        line.unit = target.unit;
      }
      const y = window.scrollY;
      render();
      window.scrollTo(0, y);
      return;
    } else {
      line[f] = el.value;
    }
  }
  const totals = document.getElementById('scan-totals');
  if (totals && ui.scan.kind === 'receipt') totals.innerHTML = receiptTotals(d);
}

function applyScan() {
  const s = ui.scan;
  const d = s.data;
  let added = 0;
  let updated = 0;
  // The pantry item a review line feeds, plus the line's qty in that item's unit.
  const target = (l, fields) => {
    learnName(l);
    const item = l.match ? findItem(l.match) : itemNamed(l.name);
    if (item) {
      if (l.shown !== undefined && l.name.trim() && l.name !== l.shown) renameItem(item, l.name.trim());
      updated++;
      return { item, qty: S.convertQty(l.qty, l.unit, item.unit) ?? l.qty };
    }
    added++;
    const created = S.newItem({ name: l.name, category: l.category, unit: l.unit, qty: 0, low: S.defaultLow(l.qty, l.unit), par: l.qty, ...fields });
    state.items.push(created);
    return { item: created, qty: l.qty };
  };
  if (s.kind === 'receipt') {
    const date = d.date || S.today();
    const purchaseLines = [];
    for (const l of d.lines) {
      if (!l.include) continue;
      const { item, qty } = target(l, {});
      item.qty = S.round(item.qty + qty);
      item.updatedAt = Date.now();
      if (qty > 0) S.recordPrice(item, l.lineTotal / qty, date, d.store);
      delete state.checked['item:' + item.id];
      // Learn this line (and its barcode), so the next receipt or scan matches automatically.
      if (l.barcode) S.remember(state.barcodes, l.barcode, item.id, 2000);
      const key = S.aliasKey(l.receiptText);
      S.remember(state.aliases, key, item.id);
      purchaseLines.push({ name: item.name, itemId: item.id, category: item.category, qty, unit: item.unit, lineTotal: l.lineTotal });
    }
    // Remember the store name for this receipt's tax number and header line.
    if (d.store && d.storeHints) {
      if (d.storeHints.tin) S.remember(state.stores, 'tin:' + d.storeHints.tin, d.store, 200);
      const hk = S.aliasKey(d.storeHints.header || '');
      if (hk.length >= 4) S.remember(state.stores, 'h:' + hk, d.store, 200);
    }
    state.purchases.push({
      id: S.uid(), date, store: d.store || 'Unknown store', total: d.total,
      lines: purchaseLines, source: 'receipt', createdAt: Date.now(),
    });
    ui.month = date.slice(0, 7);
  } else {
    // In count mode, several lines matched to one item (two milk brands) add up
    // to the new count instead of the last line overwriting the others.
    const counted = new Set();
    for (const l of d.lines) {
      if (!l.include) continue;
      const { item, qty } = target(l, { location: l.location, notes: l.notes });
      if (d.mode === 'set' && !counted.has(item.id)) {
        item.qty = 0;
        counted.add(item.id);
      }
      item.qty = S.round(item.qty + qty);
      if (l.barcode) {
        S.remember(state.barcodes, l.barcode, item.id, 2000);
        state.packs[l.barcode] = S.round(qty / (l.scans || 1)); // what one scan of this product adds
      }
      if (l.expires) item.expires = l.expires;
      item.updatedAt = Date.now();
    }
  }
  ui.scan = null;
  commit();
  const msg = `${updated} updated, ${added} new`;
  if (s.kind === 'receipt') { setTab('spend'); toast(`Receipt saved: ${msg}`); }
  else { setTab('pantry'); toast(`Pantry updated: ${msg}`); }
}

// ---------- Remembered renames ----------
// What a reader called a product -> the name you gave it, learned from the review
// screen and from renaming items in the pantry. Keyed like receipt lines (aliasKey),
// so "Datu Puti Adobo" and "DATU PUTI ADOBO" are the same entry.

const renameKey = (name) => { const k = S.aliasKey(name); return k.length >= 3 ? k : ''; };
const yourName = (name) => state.renames[renameKey(name)] || name;
const itemNamed = (name) => {
  const n = String(name || '').trim().toLowerCase();
  return n ? state.items.find((it) => it.name.toLowerCase() === n) || null : null;
};
function rememberRename(from, to) {
  const key = renameKey(from);
  if (key && to && renameKey(to) !== key) S.remember(state.renames, key, to);
  else if (key) delete state.renames[key]; // renamed back to what the reader says
}
// On save: a name you typed, or an item you picked, is what this product is called from now on.
function learnName(l) {
  if (l.shown === undefined || !l.readName) return;
  const name = l.name.trim();
  if (name && (name !== l.shown || l.picked)) rememberRename(l.readName, name);
}
function renameItem(item, name) {
  if (item.name === name) return;
  rememberRename(item.name, name);
  item.name = name;
}

// ---------- Matching text to pantry items (no AI) ----------

// Words that identify a product: no numbers, 3+ letters, plurals folded so
// "apples"/"apple" and "tomatoes"/"tomato" compare equal.
const words = (s) => S.aliasKey(s).toLowerCase().split(' ')
  .filter((w) => w.length >= 3 && !/\d/.test(w))
  .map((w) => w.replace(/ies$/, 'y').replace(/s$/, '').replace(/e$/, ''));

// The pantry item whose name words all appear in the text; the longest name wins
// ("Chicken thighs" beats "Chicken"). Rejected when the text clearly belongs to
// another category: "Milk" must not match MILK CHOCOLATE, nor "Rice" RICE CRACKERS.
function bestNameMatch(text) {
  const have = new Set(words(text));
  const textCat = S.guessCategory(text);
  let best = null;
  let bestLen = 0;
  for (const it of state.items) {
    const need = words(it.name);
    if (!need.length || !need.every((w) => have.has(w))) continue;
    if (textCat !== 'Pantry' && textCat !== it.category && S.guessCategory(it.name) !== textCat) continue;
    const len = need.join('').length;
    if (len > bestLen) { best = it; bestLen = len; }
  }
  return best;
}

// Small edit distance, for receipt lines read slightly differently each time (MlLK vs MILK).
function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

// The item a receipt line was saved against before: exact key, else a key that
// differs by one character (two for long lines).
function learnedItem(receiptText) {
  const key = S.aliasKey(receiptText);
  if (!key) return '';
  const exact = validId(state.aliases[key]);
  if (exact) return exact;
  if (key.length < 6) return '';
  const max = key.length >= 14 ? 2 : 1;
  for (const [k, id] of Object.entries(state.aliases)) {
    if (validId(id) && editDistance(k, key, max) <= max) return id;
  }
  return '';
}

// Used by the on-device receipt reader: learned lines first, then names.
function matchReceiptLine(name, receiptText, barcode) {
  const learned = findItem(state.barcodes[barcode]) || findItem(learnedItem(receiptText));
  if (learned) return { id: learned.id, unit: learned.unit };
  const it = bestNameMatch(name);
  return it ? { id: it.id, unit: it.unit, guess: true } : null;
}

// ---------- Barcode scanning ----------

let barcodeSession = null;

async function openBarcodeScanner() {
  barcodeSession?.stop();
  openModal(`<h2>Scan barcodes</h2>
    <video id="bc-video" playsinline muted autoplay style="width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:12px;background:#000"></video>
    <p class="small" id="bc-status" aria-live="polite">Starting the camera...</p>
    <div id="bc-list" class="small"></div>
    <div style="display:flex;gap:8px;margin-top:10px">
      <input type="text" id="bc-manual" inputmode="numeric" enterkeyhint="done" placeholder="Or type the barcode number" aria-label="Barcode number" autocomplete="off">
      <button class="btn" type="button" data-act="bc-manual">Add</button>
    </div>
    <div class="btn-row"><button class="btn primary" type="button" data-act="bc-done">Done</button>
      <button class="btn" type="button" data-close>Cancel</button></div>`);

  let barcodeLib = null;
  let stopCamera = null;
  let closed = false;    // dialog closed: ignore everything from now on
  let finishing = false; // Done pressed: no new scans while lookups finish
  const lines = [];
  const pending = [];
  const seen = new Map(); // code -> last time seen, so a barcode held in view counts once
  const status = (t) => { const el = document.getElementById('bc-status'); if (el && !closed) el.textContent = t; };
  const drawList = () => {
    const el = document.getElementById('bc-list');
    if (el && !closed) el.innerHTML = lines.map((l) => `<div>${esc(l.name || `Barcode ${l.barcode}`)} <span class="muted">&times; ${l.scans}</span></div>`).join('');
  };
  // One scan adds `per` of the item's unit: 1 for packs, or the pack size for items
  // you count in g/kg/mL/L (a 380 g jar adds 380 g).
  const setItem = (line, it, sizeText) => {
    line.match = it.id;
    line.unit = it.unit;
    line.per = state.packs[line.barcode] || S.packQty(sizeText, it.unit) || 1;
    line.qty = S.round(line.per * line.scans);
  };

  const session = {
    add(code, typed) {
      if (closed || finishing) return;
      if (!barcodeLib) { toast('Still getting the scanner ready...'); return; }
      if (!barcodeLib.validGtin(code)) { if (typed) toast('That is not a valid product barcode'); return; }
      const now = Date.now();
      const last = seen.get(code) || 0;
      seen.set(code, now); // every sighting refreshes, so holding still never re-adds
      if (!typed && now - last < 2500) return;
      navigator.vibrate?.(40);
      const existing = lines.find((l) => l.barcode === code);
      if (existing) {
        existing.scans += 1;
        existing.qty = S.round(existing.per * existing.scans);
        drawList();
        status(`${existing.name || code}: ${existing.scans}. Take it out of view, then scan again to count another.`);
        return;
      }
      const line = {
        include: true, barcode: code, name: '', notes: '', category: 'Pantry', location: 'Pantry',
        qty: 1, unit: 'pcs', per: 1, scans: 1, expires: '', match: '',
      };
      lines.push(line);
      const known = findItem(state.barcodes[code]);
      if (known) {
        Object.assign(line, { name: known.name, category: known.category, location: known.location });
        setItem(line, known, '');
        drawList();
        status(`Added ${known.name}`);
        return;
      }
      line.name = 'Looking up...';
      drawList();
      pending.push(barcodeLib.lookupProduct(code).then((p) => {
        if (p.status === 'found') {
          const category = S.guessCategory(`${p.tags} ${p.name}`);
          const readName = fullName(p.brand, p.name, p.size);
          const name = yourName(readName);
          Object.assign(line, {
            name, readName, notes: [p.brand, p.size].filter(Boolean).join(', '), category,
            location: S.defaultLocation(category),
          });
          const it = itemNamed(name) || bestNameMatch(name);
          if (it) setItem(line, it, p.size);
          status(`Added ${name}`);
        } else {
          line.name = '';
          line.notes = `Barcode ${code}`;
          status(p.status === 'error'
            ? `Couldn't reach the product database for ${code} (offline?). Name it on the next screen.`
            : `${code} isn't in the product database yet. Name it on the next screen and Grocer will remember it.`);
        }
        drawList();
      }));
    },
    stop() {
      closed = true;
      stopCamera?.();
      stopCamera = null;
      if (barcodeSession === session) barcodeSession = null;
    },
    async done() {
      if (closed || finishing) return;
      finishing = true;
      stopCamera?.();
      stopCamera = null;
      status('Finishing lookups...');
      await Promise.allSettled(pending);
      if (closed) return; // cancelled while waiting
      session.stop();
      closeModal();
      if (!lines.length) return;
      for (const l of lines) {
        if (!l.name) l.name = l.notes || `Barcode ${l.barcode}`;
        if (l.match) l.name = findItem(l.match)?.name || l.name;
        l.shown = l.name;
      }
      ui.scan = { token: S.uid(), kind: 'items', phase: 'review', previews: [], fromBarcodes: true, data: { mode: 'add', lines } };
      setTab('scan');
    },
  };
  barcodeSession = session;

  // Enter / "Done" on the phone keyboard adds the typed code instead of submitting the dialog.
  document.getElementById('bc-manual').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const code = e.target.value.replace(/\D/g, '');
    if (code) { session.add(code, true); e.target.value = ''; }
  });

  try {
    barcodeLib = await import('./barcode.js');
    if (closed) return;
    const stop = await barcodeLib.startScanner(document.getElementById('bc-video'), (code) => session.add(code, false));
    if (closed || finishing) { stop(); return; }
    stopCamera = stop;
    status('Point the camera at a barcode. To count two of something, scan it, move it away, scan again.');
  } catch (err) {
    if (closed) return;
    const denied = err?.name === 'NotAllowedError';
    status(denied ? 'Camera permission was refused. Type the numbers instead, or allow the camera in the browser settings.'
      : `Camera unavailable (${err?.message || err}). Type the numbers instead.`);
    barcodeLib ??= await import('./barcode.js').catch(() => null);
  }
}

// ---------- Spend ----------

function shiftMonth(key, delta) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(key, short) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, short ? { month: 'short' } : { month: 'long', year: 'numeric' });
}

const inMonth = (key) => state.purchases.filter((p) => (p.date || '').startsWith(key));

function byCategory(purchases) {
  const totals = {};
  const add = (k, v) => { totals[k] = (totals[k] || 0) + v; };
  for (const p of purchases) {
    if (!p.lines?.length) { add(p.category || 'Other', p.total); continue; }
    let lines = 0;
    for (const l of p.lines) { add(l.category || 'Other', l.lineTotal); lines += l.lineTotal; }
    const adj = S.round(p.total - lines, 2);
    if (Math.abs(adj) >= 0.01) add('Adjustments', adj);
  }
  return Object.entries(totals).filter(([, v]) => Math.abs(v) >= 0.01).sort((a, b) => b[1] - a[1]);
}

function priceWatch() {
  return state.items
    .filter((i) => (i.priceHistory || []).length >= 2)
    .map((i) => {
      const h = i.priceHistory;
      const prev = h[h.length - 2].price;
      const last = h[h.length - 1].price;
      return { item: i, prev, last, change: prev ? last / prev - 1 : 0 };
    })
    .filter((x) => Math.abs(x.change) >= 0.01)
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
    .slice(0, 6);
}

function bars(rows) {
  const max = Math.max(...rows.map(([, v]) => Math.abs(v)), 1);
  return `<div class="bars">${rows.map(([k, v]) => `<div class="bar-row"><span>${esc(k)}</span>
    <div class="bar-track"><div class="bar-fill" style="width:${Math.max(2, Math.abs(v) / max * 100)}%"></div></div>
    <span class="money">${money(v)}</span></div>`).join('')}</div>`;
}

function viewSpend() {
  const key = ui.month;
  const list = inMonth(key).sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));
  const total = sum(list, (p) => p.total);
  const prevTotal = sum(inMonth(shiftMonth(key, -1)), (p) => p.total);
  const diff = total - prevTotal;
  const stores = {};
  for (const p of list) stores[p.store] = (stores[p.store] || 0) + p.total;

  const months = [-5, -4, -3, -2, -1, 0].map((d) => shiftMonth(key, d));
  const monthTotals = months.map((m) => sum(inMonth(m), (p) => p.total));
  const maxMonth = Math.max(...monthTotals, 1);
  const watch = priceWatch();

  const compare = prevTotal > 0
    ? `<span class="${diff > 0 ? 'up' : 'down'}">${diff > 0 ? '&uarr;' : '&darr;'} ${money(Math.abs(diff))}</span> vs ${monthLabel(shiftMonth(key, -1))}`
    : 'No spending logged the month before';

  return `<div class="month-nav">
      <button class="btn small-btn" data-act="month" data-delta="-1" aria-label="Previous month">&lsaquo;</button>
      <h2 style="margin:0">${monthLabel(key)}</h2>
      <button class="btn small-btn" data-act="month" data-delta="1" aria-label="Next month">&rsaquo;</button>
    </div>
    <div class="card" style="margin-top:12px">
      <div class="small muted">Spent on groceries</div>
      <div class="big">${money(total)}</div>
      <div class="small">${compare}</div>
      <div class="small muted" style="margin-top:4px">${list.length} trip${list.length === 1 ? '' : 's'}${list.length ? ` · avg ${money(total / list.length)}` : ''}</div>
    </div>

    <h3>Last 6 months</h3>
    <div class="card"><div class="cols">${months.map((m, i) => `<div class="col${m === key ? ' current' : ''}">
      <span class="money">${monthTotals[i] ? money(monthTotals[i]).replace(/\.\d+$/, '') : ''}</span>
      <div class="col-bar" style="height:${monthTotals[i] / maxMonth * 100}%"></div>
      <span>${monthLabel(m, true)}</span></div>`).join('')}</div></div>

    ${list.length ? `<h3>By category</h3><div class="card">${bars(byCategory(list))}</div>` : ''}
    ${Object.keys(stores).length > 1 ? `<h3>By store</h3><div class="card">${bars(Object.entries(stores).sort((a, b) => b[1] - a[1]))}</div>` : ''}

    ${watch.length ? `<h3>Price changes</h3><div class="rows">${watch.map((w) => `<div class="row">
      <div class="row-main" role="button" tabindex="0" data-act="edit-item" data-id="${esc(w.item.id)}"><div class="row-name">${esc(w.item.name)}</div>
      <div class="row-sub money">${money(w.prev)} &rarr; ${money(w.last)} per ${esc(w.item.unit)}</div></div>
      <span class="small ${w.change > 0 ? 'up' : 'down'}">${w.change > 0 ? '&uarr;' : '&darr;'} ${Math.round(Math.abs(w.change) * 100)}%</span></div>`).join('')}</div>` : ''}

    <h3>Trips</h3>
    ${list.length ? `<div class="rows">${list.map((p) => `<div class="row">
      <div class="row-main" role="button" tabindex="0" data-act="purchase" data-id="${esc(p.id)}">
        <div class="row-name">${esc(p.store)}</div>
        <div class="row-sub"><span>${esc(p.date)}</span><span>· ${p.lines?.length ? `${p.lines.length} lines` : esc(p.category || 'Manual')}</span>${p.source === 'receipt' ? '<span>· receipt</span>' : p.source === 'cart' ? '<span>· cart</span>' : ''}</div>
      </div><b class="money">${money(p.total)}</b></div>`).join('')}</div>` : '<p class="muted">No trips logged this month. Scan a receipt, or add one by hand.</p>'}
    <div class="btn-row">
      <button class="btn primary" data-act="goto" data-tab="scan">Scan a receipt</button>
      <button class="btn" data-act="add-purchase">Add a trip by hand</button>
    </div>`;
}

function openPurchase(p) {
  openModal(`<h2>${esc(p.store)}</h2>
    <p class="muted">${esc(p.date)} · ${{ receipt: 'from receipt', cart: 'checked out from the cart' }[p.source] || 'entered by hand'}</p>
    ${p.lines?.length ? `<div class="rows">${p.lines.map((l) => `<div class="row"><div class="row-main" style="cursor:default">
      <div class="row-name">${esc(l.name)}</div><div class="row-sub">${fq(l.qty)} ${esc(l.unit)} · ${esc(l.category)}</div></div>
      <span class="money">${money(l.lineTotal)}</span></div>`).join('')}</div>` : `<p>${esc(p.category || 'Other')}</p>`}
    <div class="totals" style="margin-top:12px"><span>Total</span><b class="money">${money(p.total)}</b></div>
    <p class="hint">Deleting a trip removes it from spending only; pantry quantities stay as they are.</p>
    <div class="btn-row"><button class="btn" type="button" data-close>Close</button>
      <button class="btn danger" type="button" data-act="delete-purchase" data-id="${esc(p.id)}">Delete trip</button></div>`);
}

function openAddPurchase() {
  openModal(`<h2>Add a trip</h2>
    <div class="stack">
      <label class="field">Store<input type="text" name="store" required autocomplete="off"></label>
      <div class="grid2">
        <label class="field">Date<input type="date" name="date" value="${S.today()}" required></label>
        <label class="field">Total<input type="number" name="total" step="0.01" min="0" inputmode="decimal" required></label>
      </div>
      <label class="field">Mostly<select name="category">${options(CATEGORIES, 'Pantry')}</select></label>
    </div>
    <div class="btn-row"><button class="btn primary" type="submit">Add</button><button class="btn" type="button" data-close>Cancel</button></div>`, (fd) => {
    const total = S.round(S.num(fd.get('total')), 2);
    if (!(total > 0)) { toast('Enter the amount spent'); return false; }
    const date = fd.get('date') || S.today();
    state.purchases.push({
      id: S.uid(), date, store: String(fd.get('store') || '').trim() || 'Unknown store', total,
      category: fd.get('category'), lines: [], source: 'manual', createdAt: Date.now(),
    });
    ui.month = date.slice(0, 7);
    commit();
    render();
    toast('Trip added');
  });
}

// ---------- Settings ----------

function openSettings() {
  const st = state.settings;
  openModal(`<h2>Settings</h2>
    <div class="stack">
      <label class="field">Read photos with
        <select name="provider">
          ${[['device', 'On this device (no AI) - free, text reading + barcodes'],
    ['anthropic', 'Claude (Anthropic) - smartest, a few cents a scan'],
    ['local', 'Qwen on this PC - free, only on the PC running it']]
    .map(([v, label]) => `<option value="${v}"${st.provider === v ? ' selected' : ''}>${label}</option>`).join('')}
        </select></label>
      <label class="field">Anthropic API key
        <input type="password" name="apiKey" value="${esc(st.apiKey)}" placeholder="sk-ant-..." autocomplete="off" spellcheck="false">
        <div class="hint">For Claude. Stored on this device only and sent straight to Anthropic. Get one at console.anthropic.com.</div></label>
      <label class="field">Qwen server address
        <input type="text" name="localUrl" value="${esc(st.localUrl)}" placeholder="http://127.0.0.1:8080" autocomplete="off" spellcheck="false">
        <div class="hint">For Qwen: the llama.cpp server started by start-qwen (needs its vision file).</div></label>
      <label class="field">Currency<select name="currency">${options(CURRENCIES, st.currency)}</select></label>
      <div class="field">Theme<div style="margin-top:4px" class="seg" role="group" aria-label="Theme">
        ${['system', 'light', 'dark'].map((t) => `<button type="button" data-act="theme" data-theme="${t}" aria-pressed="${st.theme === t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}
      </div></div>
      <div class="field">Your data<div class="hint">Everything lives in this browser. Export a backup now and then, and to move it to another device.</div>
        <div class="btn-row" style="margin-top:6px">
          <button class="btn small-btn" type="button" data-act="export">Export backup</button>
          <button class="btn small-btn" type="button" data-act="import">Import backup</button>
          <button class="btn small-btn danger" type="button" data-act="wipe">Erase everything</button>
        </div></div>
    </div>
    <div class="btn-row"><button class="btn primary" type="submit">Save</button><button class="btn" type="button" data-close>Cancel</button></div>`, (fd) => {
    state.settings.apiKey = String(fd.get('apiKey') || '').trim();
    state.settings.provider = ['device', 'anthropic', 'local'].includes(fd.get('provider')) ? fd.get('provider') : 'device';
    state.settings.localUrl = String(fd.get('localUrl') || '').trim() || 'http://127.0.0.1:8080';
    state.settings.currency = fd.get('currency');
    commit();
    render();
    toast('Settings saved');
  });
}

function exportBackup() {
  const { settings, ...data } = state;
  const payload = { app: 'grocer', version: 1, exportedAt: new Date().toISOString(), currency: settings.currency, ...data };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `grocer-backup-${S.today()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function importBackup() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.hidden = true;
  input.addEventListener('change', async () => {
    const file = input.files[0];
    input.remove();
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!['grocer', 'larder'].includes(data.app) || !Array.isArray(data.items) || !Array.isArray(data.purchases)) throw new Error('not a Grocer backup');
      const clean = S.sanitize(data);
      if (!confirm(`Replace this device's data with the backup (${clean.items.length} items, ${clean.purchases.length} trips)?`)) return;
      state = {
        ...state,
        ...clean,
        checked: {},
        settings: { ...state.settings, currency: CURRENCIES.includes(data.currency) ? data.currency : state.settings.currency },
      };
      commit();
      closeModal();
      render();
      toast('Backup restored');
    } catch (err) {
      toast(`Import failed: ${err.message}`);
    }
  });
  document.body.appendChild(input);
  input.click();
}

// ---------- modal ----------

function openModal(html, onSubmit) {
  modalForm.innerHTML = html;
  modalSubmit = onSubmit || null;
  if (!dialog.open) dialog.showModal();
  const first = modalForm.querySelector('input:not([type="hidden"]), select, textarea');
  if (first && onSubmit) first.focus();
}

function closeModal() {
  if (dialog.open) dialog.close();
  modalSubmit = null;
}

// Closing the dialog any way (button, Esc, backdrop) turns the camera off.
dialog.addEventListener('close', () => {
  barcodeSession?.stop();
  if (tagRead && state.settings.provider === 'device') import('./ocr.js').then((o) => o.cancelReading()); // nobody waits for it
  tagRead = null;
});

modalForm.addEventListener('submit', (e) => {
  e.preventDefault();
  if (barcodeSession) return; // the scanner has no submit; never let Enter discard a scan session
  if (modalSubmit && modalSubmit(new FormData(modalForm)) === false) return;
  closeModal();
});
dialog.addEventListener('click', (e) => { if (e.target === dialog) closeModal(); });

// ---------- events ----------

document.addEventListener('click', (e) => {
  const tabBtn = e.target.closest('.tabs button');
  if (tabBtn) { setTab(tabBtn.dataset.tab); return; }
  if (e.target.closest('#open-settings')) { openSettings(); return; }
  if (e.target.closest('[data-close]')) { closeModal(); return; }

  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  const id = el.dataset.id;

  switch (act) {
    case 'goto': setTab(el.dataset.tab); break;
    case 'settings': e.preventDefault(); openSettings(); break;
    case 'add-item': openItemModal(null); break;
    case 'edit-item': { const it = findItem(id); if (it) openItemModal(it); break; }
    case 'delete-item': {
      const it = findItem(id);
      if (it && confirm(`Delete ${it.name}?`)) {
        state.items = state.items.filter((x) => x.id !== id);
        delete state.checked['item:' + id];
        commit(); closeModal(); render(); toast(`Deleted ${it.name}`);
      }
      break;
    }
    case 'inc':
    case 'dec': {
      const it = findItem(id);
      if (!it) break;
      const step = S.stepOf(it.unit);
      it.qty = Math.max(0, S.round(it.qty + (act === 'inc' ? step : -step)));
      it.updatedAt = Date.now();
      commit();
      refreshPantryList();
      break;
    }
    case 'loc': ui.loc = el.dataset.loc; render(); break;
    case 'low-only': ui.lowOnly = !ui.lowOnly; render(); break;
    case 'demo':
      state.items = S.demoData();
      commit(); render(); toast('Demo pantry loaded');
      break;
    case 'remove-extra':
      state.extras = state.extras.filter((x) => x.id !== id);
      delete state.checked['extra:' + id];
      commit(); render();
      break;
    case 'restock': restockTicked(); break;
    case 'copy-list': copyList(); break;
    case 'pick': pickPhotos(el.dataset.kind, el.dataset.camera === '1'); break;
    case 'cart-photo': pickCartPhoto(el.dataset.camera === '1'); break;
    case 'cart-add': openCartLine({ name: '', price: '', qty: 1, match: '', category: 'Other', store: '' }); break;
    case 'cart-edit': { const l = state.cart.lines.find((x) => x.id === id); if (l) openCartLine({ ...l }); break; }
    case 'cart-inc':
    case 'cart-dec': {
      const l = state.cart.lines.find((x) => x.id === id);
      if (!l) break;
      if (act === 'cart-inc') l.qty++;
      else if (l.qty > 1) l.qty--;
      else if (confirm(`Take ${l.name} out of the cart?`)) state.cart.lines = state.cart.lines.filter((x) => x !== l);
      commit();
      refreshCart();
      break;
    }
    case 'cart-remove':
      state.cart.lines = state.cart.lines.filter((x) => x.id !== id);
      commit(); closeModal(); refreshCart();
      break;
    case 'cart-checkout': checkoutCart(); break;
    case 'cart-clear':
      if (confirm('Empty the cart? Nothing is saved.')) { state.cart = { store: '', lines: [] }; commit(); refreshCart(); }
      break;
    case 'barcodes': openBarcodeScanner(); break;
    case 'bc-manual': {
      const input = document.getElementById('bc-manual');
      const code = input.value.replace(/\D/g, '');
      if (barcodeSession && code) { barcodeSession.add(code, true); input.value = ''; }
      break;
    }
    case 'bc-done': barcodeSession?.done(); break;
    case 'scan-cancel':
      ui.scan = null;
      render();
      import('./ocr.js').then((m) => m.cancelReading()).catch(() => {});
      break;
    case 'scan-apply': applyScan(); break;
    case 'items-mode': ui.scan.data.mode = el.dataset.mode; render(); break;
    case 'month': ui.month = shiftMonth(ui.month, Number(el.dataset.delta)); render(); break;
    case 'purchase': { const p = state.purchases.find((x) => x.id === id); if (p) openPurchase(p); break; }
    case 'delete-purchase':
      if (confirm('Delete this trip from your spending?')) {
        state.purchases = state.purchases.filter((x) => x.id !== id);
        commit(); closeModal(); render(); toast('Trip deleted');
      }
      break;
    case 'add-purchase': openAddPurchase(); break;
    case 'theme':
      state.settings.theme = el.dataset.theme;
      commit();
      applyTheme();
      modalForm.querySelectorAll('[data-act="theme"]').forEach((b) => b.setAttribute('aria-pressed', String(b === el)));
      break;
    case 'export': exportBackup(); break;
    case 'import': importBackup(); break;
    case 'wipe':
      if (confirm('Erase all pantry items, lists and spending on this device? This cannot be undone.')) {
        const settings = state.settings;
        state = { ...S.load(), items: [], purchases: [], extras: [], checked: {}, aliases: {}, renames: {}, stores: {}, barcodes: {}, packs: {}, cart: { store: '', lines: [] }, settings };
        commit(); closeModal(); render(); toast('All data erased');
      }
      break;
  }
});

document.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"][data-act]')) {
    e.preventDefault();
    e.target.click();
  }
});

document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset.act === 'tick') {
    if (el.checked) state.checked[el.dataset.key] = true;
    else delete state.checked[el.dataset.key];
    commit();
    // Update in place so half-typed text in the "add extra" box survives.
    el.closest('.row').classList.toggle('done', el.checked);
    const n = view.querySelectorAll('[data-act="tick"]:checked').length;
    const btn = view.querySelector('[data-act="restock"]');
    if (btn) { btn.textContent = `Restock ticked (${n})`; btn.disabled = n === 0; }
    return;
  }
  if (el.closest('#view') && (el.dataset.line !== undefined || el.dataset.head)) onScanField(el);
});

document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.id === 'search') { ui.search = el.value; refreshPantryList(); return; }
  if (el.dataset.cart === 'store') { state.cart.store = el.value.slice(0, 60); commit(); return; }
  if (el.closest('#view') && (el.dataset.line !== undefined || el.dataset.head) && el.type !== 'checkbox' && el.tagName !== 'SELECT') onScanField(el);
});

document.addEventListener('submit', (e) => {
  if (e.target.id !== 'extra-form') return;
  e.preventDefault();
  const fd = new FormData(e.target);
  const name = String(fd.get('name') || '').trim();
  if (!name) return;
  state.extras.push({ id: S.uid(), name, note: String(fd.get('note') || '').trim() });
  commit();
  render();
  document.querySelector('#extra-form input[name="name"]')?.focus();
});

// Another tab or the installed app saved: pick up its data instead of overwriting it later.
window.addEventListener('storage', (e) => {
  if (e.key !== 'larder.v1') return;
  state = S.load();
  applyTheme();
  if (!dialog.open && !ui.scan) render();
  else updateBadge();
});

applyTheme();
render();

// Offline support on the hosted site only; local dev always serves fresh files.
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => { /* app still works online */ });
}
