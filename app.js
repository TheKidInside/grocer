// Grocer UI: five tabs (Home, Pantry, Scan, List, Spend) rendered from one state
// object. Every change goes through commit(), which saves and refreshes the badge.

import * as S from './store.js';
import { fullName } from './phnames.js';

const { CATEGORIES, UNITS, LOCATIONS, CURRENCIES } = S;

let state = S.load();
let tab = 'home';
try { tab = sessionStorage.getItem('larder.tab') || 'home'; } catch { /* storage blocked */ }

const ui = {
  search: '',
  loc: 'All',
  lowOnly: false,
  soonOnly: false,     // pantry: only items to use within a week
  period: 'week',      // spend: week | month | year
  anchor: null,        // spend: a date inside the period shown; null = today (follows the clock past midnight)
  scanMode: 'receipt', // scan: receipt | photo | barcode
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

// Whole units for budgets and chart labels ("₱220", not "₱220.00").
function moneyWhole(n) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: state.settings.currency, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n || 0);
  } catch {
    return String(Math.round(n || 0));
  }
}

const ICON = {
  gear: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  plus: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  search: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  close: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  copy: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>',
};

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
  syncThemeColor();
}

// The phone's status bar matches the page: cream (or dark) normally, camera-dark on Scan.
function syncThemeColor() {
  const v = document.body.dataset.view === 'scan-home' ? '--camera' : '--bg';
  const c = getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  document.querySelector('meta[name="theme-color"]').setAttribute('content', c || '#f7f3e9');
}

// ---------- rendering ----------

const VIEWS = { home: viewHome, pantry: viewPantry, list: viewList, scan: viewScan, spend: viewSpend };

function render() {
  if (!VIEWS[tab]) tab = 'home';
  document.querySelectorAll('.tabs button').forEach((b) => {
    if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  document.body.dataset.view = tab === 'scan' && !ui.scan ? 'scan-home' : tab;
  view.innerHTML = VIEWS[tab]();
  syncThemeColor();
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

// ---------- dates, periods, budget ----------

const pad2 = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
const daysBetween = (a, b) => Math.round((parseYmd(b) - parseYmd(a)) / 86400000);
const validDateOr = (s) => S.validDate(s) || S.today();
const shortDate = (s) => { const d = parseYmd(s); return `${d.getDate()} ${d.toLocaleDateString(undefined, { month: 'short' })}`; };
// Weeks start on Monday.
const weekStart = (s) => { const d = parseYmd(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return ymd(d); };

// The week / month / year holding date s, as [from, to) in YYYY-MM-DD.
function periodRange(period, s) {
  if (period === 'week') { const from = weekStart(s); return { from, to: addDays(from, 7) }; }
  const d = parseYmd(s);
  if (period === 'month') return { from: ymd(new Date(d.getFullYear(), d.getMonth(), 1)), to: ymd(new Date(d.getFullYear(), d.getMonth() + 1, 1)) };
  return { from: `${d.getFullYear()}-01-01`, to: `${d.getFullYear() + 1}-01-01` };
}

// The start of the period n steps from the one holding s (n = -1: the one before).
function shiftPeriod(period, s, n) {
  if (period === 'week') return addDays(weekStart(s), 7 * n);
  const d = parseYmd(s);
  if (period === 'month') return ymd(new Date(d.getFullYear(), d.getMonth() + n, 1));
  return `${d.getFullYear() + n}-01-01`;
}

// Spend shows the period holding this date. A date in the current period is stored as
// null ("today"), so an app left open overnight moves on to the new week by itself.
const anchorDate = () => ui.anchor || S.today();
function setAnchor(date) {
  const d = validDateOr(date);
  const r = periodRange(ui.period, d);
  const t = S.today();
  ui.anchor = t >= r.from && t < r.to ? null : d;
}

const tripsBetween = (from, to) => state.purchases.filter((p) => p.date >= from && p.date < to);
const spentBetween = (from, to) => sum(tripsBetween(from, to), (p) => p.total);

// The weekly budget from Settings (0 = none); months and years scale it.
const weeklyBudget = () => Math.max(0, S.num(state.settings.budget));
const budgetFor = (period) => weeklyBudget() * ({ week: 1, month: 52 / 12, year: 52 }[period] || 1);

// Days until an item's use-by date, or null when it has none or is used up.
function soonDays(i) {
  if (!(i.qty > 0)) return null;
  return S.daysUntil(i.expires);
}
const isSoon = (i) => { const d = soonDays(i); return d !== null && d <= 7; };

// ---------- Home ----------

const emptyPantry = () => `<div class="card empty">
    <h2>Your pantry is empty</h2>
    <p>Add what you have on hand, or scan your next grocery receipt and Grocer fills it in for you.</p>
    <div class="btn-row">
      <button class="btn primary" data-act="add-item">Add an item</button>
      <button class="btn soft" data-act="goto" data-tab="scan">Scan a receipt</button>
      <button class="btn" data-act="demo">Load demo data</button>
    </div>
  </div>`;

function viewHome() {
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const dateLine = `${now.toLocaleDateString(undefined, { weekday: 'long' })} ${now.getDate()} ${now.toLocaleDateString(undefined, { month: 'long' })}`;
  const head = `<div class="page-head">
      <div class="head-text"><span class="eyebrow">${esc(dateLine)}</span><h1 class="title">${greeting}</h1></div>
      <button class="round-btn" id="open-settings" aria-label="Settings">${ICON.gear}</button>
    </div>`;
  const search = `<button class="searchbar" data-act="search-pantry">${ICON.search}<span>Search pantry</span></button>`;

  // This week's spending against the weekly budget.
  const week = periodRange('week', S.today());
  const spent = spentBetween(week.from, week.to);
  const budget = weeklyBudget();
  const daysLeft = 6 - ((now.getDay() + 6) % 7);
  let sub = '';
  let bar = '';
  let note;
  if (budget > 0) {
    const left = budget - spent;
    sub = `<span>of ${moneyWhole(budget)} budget</span>`;
    bar = `<div class="hero-bar${left < 0 ? ' over' : ''}"><i style="width:${Math.max(0, Math.min(100, spent / budget * 100)).toFixed(1)}%"></i></div>`;
    const togo = daysLeft === 0 ? 'on the last day of the week' : `with ${daysLeft} day${daysLeft === 1 ? '' : 's'} to go`;
    note = left >= 0 ? `${money(left)} left ${togo}.` : `${money(-left)} over budget this week.`;
  } else {
    const trips = tripsBetween(week.from, week.to).length;
    sub = `<span>${trips} trip${trips === 1 ? '' : 's'}</span>`;
    note = '<button class="link" data-act="set-budget">Set a weekly budget</button> to see what is left.';
  }
  const hero = `<div class="hero">
      <div class="hero-top"><span class="hero-label">Groceries this week</span><button class="link" data-act="week-details">Details</button></div>
      <div class="hero-amount"><b class="money">${money(spent)}</b>${sub}</div>
      ${bar}
      <span class="hero-note">${note}</span>
    </div>`;

  // No pantry yet: the week card still shows once there is spending or a budget to show.
  if (!state.items.length) return head + (state.purchases.length || budget > 0 ? hero : '') + emptyPantry();

  // Use soon: anything on hand with a use-by date in the next week.
  const soon = state.items.filter(isSoon).sort((a, b) => soonDays(a) - soonDays(b));
  const dueLabel = (d) => (d < 0 ? 'Expired' : d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : `${d} days`);
  const soonHtml = soon.length ? `<div class="group">
      <div class="section-head"><h2>Use soon</h2><button class="link" data-act="soon-pantry">See all</button></div>
      <div class="soon-strip">${soon.slice(0, 12).map((i) => {
    const d = soonDays(i);
    return `<button class="soon-tile${d <= 1 ? ' urgent' : ''}" data-act="edit-item" data-id="${esc(i.id)}">
          <span class="initial" aria-hidden="true">${esc((i.name.match(/[A-Za-z0-9]/) || ['?'])[0].toUpperCase())}</span>
          <span class="t-name">${esc(i.name)}</span><span class="t-due">${dueLabel(d)}</span></button>`;
  }).join('')}</div>
    </div>` : '';

  // Running low: everything at or under its alert level (these are already on the list).
  const low = state.items.filter((i) => S.statusOf(i) !== 'ok')
    .sort((a, b) => (S.statusOf(a) === 'out' ? 0 : 1) - (S.statusOf(b) === 'out' ? 0 : 1) || a.name.localeCompare(b.name));
  const shown = low.slice(0, 8);
  const lowHtml = `<div class="card low-card">
      <div class="head-text"><h2>Running low</h2><span class="sub">At or below the alert level you set</span></div>
      ${low.length ? `<div class="chips">${shown.map((i) => `<span class="chip static">${esc(i.name)}<span class="chip-note">${S.statusOf(i) === 'out' ? 'out' : `${fq(i.qty)} ${esc(i.unit)} left`}</span></span>`).join('')}${low.length > shown.length ? `<span class="chip static">+${low.length - shown.length} more</span>` : ''}</div>
      <button class="btn soft block" data-act="goto" data-tab="list">Open shopping list (${low.length})</button>`
    : '<p class="small muted" style="margin:0">Nothing running low. Items land here, and on the shopping list, when they reach their alert level.</p>'}
    </div>`;

  return head + search + hero + soonHtml + lowHtml;
}

// ---------- Pantry ----------

function viewPantry() {
  const head = `<div class="page-head">
      <div class="head-text"><h1 class="title">Pantry</h1><span class="sub" id="pantry-sub">${pantrySub()}</span></div>
      <button class="round-btn solid" data-act="add-item" aria-label="Add item">${ICON.plus}</button>
    </div>`;
  if (!state.items.length) return head + emptyPantry();
  return `${head}
    <label class="searchbar">${ICON.search}<span class="sr-only">Search pantry</span>
      <input type="search" id="search" placeholder="Search pantry" value="${esc(ui.search)}" autocomplete="off"></label>
    <div class="seg" role="group" aria-label="Stored in">
      ${['All', ...LOCATIONS].map((l) => `<button data-act="loc" data-loc="${l}" aria-pressed="${ui.loc === l}">${l}</button>`).join('')}
    </div>
    ${pantryChips()}
    <div id="pantry-list" class="group-list">${pantryList()}</div>`;
}

function pantrySub() {
  const count = state.items.length;
  const worth = sum(state.items, (i) => (i.lastPrice ? i.lastPrice * i.qty : 0));
  return `${count} item${count === 1 ? '' : 's'}${worth > 0 ? `, about ${moneyWhole(worth)} on the shelves` : ''}`;
}

// Filter chips; each stays while it is switched on, even at 0, so it can be switched off.
function pantryChips() {
  const expiring = state.items.filter(isSoon).length;
  const low = state.items.filter((i) => S.statusOf(i) !== 'ok').length;
  const chips = [
    expiring || ui.soonOnly ? `<button class="chip warn" data-act="soon-only" aria-pressed="${ui.soonOnly}">${expiring} to use soon</button>` : '',
    low || ui.lowOnly ? `<button class="chip" data-act="low-only" aria-pressed="${ui.lowOnly}">${low} running low</button>` : '',
  ].join('');
  return `<div class="chips" id="pantry-chips"${chips ? '' : ' hidden'}>${chips}</div>`;
}

// Search text: "Hunt's Pork & Beans" is found by "hunts pork and beans", "pork beans" or "hunt".
const searchable = (s) => String(s || '').toLowerCase().replace(/['’`]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();

function pantryList() {
  const q = searchable(ui.search).split(' ').filter((w) => w && w !== 'and');
  const hit = (i) => { const t = searchable(`${i.name} ${i.notes || ''}`); return q.every((w) => t.includes(w)); };
  const items = state.items.filter((i) =>
    (ui.loc === 'All' || i.location === ui.loc)
    && (!q.length || hit(i))
    && (!ui.lowOnly || S.statusOf(i) !== 'ok')
    && (!ui.soonOnly || isSoon(i)));
  if (!items.length) return '<p class="empty">No items match.</p>';
  const groups = CATEGORIES.map((c) => [c, items.filter((i) => i.category === c).sort((a, b) => a.name.localeCompare(b.name))])
    .filter(([, list]) => list.length);
  return groups.map(([c, list]) => `<div class="group">
      <div class="group-head"><h3>${esc(c)}</h3><span>${list.length}</span></div>
      <div class="rows">${list.map(itemRow).join('')}</div>
    </div>`).join('');
}

// The coloured word on a pantry card: what needs attention first.
function itemTag(i) {
  const st = S.statusOf(i);
  const d = S.daysUntil(i.expires);
  if (st === 'out') return ['Out', 'out', 'red'];
  if (d !== null && d < 0) return ['Expired', 'red', 'red', true];
  if (d === 0) return ['Use today', 'red', 'red', true];
  if (d === 1) return ['Tomorrow', 'red', 'red', true];
  if (d !== null && d <= 7) return [`${d} days`, 'exp', 'amber', true];
  if (st === 'low') return ['Low', 'low', 'amber'];
  if (d !== null) return [d < 60 ? `${d} days` : `${Math.round(d / 30)} months`, 'ok', 'green', d < 60];
  return [i.qty >= i.par ? 'Plenty' : 'In stock', 'ok', 'green'];
}

function itemRow(i) {
  const [label, cls, tone, saysDays] = itemTag(i);
  const full = Math.max(i.par, i.low, S.stepOf(i.unit));
  const pct = i.qty > 0 ? Math.max(4, Math.min(100, Math.round(i.qty / full * 100))) : 0;
  const meta = [esc(i.location)];
  if (i.lastPrice) meta.push(`<span class="money">${money(i.lastPrice)}/${esc(i.unit)}</span>`);
  if (i.expires && !saysDays) meta.push(`use by ${esc(shortDate(i.expires))}`); // the tag already counts the days
  return `<div class="row">
    <div class="row-main" role="button" tabindex="0" data-act="edit-item" data-id="${esc(i.id)}">
      <div class="row-top"><span class="row-name">${esc(i.name)}</span><span class="pill ${cls}">${label}</span></div>
      <div class="meter thin ${tone}"><i style="width:${pct}%"></i></div>
      <div class="row-sub plain">${meta.join(' · ')}</div>
    </div>
    <div class="qty">
      <button data-act="dec" data-id="${esc(i.id)}" aria-label="Use some ${esc(i.name)}">&minus;</button>
      <div class="qty-val">${fq(i.qty)}<small>${esc(i.unit)}</small></div>
      <button data-act="inc" data-id="${esc(i.id)}" aria-label="Add some ${esc(i.name)}">+</button>
    </div>
  </div>`;
}

// Redraw the cards (and the counts above them) without touching the search box,
// so typing keeps focus and +/- keeps the scroll position.
function refreshPantryList() {
  const el = document.getElementById('pantry-list');
  if (el) el.innerHTML = pantryList();
  const sub = document.getElementById('pantry-sub');
  if (sub) sub.textContent = pantrySub();
  const chips = document.getElementById('pantry-chips');
  if (chips) chips.outerHTML = pantryChips();
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

// Price change between the last two prices paid, as a fraction (0.21 = up 21%), or 0.
function lastPriceChange(i) {
  const h = i.priceHistory || [];
  if (h.length < 2 || !(h[h.length - 2].price > 0)) return 0;
  return h[h.length - 1].price / h[h.length - 2].price - 1;
}

function viewList() {
  const entries = listEntries();
  const extras = state.extras;
  const total = entries.length + extras.length;
  const ticked = entries.filter((e) => state.checked[e.key]).length + extras.filter((x) => state.checked['extra:' + x.id]).length;

  const head = `<div class="page-head">
      <div class="head-text"><h1 class="title">Shopping list</h1><span class="sub">${total ? 'Grouped by aisle' : 'Nothing to buy yet'}</span></div>
      ${total ? `<button class="round-btn" data-act="copy-list" aria-label="Copy list">${ICON.copy}</button>` : ''}
    </div>`;

  const entryRow = (e) => {
    const on = !!state.checked[e.key];
    const rise = lastPriceChange(e.item);
    const note = [S.statusOf(e.item) === 'out' ? 'Out of stock' : 'Running low', `buy ${fq(e.need)} ${esc(e.item.unit)}`];
    if (rise >= 0.01) note.push(`price up ${Math.round(rise * 100)}%`);
    return `<label class="row${on ? ' done' : ''}">
      <input type="checkbox" class="check" data-act="tick" data-key="${esc(e.key)}"${on ? ' checked' : ''}>
      <span class="row-main"><span class="row-name">${esc(e.item.name)}</span><span class="note">${note.join(' · ')}</span></span>
      <span class="price money">${e.est !== null ? money(e.est) : ''}</span>
    </label>`;
  };
  const extraRow = (x) => {
    const on = !!state.checked['extra:' + x.id];
    return `<div class="row${on ? ' done' : ''}">
      <input type="checkbox" class="check" data-act="tick" data-key="extra:${esc(x.id)}" aria-label="Got ${esc(x.name)}"${on ? ' checked' : ''}>
      <span class="row-main" role="button" tabindex="0" data-act="edit-extra" data-id="${esc(x.id)}" aria-label="Edit ${esc(x.name)}"><span class="row-name">${esc(x.name)}</span>${x.note ? `<span class="note">${esc(x.note)}</span>` : ''}</span>
      <button class="icon-btn" data-act="remove-extra" data-id="${esc(x.id)}" aria-label="Remove ${esc(x.name)}">&times;</button>
    </div>`;
  };
  const aisles = aisleGroups(entries)
    .map(([c, list]) => `<div class="group"><h3>${esc(c)}</h3><div class="list-rows">${list.map(entryRow).join('')}</div></div>`);
  if (extras.length) aisles.push(`<div class="group"><h3>Extras</h3><div class="list-rows">${extras.map(extraRow).join('')}</div></div>`);

  const addForm = `<form id="extra-form" class="addbar">
      <label class="sr-only" for="extra-name">Add an item</label>
      <input type="text" id="extra-name" name="name" placeholder="Add item, e.g. 2 lemons" autocomplete="off" enterkeyhint="done">
      <button type="submit" aria-label="Add to list">${ICON.plus}</button>
    </form>`;

  if (!total) {
    return `${head}${cartPanel()}
      <div class="card"><b>Nothing to buy.</b> <span class="muted">Items show up here by themselves when they run low in the pantry. Add one-offs below.</span></div>
      ${addForm}`;
  }

  // A cart in progress sits on top; an empty one waits under the list so it doesn't push the list down.
  const busy = state.cart.lines.length > 0;
  return `${head}${listProgress()}${busy ? cartPanel() : ''}${addForm}
    <div class="aisles">${aisles.join('')}</div>
    <button class="btn block" data-act="restock"${ticked ? '' : ' disabled'}>Restock ticked (${ticked})</button>
    ${busy ? '' : cartPanel()}
    <p class="small muted">Tick things off in the store. Then scan the receipt to restock and log the cost in one go, or use "Restock ticked" if you have no receipt.</p>`;
}

// Aisles follow the pantry categories in order (store-walk order), names A-Z within each.
function aisleGroups(entries) {
  return CATEGORIES.map((c) => [c, entries.filter((e) => e.item.category === c).sort((a, b) => a.item.name.localeCompare(b.item.name))])
    .filter(([, list]) => list.length);
}

function openExtraModal(x) {
  openModal(`<h2>Edit list item</h2>
    <div class="stack">
      <label class="field">Item<input type="text" name="name" value="${esc(x.name)}" required autocomplete="off"></label>
      <label class="field">Note<input type="text" name="note" value="${esc(x.note)}" placeholder="How much, which brand, what for" autocomplete="off"></label>
    </div>
    <div class="btn-row"><button class="btn primary" type="submit">Save</button><button class="btn" type="button" data-close>Cancel</button></div>`, (fd) => {
    const name = String(fd.get('name') || '').trim().slice(0, 120);
    if (!name) { toast('Give the item a name'); return false; }
    Object.assign(x, { name, note: String(fd.get('note') || '').trim().slice(0, 120) });
    commit();
    render();
  });
}

// The card at the top of the list: how much is ticked, the estimate, and the budget.
function listProgress() {
  const entries = listEntries();
  const extras = state.extras;
  const total = entries.length + extras.length;
  const doneEntries = entries.filter((e) => state.checked[e.key]);
  const done = doneEntries.length + extras.filter((x) => state.checked['extra:' + x.id]).length;
  const est = sum(entries, (e) => e.est);
  const inTrolley = sum(doneEntries, (e) => e.est);
  const unpriced = entries.filter((e) => e.est === null).length + extras.length;
  let line = '';
  const budget = weeklyBudget();
  if (budget > 0 && est > 0) {
    const week = periodRange('week', S.today());
    const diff = budget - spentBetween(week.from, week.to) - est;
    line = diff >= 0
      ? `<span class="budget-line">About ${money(diff)} under what is left of this week's budget</span>`
      : `<span class="budget-line over">About ${money(-diff)} over what is left of this week's budget</span>`;
  }
  return `<div class="card progress-card" id="list-progress">
      <div class="progress-top"><span>${done} of ${total} in the trolley${inTrolley > 0 ? ` · ${money(inTrolley)}` : ''}</span><b class="money">${money(est)}</b></div>
      <div class="meter"><i style="width:${total ? Math.round(done / total * 100) : 0}%"></i></div>
      ${line}${unpriced ? `<span class="hint" style="margin:0">Estimate from last prices paid; ${unpriced} item${unpriced === 1 ? ' has' : 's have'} no price yet.</span>` : ''}
    </div>`;
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
  const lines = aisleGroups(listEntries()).flatMap(([, list]) => list).map((e) => `- ${e.item.name}: ${fq(e.need)} ${e.item.unit}`)
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
  const buttons = (snapPrimary) => `<div class="btn-row">
      <button class="btn small-btn${snapPrimary ? ' primary' : ' soft'}" data-act="cart-photo" data-camera="1">Snap item + price</button>
      <button class="btn small-btn soft" data-act="cart-photo">Choose photo</button>
      <button class="btn small-btn soft" data-act="cart-add">Add by hand</button>
    </div>`;
  if (!c.lines.length) {
    return `<div class="card cart" id="cart" data-busy="0">
      <div class="head-text"><h2>Cart</h2>
      <span class="sub">Shopping now? Snap each item with its shelf price as it goes in the trolley for a running total. Check out to save the trip.</span></div>
      ${buttons(true)}</div>`;
  }
  const count = sum(c.lines, (l) => l.qty);
  return `<div class="card cart" id="cart" data-busy="1">
    <div class="cart-head"><h2>Cart</h2><b class="money cart-total">${money(cartTotal())}</b></div>
    <label class="field">Store<input type="text" data-cart="store" value="${esc(c.store)}" placeholder="Which store?" autocomplete="off"></label>
    <div class="rows flat">${c.lines.map((l) => `<div class="row">
      <div class="row-main" role="button" tabindex="0" data-act="cart-edit" data-id="${esc(l.id)}">
        <div class="row-name">${esc(l.name)}</div>
        <div class="row-sub"><span class="money">${money(l.price)}</span>${l.qty > 1 ? `<span>x ${l.qty} = <span class="money">${money(l.price * l.qty)}</span></span>` : ''}</div>
      </div>
      <div class="qty">
        <button data-act="cart-dec" data-id="${esc(l.id)}" aria-label="One less ${esc(l.name)}">&minus;</button>
        <div class="qty-val">${l.qty}</div>
        <button data-act="cart-inc" data-id="${esc(l.id)}" aria-label="One more ${esc(l.name)}">+</button>
      </div></div>`).join('')}</div>
    ${buttons(false)}
    <button class="btn primary block" data-act="cart-checkout">Check out ${money(cartTotal())} (${count} item${count === 1 ? '' : 's'})</button>
    <button class="btn small-btn danger" data-act="cart-clear" style="align-self:flex-start">Empty cart</button>
  </div>`;
}

// The cart is part of the List tab; redraw just it, so the list's ticks and the
// half-typed "add something else" box stay as they are.
function refreshCart() {
  const el = document.getElementById('cart');
  // The cart moves to the top of the list once it has something in it: redraw the tab then.
  if (el && (el.dataset.busy === '1') === state.cart.lines.length > 0) el.outerHTML = cartPanel();
  else render();
  refreshListProgress();
  updateBadge();
}

// After a tick: the progress card and the restock button, nothing else (keeps typing intact).
function refreshListProgress() {
  const card = document.getElementById('list-progress');
  if (card) card.outerHTML = listProgress();
  const n = view.querySelectorAll('[data-act="tick"]:checked').length;
  const btn = view.querySelector('[data-act="restock"]');
  if (btn) { btn.textContent = `Restock ticked (${n})`; btn.disabled = n === 0; }
}

function pickCartPhoto(camera) {
  if (ui.scan?.phase === 'loading') { toast('Wait for the receipt being read on the Scan tab'); return; }
  if (!readerReady()) {
    toast({ local: 'Set the Qwen server address first', gemini: 'Add your Gemini API key first' }[state.settings.provider] || 'Add your Anthropic API key first');
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
      if (box) { box.checked = true; box.closest('.row').classList.add('done'); refreshListProgress(); }
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
  setAnchor(date);
  commit();
  render();
  toast(`Checked out ${money(total)} at ${store}: ${lines.length} item${lines.length === 1 ? '' : 's'} in the pantry${added ? `, ${added} new` : ''}`);
}

// ---------- Scan ----------

// Idle Scan tab: a dark "viewfinder" with the modes on top and the actions for the
// chosen mode in a sheet below. The camera itself opens from the buttons (photo
// picker, or the live barcode scanner dialog).
function viewScan() {
  if (ui.scan) return scanPanel();
  const p = state.settings.provider;
  // Photographing loose groceries needs an AI reader; on-device reading does receipts and barcodes.
  const modes = p === 'device'
    ? [['receipt', 'Receipt'], ['barcode', 'Barcode']]
    : [['receipt', 'Receipt'], ['photo', 'Groceries'], ['barcode', 'Barcode']];
  const mode = modes.some(([k]) => k === ui.scanMode) ? ui.scanMode : 'receipt';
  const hint = {
    receipt: 'Lay the receipt flat in good light',
    photo: 'Fit the groceries in one photo',
    barcode: 'Line up the barcode inside the frame',
  }[mode];

  let notice = '';
  if (p === 'local') notice = `<div class="notice">Reading photos with Qwen on this PC (${esc(state.settings.localUrl)}). Start <b>start-qwen</b> first. <a href="#" data-act="settings">Change</a></div>`;
  else if (p === 'anthropic' && !readerReady()) notice = '<div class="notice">Claude needs an Anthropic API key, or switch to reading on this phone. <a href="#" data-act="settings">Open Settings</a>.</div>';
  else if (p === 'gemini' && !readerReady()) notice = '<div class="notice">Gemini needs a Gemini API key, or switch to reading on this phone. <a href="#" data-act="settings">Open Settings</a>.</div>';

  const photoButtons = (kind) => `<div class="btn-grid">
      <button class="btn primary" data-act="pick" data-kind="${kind}" data-camera="1">Take photo</button>
      <button class="btn soft" data-act="pick" data-kind="${kind}">Choose photos</button>
    </div>`;
  const body = {
    receipt: `<div class="head-text"><h2>Scan a receipt</h2></div>
      <p class="small muted">${p === 'device'
    ? 'Grocer reads the text right here on your phone, restocks the pantry and logs what you spent. Fix a line once and it remembers it next time. Long receipt? Photograph it in overlapping parts and choose them together.'
    : 'Grocer reads each line, restocks the pantry and logs what you spent. Long receipt? Photograph it in parts and choose all the photos together.'}</p>
      ${photoButtons('receipt')}`,
    photo: `<div class="head-text"><h2>Photograph groceries</h2></div>
      <p class="small muted">Items on the bench, in the fridge or on a shelf. Grocer names each one and adds it to the pantry, or counts what you have on hand.</p>
      ${photoButtons('items')}`,
    barcode: `<div class="head-text"><h2>Scan barcodes</h2></div>
      <p class="small muted">Scan items one after another. Grocer looks each up in Open Food Facts, a free product database, and remembers it for next time.</p>
      <button class="btn primary block" data-act="barcodes">Scan barcodes</button>`,
  }[mode];
  const footer = {
    device: 'Receipts are read on this device and barcodes are looked up in Open Food Facts. No AI service is used.',
    local: 'Photos are read by Qwen running on your own PC: free and private, but only from this computer.',
    anthropic: "Photos are read by Anthropic's Claude using your own API key, about a few cents per scan. Nothing is kept on any server.",
    gemini: "Photos are read by Google's Gemini using your own API key: about a cent or less per scan, or free within Google's free allowance.",
  }[p] || '';

  return `<div class="scanner">
      <div class="scan-stage">
        <div class="scan-top">
          <button class="glass-btn" data-act="goto" data-tab="home" aria-label="Close scanner">${ICON.close}</button>
          <h1>Scan</h1>
          <button class="glass-btn" id="open-settings" aria-label="Settings">${ICON.gear}</button>
        </div>
        <div class="mode-tabs" role="tablist" aria-label="What to scan">
          ${modes.map(([k, label]) => `<button role="tab" data-act="scan-mode" data-mode="${k}" aria-selected="${k === mode}">${label}</button>`).join('')}
        </div>
        <div class="frame ${mode}" aria-hidden="true"><i></i><i></i><i></i><i></i><div class="beam"></div><span class="frame-hint">${hint}</span></div>
      </div>
      <div class="scan-sheet">
        <div class="grab" aria-hidden="true"></div>
        ${notice}${body}
        <p class="scan-foot">${footer}</p>
      </div>
    </div>`;
}

function readerReady() {
  const p = state.settings.provider;
  if (p === 'local') return !!state.settings.localUrl;
  if (p === 'anthropic') return !!state.settings.apiKey;
  if (p === 'gemini') return !!state.settings.geminiKey;
  return true;
}

function pickPhotos(kind, camera) {
  if (!readerReady()) {
    toast({ local: 'Set the Qwen server address first', gemini: 'Add your Gemini API key first' }[state.settings.provider] || 'Add your Anthropic API key first');
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
    return `<h1 class="title">Reading your ${noun}</h1>${thumbs}
      <div class="loading"><div class="spinner"></div><span id="scan-progress">${state.settings.provider === 'device' && s.kind === 'receipt'
    ? 'Getting the text reader ready (a one-off download the first time)...'
    : 'This usually takes 10 to 40 seconds.'}</span></div>
      <button class="btn" data-act="scan-cancel" style="align-self:flex-start">Cancel</button>`;
  }
  if (s.phase === 'error') {
    return `<h1 class="title">Couldn't read that</h1>${thumbs}
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
  return `<h1 class="title">Check the receipt</h1>
    ${already ? `<div class="notice"><b>This receipt looks already saved</b>: ${esc(already.store)}, ${esc(already.date)}, ${money(already.total)}. Saving it again would count the shopping twice; discard unless it really is a second trip.</div>` : ''}
    ${cartTrip ? `<div class="notice"><b>You checked out a cart</b> at ${esc(cartTrip.store)} on ${esc(cartTrip.date)} (${money(cartTrip.total)}). If this receipt is the same trip, saving it would count the shopping twice.</div>` : ''}
    <p class="muted">Fix anything misread and untick lines that shouldn't go in the pantry (they still count toward the total). Names you change are remembered for next time.</p>
    ${thumbs}
    <div class="card"><div class="grid3">
      <label class="field">Store<input type="text" data-head="store" value="${esc(d.store)}" autocomplete="off"></label>
      <label class="field">Date<input type="date" data-head="date" value="${esc(d.date)}" max="${S.today()}"></label>
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
  return `<h1 class="title">Check the groceries</h1>
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
    setAnchor(date);
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

// "Week of 9 Nov", "November 2026", "2026" (+ ", so far" while it is still running).
function periodLabel(period, from, current) {
  const d = parseYmd(from);
  const label = period === 'week' ? `Week of ${shortDate(from)}`
    : period === 'month' ? d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
      : String(d.getFullYear());
  return current ? `${label}, so far` : label;
}

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

// Every item whose last two prices differ by 1% or more, biggest move first.
function priceMoves() {
  return state.items
    .filter((i) => (i.priceHistory || []).length >= 2)
    .map((i) => {
      const h = i.priceHistory;
      return { item: i, prev: h[h.length - 2], last: h[h.length - 1], change: lastPriceChange(i) };
    })
    .filter((x) => Math.abs(x.change) >= 0.01)
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
}

const pctChange = (c) => `${c > 0 ? '+' : '−'}${Math.round(Math.abs(c) * 100)}%`;

function bars(rows) {
  const max = Math.max(...rows.map(([, v]) => Math.abs(v)), 1);
  return `<div class="bars">${rows.map(([k, v]) => `<div class="bar-row">
      <div class="bar-label"><span>${esc(k)}</span><span class="money">${money(v)}</span></div>
      <div class="bar-track"><div class="bar-fill${v < 0 ? ' neg' : ''}" style="width:${Math.max(2, Math.abs(v) / max * 100).toFixed(1)}%"></div></div>
    </div>`).join('')}</div>`;
}

// Columns for the last 6 weeks / 6 months / 5 years up to the one shown, with the
// budget as a dashed line. Tap a column to look at that period.
function spendChart(period, from) {
  const n = period === 'year' ? 5 : 6;
  const budget = budgetFor(period);
  const cols = [];
  for (let k = n - 1; k >= 0; k--) {
    const start = shiftPeriod(period, from, -k);
    const r = periodRange(period, start);
    cols.push({ start, total: spentBetween(r.from, r.to) });
  }
  const max = Math.max(...cols.map((c) => c.total), budget, 1) * 1.08;
  const H = 100;
  const label = (c, i) => {
    const d = parseYmd(c.start);
    if (period === 'year') return String(d.getFullYear());
    if (period === 'month') return d.toLocaleDateString(undefined, { month: 'short' });
    const prev = i > 0 ? parseYmd(cols[i - 1].start) : null;
    return !prev || prev.getMonth() !== d.getMonth() ? shortDate(c.start) : String(d.getDate());
  };
  return `<div class="chart">
      <div class="chart-plot" style="height:${H}px">
        ${cols.map((c) => `<button class="chart-col${c.start === from ? ' current' : ''}${budget > 0 && c.total > budget && c.start !== from ? ' over' : ''}" data-act="period-jump" data-date="${c.start}" aria-label="${esc(periodLabel(period, c.start, false))}: ${esc(money(c.total))}"><span class="bar" style="height:${c.total > 0 ? Math.max(2, Math.round(c.total / max * H)) : 0}px"></span></button>`).join('')}
        ${budget > 0 ? `<div class="chart-budget" style="bottom:${Math.round(budget / max * H)}px"><span>${esc(moneyWhole(budget))} budget</span></div>` : ''}
      </div>
      <div class="chart-labels" aria-hidden="true">${cols.map((c, i) => `<span${c.start === from ? ' class="current"' : ''}>${esc(label(c, i))}</span>`).join('')}</div>
    </div>`;
}

function viewSpend() {
  const period = ui.period;
  const { from, to } = periodRange(period, anchorDate());
  const today = S.today();
  const current = today >= from && today < to;
  const list = tripsBetween(from, to).sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));
  const total = sum(list, (p) => p.total);

  // Compare with the period before; while this one is still running, only up to the same day.
  const prevFrom = shiftPeriod(period, from, -1);
  const sameDay = addDays(prevFrom, daysBetween(from, today) + 1);
  const prevTo = current && sameDay < from ? sameDay : from;
  const prevTotal = spentBetween(prevFrom, prevTo);
  const before = current ? `last ${period} at this point` : `the ${period} before`;
  let delta = '';
  if (prevTotal > 0) {
    const diff = total - prevTotal;
    delta = Math.abs(diff) < 0.005 ? `Same as ${before}` : `${money(Math.abs(diff))} ${diff < 0 ? 'less' : 'more'} than ${before}`;
  } else if (total > 0) {
    delta = `Nothing logged ${current ? `by this point last ${period}` : `the ${period} before`}`;
  }
  const up = prevTotal > 0 && total - prevTotal >= 0.005;

  const head = `<div class="page-head">
      <h1 class="title">Spend</h1>
      <div class="seg compact" role="group" aria-label="Period">
        ${['week', 'month', 'year'].map((p) => `<button data-act="period" data-period="${p}" aria-pressed="${p === period}">${p[0].toUpperCase() + p.slice(1)}</button>`).join('')}
      </div>
    </div>`;
  const headCard = `<div class="card head-card">
      <div class="period-nav">
        <div class="head-text"><span class="sub">${esc(periodLabel(period, from, current))}</span>
          <span class="big">${money(total)}</span>${delta ? `<span class="delta${up ? ' up' : ''}">${delta}</span>` : ''}</div>
        <div class="steps">
          <button class="round-btn" data-act="period-step" data-delta="-1" aria-label="Previous ${period}">&lsaquo;</button>
          <button class="round-btn" data-act="period-step" data-delta="1" aria-label="Next ${period}"${shiftPeriod(period, from, 1) > today ? ' disabled' : ''}>&rsaquo;</button>
        </div>
      </div>
      ${spendChart(period, from)}
      <span class="sub">${list.length} trip${list.length === 1 ? '' : 's'}${list.length ? ` · average ${money(total / list.length)}` : ''}</span>
    </div>`;

  const stores = {};
  for (const p of list) stores[p.store] = (stores[p.store] || 0) + p.total;
  const where = list.length ? `<div class="card col"><h2>Where it went</h2>${bars(byCategory(list))}</div>` : '';
  const byStore = Object.keys(stores).length > 1 ? `<div class="card col"><h2>By store</h2>${bars(Object.entries(stores).sort((a, b) => b[1] - a[1]))}</div>` : '';

  const moves = priceMoves();
  const ups = moves.filter((m) => m.change > 0);
  const downs = moves.filter((m) => m.change < 0);
  const tiles = moves.length ? `<div class="tiles">
      <div class="tile red"><span class="t-label">Prices up</span><span class="t-value">${ups.length}</span>
        <span class="t-note">${ups.length ? `Most: ${esc(ups[0].item.name)} ${pctChange(ups[0].change)}` : 'Nothing dearer lately'}</span></div>
      <div class="tile green"><span class="t-label">Prices down</span><span class="t-value">${downs.length}</span>
        <span class="t-note">${downs.length ? `Most: ${esc(downs[0].item.name)} ${pctChange(downs[0].change)}` : 'Nothing cheaper lately'}</span></div>
    </div>` : '';
  const watch = moves.length ? `<div class="card col"><h2>Price watch</h2>
      <div class="rows flat bare">${moves.slice(0, 6).map((w) => `<div class="row">
        <div class="row-main" role="button" tabindex="0" data-act="edit-item" data-id="${esc(w.item.id)}"><span class="row-name">${esc(w.item.name)}</span>
          <span class="row-sub plain">Was <span class="money">${money(w.prev.price)}</span>/${esc(w.item.unit)}${S.validDate(w.prev.date) ? ` on ${esc(shortDate(w.prev.date))}` : ''}, now <span class="money">${money(w.last.price)}</span></span></div>
        <span class="chg ${w.change > 0 ? 'up' : 'down'}">${pctChange(w.change)}</span></div>`).join('')}</div>
    </div>` : '';

  const trips = `<div class="group">
      <div class="group-head"><h3>Trips</h3><span>${list.length || ''}</span></div>
      ${list.length ? `<div class="rows flat">${list.map((p) => `<div class="row">
        <div class="row-main" role="button" tabindex="0" data-act="purchase" data-id="${esc(p.id)}">
          <div class="row-name">${esc(p.store)}</div>
          <div class="row-sub"><span>${esc(p.date)}</span><span>· ${p.lines?.length ? `${p.lines.length} lines` : esc(p.category || 'Manual')}</span>${p.source === 'receipt' ? '<span>· receipt</span>' : p.source === 'cart' ? '<span>· cart</span>' : ''}</div>
        </div><b class="money">${money(p.total)}</b></div>`).join('')}</div>` : `<p class="small muted" style="margin:0">No trips logged in this ${period}. Scan a receipt, or add one by hand.</p>`}
    </div>`;

  return `${head}${headCard}${where}${tiles}${watch}${byStore}${trips}
    <div class="btn-grid">
      <button class="btn primary" data-act="goto" data-tab="scan">Scan a receipt</button>
      <button class="btn soft" data-act="add-purchase">Add a trip by hand</button>
    </div>`;
}

function openPurchase(p) {
  openModal(`<h2>${esc(p.store)}</h2>
    <p class="muted">${esc(p.date)} · ${{ receipt: 'from receipt', cart: 'checked out from the cart' }[p.source] || 'entered by hand'}</p>
    ${p.lines?.length ? `<div class="rows flat">${p.lines.map((l) => `<div class="row"><div class="row-main" style="cursor:default">
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
        <label class="field">Date<input type="date" name="date" value="${S.today()}" max="${S.today()}" required></label>
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
    setAnchor(date);
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
    ['gemini', 'Gemini (Google) - fast, a cent or less a scan'],
    ['local', 'Qwen on this PC - free, only on the PC running it']]
    .map(([v, label]) => `<option value="${v}"${st.provider === v ? ' selected' : ''}>${label}</option>`).join('')}
        </select></label>
      <label class="field">Anthropic API key
        <input type="password" name="apiKey" value="${esc(st.apiKey)}" placeholder="sk-ant-..." autocomplete="off" spellcheck="false">
        <div class="hint">For Claude. Stored on this device only and sent straight to Anthropic. Get one at console.anthropic.com.</div></label>
      <label class="field">Gemini API key
        <input type="password" name="geminiKey" value="${esc(st.geminiKey)}" placeholder="AIza... or AQ...." autocomplete="off" spellcheck="false">
        <div class="hint">For Gemini. Stored on this device only and sent straight to Google. Get one at aistudio.google.com.</div></label>
      <label class="field">Qwen server address
        <input type="text" name="localUrl" value="${esc(st.localUrl)}" placeholder="http://127.0.0.1:8080" autocomplete="off" spellcheck="false">
        <div class="hint">For Qwen: the llama.cpp server started by start-qwen (needs its vision file).</div></label>
      <div class="grid2">
        <label class="field">Currency<select name="currency">${options(CURRENCIES, st.currency)}</select></label>
        <label class="field">Weekly budget<input type="number" name="budget" min="0" step="any" inputmode="decimal" value="${weeklyBudget() || ''}" placeholder="None"></label>
      </div>
      <div class="hint" style="margin-top:4px">The budget is for groceries per week (Monday to Sunday). Home, the list and Spend measure against it; months and years scale it up. Leave it empty for no budget.</div>
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
    state.settings.geminiKey = String(fd.get('geminiKey') || '').trim();
    state.settings.provider = ['device', 'anthropic', 'gemini', 'local'].includes(fd.get('provider')) ? fd.get('provider') : 'device';
    state.settings.localUrl = String(fd.get('localUrl') || '').trim() || 'http://127.0.0.1:8080';
    state.settings.currency = fd.get('currency');
    state.settings.budget = Math.max(0, S.round(S.num(fd.get('budget')), 2));
    commit();
    render();
    toast('Settings saved');
  });
}

function exportBackup() {
  const { settings, ...data } = state;
  const payload = { app: 'grocer', version: 1, exportedAt: new Date().toISOString(), currency: settings.currency, budget: weeklyBudget(), ...data };
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
        settings: {
          ...state.settings,
          currency: CURRENCIES.includes(data.currency) ? data.currency : state.settings.currency,
          budget: data.budget !== undefined ? Math.max(0, S.round(S.num(data.budget), 2)) : state.settings.budget,
        },
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
    case 'soon-only': ui.soonOnly = !ui.soonOnly; render(); break;
    case 'soon-pantry':
      Object.assign(ui, { soonOnly: true, lowOnly: false, loc: 'All', search: '' });
      setTab('pantry');
      break;
    case 'search-pantry':
      Object.assign(ui, { soonOnly: false, lowOnly: false, loc: 'All' });
      setTab('pantry');
      document.getElementById('search')?.focus();
      break;
    case 'week-details':
      Object.assign(ui, { period: 'week', anchor: null });
      setTab('spend');
      break;
    case 'set-budget':
      openSettings();
      modalForm.querySelector('input[name="budget"]')?.focus();
      break;
    case 'demo':
      state.items = S.demoData();
      commit(); render(); toast('Demo pantry loaded');
      break;
    case 'edit-extra': { const x = state.extras.find((v) => v.id === id); if (x) openExtraModal(x); break; }
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
    case 'scan-mode': ui.scanMode = el.dataset.mode; render(); break;
    case 'period': ui.period = el.dataset.period; render(); break;
    case 'period-jump': setAnchor(el.dataset.date); render(); break;
    case 'period-step': {
      const next = shiftPeriod(ui.period, periodRange(ui.period, anchorDate()).from, Number(el.dataset.delta));
      // Back is always allowed (a trip dated in the future can leave you there); forward stops at today.
      if (Number(el.dataset.delta) < 0 || next <= S.today()) { setAnchor(next); render(); }
      break;
    }
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
    refreshListProgress();
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
  const typed = String(fd.get('name') || '').trim();
  if (!typed) return;
  // "500g mince", "3 x tuna", "2 packs nappies", "2 lemons": the leading amount becomes the
  // note. A bare number only counts before a plural word, so "3 in 1 coffee", "2 minute
  // noodles" and "7 Up" stay whole. Tap an extra to fix it.
  const m = typed.match(/^(\d+(?:[.,]\d+)?\s*(?:x|kg|g|ml|l|pcs?|packs?|dozen|bottles?|cans?|box(?:es)?|bags?)\b)\s*(\S.*)$/i)
    || typed.match(/^(\d{1,2})\s+([a-z][a-z'-]*s\b.*)$/i);
  const name = (m ? m[2] : typed).slice(0, 120);
  state.extras.push({ id: S.uid(), name: name.charAt(0).toUpperCase() + name.slice(1), note: m ? m[1].trim() : '' });
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
