// Grocer data layer: one JSON blob in localStorage, plus the pure rules
// (stock status, how much to buy) that every view shares.

const KEY = 'larder.v1'; // the app was called Larder; the key stays so saved data carries over

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
    aliases: {},    // receipt line (aliasKey) -> item id, learned from your corrections
    renames: {},    // a reader's product name (aliasKey) -> the name you gave it
    stores: {},     // 'tin:<digits>' / 'h:<header>' -> the store name you confirmed
    barcodes: {},   // barcode -> item id
    packs: {},      // barcode -> quantity one scan adds, in the item's unit
    cart: { store: '', lines: [] }, // shopping in the store: items + shelf prices, saved as one trip at checkout
    settings: { apiKey: '', geminiKey: '', provider: 'device', localUrl: 'http://127.0.0.1:8080', currency: guessCurrency(), theme: 'system', budget: 0 },
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
    source: ['receipt', 'cart'].includes(p.source) ? p.source : 'manual',
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
  // Lookup tables pointing at items: keep only entries whose item still exists.
  const table = (v) => Object.fromEntries(Object.entries(isObj(v) ? v : {})
    .filter(([k, id]) => k && typeof id === 'string' && ids.has(id)));
  const barcodes = table(data?.barcodes);
  const packs = Object.fromEntries(Object.entries(isObj(data?.packs) ? data.packs : {})
    .filter(([k, v]) => barcodes[k] && num(v) > 0).map(([k, v]) => [k, num(v)]));
  const renames = Object.fromEntries(Object.entries(isObj(data?.renames) ? data.renames : {})
    .filter(([k, v]) => k && typeof v === 'string' && v.trim()).map(([k, v]) => [k, v.trim().slice(0, 120)]));
  const stores = Object.fromEntries(Object.entries(isObj(data?.stores) ? data.stores : {})
    .filter(([k, v]) => k && typeof v === 'string' && v.trim()).map(([k, v]) => [k, v.trim().slice(0, 60)]));
  const c = isObj(data?.cart) ? data.cart : {};
  const cart = {
    store: str(c.store).slice(0, 60),
    lines: (Array.isArray(c.lines) ? c.lines : []).filter(isObj).map((l) => ({
      id: str(l.id) || uid(),
      name: str(l.name).slice(0, 120) || 'Item',
      printed: str(l.printed).slice(0, 120),
      price: Math.max(0, round(num(l.price), 2)),
      qty: Math.max(1, Math.round(num(l.qty, 1))),
      match: ids.has(l.match) ? l.match : '',
      category: CATEGORIES.includes(l.category) ? l.category : 'Other',
    })),
  };
  return { items, purchases, extras, aliases: table(data?.aliases), renames, stores, barcodes, packs, cart };
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

// Keyword guess at a category from a product name or Open Food Facts tags.
// Order matters: "baby" before "milk", "frozen" before "chicken", drinks before fruit,
// snacks before dairy (MILK CHOCOLATE is a snack, not milk).
const CATEGORY_WORDS = [
  ['Baby', /\b(bab(y|ies)|nappy|nappies|diapers?|wipes|formula|infant|toddler)\b/i],
  ['Frozen', /\b(frozen|frz|ice\s*cream|gelato)\b/i],
  ['Personal Care', /\b(shampoo|conditioner|toothpaste|toothbrush|deodorant|soap\s*bar|body\s*wash|razor|tampons?|pads|lotion|sunscreen|beauty|hygiene)\b/i],
  ['Household', /\b(detergent|dish(washing)?|laundry|bleach|cleaner|toilet\s*(paper|tissue)|paper\s*towel|tissues?|foil|cling|bin\s*bags?|sponge|batter(y|ies))\b/i],
  ['Drinks', /\b(beverages?|drinks?|juice|water|soda|cola|coke|softdrink|lemonade|coffee|tea|cordial|beer|wine|powerade|gatorade)\b/i],
  ['Snacks', /\b(snacks?|chips|crisps|biscuits?|cookies?|chocolate|choc|lollies|candy|confection\w*|crackers?|popcorn|nuts|muesli\s*bar)\b/i],
  ['Dairy & Eggs', /\b(dair(y|ies)|milks?|cheeses?|yogh?urts?|butter|cream|eggs?)\b/i],
  ['Bakery', /\b(bread|breads|loaf|sourdough|rolls?|buns?|wraps?|bagels?|croissants?|muffins?|bakery|pastr(y|ies)|cakes?)\b/i],
  ['Meat & Seafood', /\b(meats?|beef|mince|steak|chicken|pork|lamb|bacon|ham|sausages?|salami|fish|salmon|tuna|prawns?|seafood|poultry|thigh|breast)\b/i],
  ['Produce', /\b(fruits?|vegetables?|veg|bananas?|apples?|oranges?|pears?|grapes?|berr(y|ies)|lemons?|limes?|avocados?|tomato(es)?|potato(es)?|onions?|garlic|carrots?|lettuce|spinach|broccoli|cucumbers?|capsicum|mushrooms?|herbs?|salad|fresh)\b/i],
];
export function guessCategory(text) {
  const t = String(text || '').replace(/[-_]/g, ' ');
  if (/\b(tin|tinned|canned|can|peanut)\b/i.test(t)) return 'Pantry';
  for (const [cat, re] of CATEGORY_WORDS) if (re.test(t)) return cat;
  return 'Pantry';
}

// Stable key for a receipt line, so a correction made once is reused next time:
// prices, weights and bare counts are dropped; sizes like "2L" or "400G" stay.
export function aliasKey(text) {
  return String(text || '').toUpperCase()
    .replace(/(\d+)[.,](\d+)\s*(ML|L|KG|G)\b/g, '$1_$2$3') // keep "1.5L" apart from "0.6L"
    .replace(/\$?\d*[.,:]\d+/g, ' ')
    .replace(/\b\d+\b/g, ' ')
    .replace(/[^A-Z0-9_ ]+/g, ' ')
    .replace(/\b(KG|EA|EACH)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Remember a learned lookup (receipt line or barcode -> item), keeping the table to
// the most recent `cap` entries so misreads can't grow it forever.
export function remember(table, key, value, cap = 500) {
  if (!key) return;
  delete table[key]; // re-insert so it counts as the newest
  table[key] = value;
  const keys = Object.keys(table);
  for (let i = 0; i < keys.length - cap; i++) delete table[keys[i]];
}

// Pack size in an item's unit, from text like "380 g", "2L", "1.5 kg" or "6 x 375 mL".
// null when there is no size or the units don't convert (a 2 L bottle vs pcs).
const SIZE_UNITS = { kg: 'kg', g: 'g', gm: 'g', ml: 'mL', l: 'L', lt: 'L', ltr: 'L' };
export function packQty(text, unit) {
  const m = String(text || '').match(/(?:(\d+)\s*[x×]\s*)?(\d+(?:[.,]\d+)?)\s*(kg|gm|g|ml|ltr|lt|l)\b/i);
  if (!m) return null;
  const n = parseFloat(m[2].replace(',', '.')) * (m[1] ? Number(m[1]) : 1);
  const q = convertQty(n, SIZE_UNITS[m[3].toLowerCase()], unit);
  return q && q > 0 ? q : null;
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
