// Larder data layer: one JSON blob in localStorage, plus the pure rules
// (stock status, how much to buy) that every view shares.

const KEY = 'larder.v1';

export const CATEGORIES = [
  'Produce', 'Meat & Seafood', 'Dairy & Eggs', 'Bakery', 'Pantry', 'Frozen',
  'Drinks', 'Snacks', 'Baby', 'Household', 'Personal Care', 'Other',
];
export const UNITS = ['pcs', 'pack', 'bottle', 'can', 'box', 'bag', 'dozen', 'kg', 'g', 'L', 'mL'];
export const LOCATIONS = ['Pantry', 'Fridge', 'Freezer', 'Other'];
export const CURRENCIES = ['AUD', 'PHP', 'USD', 'NZD', 'SGD', 'GBP', 'EUR', 'CAD'];

function guessCurrency() {
  const region = (navigator.language || '').split('-')[1] || '';
  const map = { AU: 'AUD', PH: 'PHP', US: 'USD', NZ: 'NZD', SG: 'SGD', GB: 'GBP', CA: 'CAD' };
  return map[region.toUpperCase()] || 'AUD';
}

function empty() {
  return {
    items: [],      // pantry stock
    purchases: [],  // shopping trips (receipt scans + manual entries)
    extras: [],     // one-off shopping list entries
    checked: {},    // shopping-list ticks, keyed 'item:<id>' / 'extra:<id>'
    settings: { apiKey: '', currency: guessCurrency(), theme: 'system' },
  };
}

export function load() {
  const base = empty();
  let raw = null;
  try {
    raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const data = JSON.parse(raw);
    return { ...sanitize(data), checked: isObj(data.checked) ? data.checked : {}, settings: { ...base.settings, ...(isObj(data.settings) ? data.settings : {}) } };
  } catch {
    // Keep the unreadable copy so the next save can't destroy it.
    try { if (raw) localStorage.setItem(`${KEY}.corrupt-${Date.now()}`, raw); } catch { /* full */ }
    return base;
  }
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// A real calendar date as YYYY-MM-DD, else ''. Rejects 2026-02-30 and 2026-13-05.
export function validDate(s) {
  if (!DATE_RE.test(s || '')) return '';
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d ? s : '';
}

// Rebuild items/purchases/extras from untrusted data (old saves, imported backups)
// so every record has the fields and types the UI relies on.
export function sanitize(data) {
  const items = (Array.isArray(data?.items) ? data.items : []).filter(isObj).map((r) => {
    const it = newItem({ ...r, name: str(r.name), expires: validDate(r.expires), notes: str(r.notes) });
    it.id = str(r.id) || it.id;
    const history = (Array.isArray(r.priceHistory) ? r.priceHistory : []).filter(isObj)
      .map((h) => ({ date: validDate(h.date) || today(), price: num(h.price), store: str(h.store) }))
      .filter((h) => h.price > 0);
    it.priceHistory = history.slice(-20);
    it.lastPrice = num(r.lastPrice) > 0 ? num(r.lastPrice) : null;
    it.updatedAt = num(r.updatedAt, Date.now());
    return it;
  });
  const ids = new Set(items.map((i) => i.id));
  const purchases = (Array.isArray(data?.purchases) ? data.purchases : []).filter(isObj).map((p) => ({
    id: str(p.id) || uid(),
    date: validDate(p.date) || today(),
    store: str(p.store) || 'Unknown store',
    total: round(num(p.total), 2),
    category: CATEGORIES.includes(p.category) ? p.category : undefined,
    source: p.source === 'receipt' ? 'receipt' : 'manual',
    createdAt: num(p.createdAt, Date.now()),
    lines: (Array.isArray(p.lines) ? p.lines : []).filter(isObj).map((l) => ({
      name: str(l.name) || 'Item',
      itemId: ids.has(l.itemId) ? l.itemId : '',
      category: CATEGORIES.includes(l.category) ? l.category : 'Other',
      qty: round(num(l.qty)),
      unit: UNITS.includes(l.unit) ? l.unit : 'pcs',
      lineTotal: round(num(l.lineTotal), 2),
    })),
  }));
  const extras = (Array.isArray(data?.extras) ? data.extras : []).filter(isObj)
    .map((x) => ({ id: str(x.id) || uid(), name: str(x.name), note: str(x.note) }))
    .filter((x) => x.name);
  return { items, purchases, extras };
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function uid() {
  if (globalThis.crypto?.randomUUID) {
    try { return crypto.randomUUID(); } catch { /* insecure context (LAN http) */ }
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function round(n, dp = 3) {
  const f = 10 ** dp;
  return Math.round((Number(n) || 0) * f) / f;
}

export function num(v, fallback = 0) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

// 'out' when nothing left, 'low' at or below the alert level, else 'ok'.
export function statusOf(item) {
  if (item.qty <= 0) return 'out';
  if (item.qty <= item.low) return 'low';
  return 'ok';
}

// How much to buy to get back up to the ideal stock level (par).
export function needOf(item) {
  const gap = round(item.par - item.qty);
  return gap > 0 ? gap : stepOf(item.unit);
}

// The +/- step for a unit: whole counts for packaged goods, sensible chunks for weight/volume.
export function stepOf(unit) {
  if (unit === 'g' || unit === 'mL') return 100;
  if (unit === 'kg' || unit === 'L') return 0.25;
  return 1;
}

// Alert level for an item first seen on a receipt/photo: about a third of what
// was bought, so it reaches the list before it runs out (1 bought -> only when out).
export function defaultLow(qty, unit) {
  if (stepOf(unit) === 1) return Math.floor(qty / 3);
  return round(qty / 4, 2);
}

// Convert between units of the same kind; null when they don't convert (pcs -> L).
const UNIT_BASE = { g: ['g', 1], kg: ['g', 1000], mL: ['mL', 1], L: ['mL', 1000], pcs: ['pcs', 1], dozen: ['pcs', 12] };
export function convertQty(qty, from, to) {
  if (from === to) return qty;
  const a = UNIT_BASE[from];
  const b = UNIT_BASE[to];
  if (!a || !b || a[0] !== b[0]) return null;
  return round(qty * a[1] / b[1]);
}

export function daysUntil(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return null;
  const target = new Date(y, m - 1, d);
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - start) / 86400000);
}

export function defaultLocation(category) {
  if (category === 'Frozen') return 'Freezer';
  if (category === 'Dairy & Eggs' || category === 'Meat & Seafood') return 'Fridge';
  return 'Pantry';
}

export function newItem(fields = {}) {
  const category = CATEGORIES.includes(fields.category) ? fields.category : 'Other';
  return {
    id: uid(),
    name: (fields.name || '').trim() || 'Unnamed item',
    category,
    location: LOCATIONS.includes(fields.location) ? fields.location : defaultLocation(category),
    unit: UNITS.includes(fields.unit) ? fields.unit : 'pcs',
    qty: round(num(fields.qty, 0)),
    low: round(num(fields.low, 1)),
    par: round(num(fields.par, 2)),
    expires: fields.expires || '',
    notes: fields.notes || '',
    lastPrice: null,
    priceHistory: [],
    updatedAt: Date.now(),
  };
}

// Record a price paid per unit; keeps the last 20 for the price-watch view.
export function recordPrice(item, price, date, store) {
  if (!(price > 0)) return;
  // Keep sub-cent precision: cheese at $6 per 500 g is $0.012/g.
  item.lastPrice = round(price, 6);
  item.priceHistory = [...(item.priceHistory || []), { date, price: item.lastPrice, store: store || '' }].slice(-20);
}

// When an item's unit changes, re-express its prices in the new unit (or drop them
// if the units don't convert), so price changes aren't reported as -99%.
export function changeUnit(item, unit) {
  if (item.unit === unit) return;
  const from = UNIT_BASE[item.unit];
  const to = UNIT_BASE[unit];
  if (!from || !to || from[0] !== to[0]) {
    item.lastPrice = null;
    item.priceHistory = [];
  } else {
    const k = to[1] / from[1]; // old units in one new unit, e.g. kg -> g = 0.001

    item.lastPrice = item.lastPrice ? round(item.lastPrice * k, 6) : null;
    item.priceHistory = (item.priceHistory || []).map((h) => ({ ...h, price: round(h.price * k, 6) }));
  }
  item.unit = unit;
}

export function demoData() {
  const d = today();
  const mk = (f, price) => {
    const it = newItem(f);
    if (price) recordPrice(it, price, d, 'Demo Mart');
    return it;
  };
  return [
    mk({ name: 'Milk', category: 'Dairy & Eggs', unit: 'L', qty: 0.5, low: 1, par: 3 }, 1.6),
    mk({ name: 'Eggs', category: 'Dairy & Eggs', unit: 'dozen', qty: 1, low: 0, par: 2 }, 6.5),
    mk({ name: 'Rice', category: 'Pantry', unit: 'kg', qty: 4, low: 2, par: 10 }, 2.2),
    mk({ name: 'Bananas', category: 'Produce', unit: 'pcs', qty: 0, low: 2, par: 6 }, 0.45),
    mk({ name: 'Chicken thighs', category: 'Meat & Seafood', unit: 'kg', qty: 1, low: 0.5, par: 2, location: 'Freezer' }, 11),
    mk({ name: 'Nappies', category: 'Baby', unit: 'pack', qty: 1, low: 1, par: 3 }, 22),
    mk({ name: 'Dish soap', category: 'Household', unit: 'bottle', qty: 2, low: 1, par: 2 }, 4),
  ];
}
