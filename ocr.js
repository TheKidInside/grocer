// No-AI receipt reading: Tesseract.js reads the text on the phone, then fixed
// rules turn the text into receipt lines. Returns the same shape the AI readers
// return, so the review screen doesn't care which reader was used.

import { guessCategory, validDate, today, round, convertQty, packQty } from './store.js';

const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js';

let loading = null;
function loadTesseract() {
  if (globalThis.Tesseract) return Promise.resolve(globalThis.Tesseract);
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = TESSERACT_URL;
    s.onload = () => resolve(globalThis.Tesseract);
    s.onerror = () => { loading = null; reject(new Error('Could not load the text reader. Check your internet connection (needed the first time only).')); };
    document.head.appendChild(s);
  });
  return loading;
}

// One reader at a time: a second one in parallel can push iOS Safari out of memory.
let active = null;
export function cancelReading() {
  const w = active;
  active = null;
  w?.terminate().catch(() => {});
}

// images: [{ preview: dataURL }] in receipt order (see ai.prepareImage forText).
export async function readReceiptText(images, onProgress) {
  cancelReading();
  const Tesseract = await loadTesseract();
  const worker = await Tesseract.createWorker('eng', 1, {
    logger: (m) => { if (m.status === 'recognizing text' && onProgress) onProgress(m.progress); },
  });
  active = worker;
  try {
    const texts = [];
    for (const img of images) {
      if (active !== worker) throw new Error('cancelled');
      texts.push((await worker.recognize(img.preview)).data.text);
    }
    return mergeTexts(texts);
  } finally {
    if (active === worker) active = null;
    worker.terminate().catch(() => {});
  }
}

// Photos of a long receipt overlap: drop the lines at the top of each photo that
// repeat the bottom of the previous one.
const lineKey = (l) => l.toUpperCase().replace(/[^A-Z0-9]/g, '');
export function mergeTexts(texts) {
  const merged = [];
  for (const t of texts) {
    const next = t.split(/\r?\n/).filter((l) => l.trim());
    let overlap = 0;
    for (let k = Math.min(20, merged.length, next.length); k > 0; k--) {
      const tail = merged.slice(-k).map(lineKey);
      if (next.slice(0, k).every((l, i) => lineKey(l) === tail[i])) { overlap = k; break; }
    }
    merged.push(...next.slice(overlap));
  }
  return merged.join('\n');
}

// ---------- text -> receipt ----------

const PRICE = String.raw`-?\$?\d{1,5}[.,:]\d{2}-?`;
const PRICE_END = new RegExp(String.raw`^(.*?)\s*(${PRICE})\s*(?:[A-Z*#]{0,2})$`);
const TOTAL_RE = /^(grand\s+)?(total|amount\s+due|balance\s+due|total\s+due|to\s+pay)\b(?!.*\b(sav|disc|gst|tax))/i;
// Header/footer lines that can look like "text + price" (times like 17:42, phone numbers).
const META_RE = /\b(abn|acn|tel|phone|ph|reg|terminal|term|trans|txn|invoice|receipt|store\s*no|operator|cashier|time)\b|\d{1,2}\/\d{1,2}\/\d{2,4}/i;
// Money bookkeeping, not purchases: dropped. Only when the line STARTS with it,
// so a "BIRTHDAY CARD" or "CASHEWS" is still an item. GST/VAT anywhere.
const IGNORE_RE = /^(sub\s*-?total|change|cash|eftpos|visa|master\s*card|amex|debit|credit|card|tender|paid|rounding|items?\s+sold|balance|payment)\b|\b(gst|vat|tax)\b/i;
// Lines that cost money but aren't pantry items: shown unticked.
const SKIP_RE = /\b(bags?|discount|disc|savings?|saved|loyalty|rewards?|points|coupon|voucher|deposit|promo|member)\b/i;
// "2 @ $2.50", "3 x 1.50", "0.856 kg @ $3.90/kg", "0.856 kg NET @ $3.90/kg"
const QTY = String.raw`(\d+(?:[.,]\d+)?)\s*(kg|g)?(?:\s+[a-z]+)?\s*[@xX]\s*\$?\d+[.,]\d{2}(?:\s*\/\s*(?:kg|ea))?`;
const QTY_LINE = new RegExp(`^${QTY}`, 'i');
const QTY_INLINE = new RegExp(String.raw`(?:^|\s)${QTY}`, 'i');
const QTY_PREFIX = /^(\d{1,2})\s*[xX@]\s+/;

const toNumber = (s) => {
  let t = s.replace(/\$/g, '').replace(/[,:]/g, '.');
  const neg = t.startsWith('-') || t.endsWith('-');
  t = t.replace(/-/g, '');
  const n = parseFloat(t);
  return Number.isFinite(n) ? (neg ? -n : n) : NaN;
};

function titleCase(s) {
  return s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase())
    .replace(/\b(\d+(?:\.\d+)?)(kg|g|ml|l|pk)\b/gi, (_, n, u) => n + (u.toLowerCase() === 'l' ? 'L' : u.toLowerCase()));
}

function findDate(lines, dayFirst) {
  for (const l of lines) {
    let m = l.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
    if (m) {
      const d = validDate(`${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`);
      if (d) return d;
    }
    m = l.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/);
    if (m) {
      const y = m[3].length === 2 ? `20${m[3]}` : m[3];
      const [dd, mm] = dayFirst ? [m[1], m[2]] : [m[2], m[1]];
      const d = validDate(`${y}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`);
      if (d) return d;
    }
  }
  return '';
}

// Pure: OCR text -> { store, date, total, lines[] } in the AI readers' shape.
// match(name, receiptText) -> { id, unit, guess } | null decides pantry matches.
export function parseReceiptText(text, { dayFirst = true, match = () => null } = {}) {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const store = titleCase((lines.find((l) => /[a-z]{3}/i.test(l)) || '').slice(0, 40));
  const date = findDate(lines, dayFirst) || today();

  const out = [];
  let total = null;
  let pending = null; // a name line with no price, waiting for its "2 @ $2.50" line

  for (const raw of lines) {
    const m = raw.match(PRICE_END);
    if (!m) {
      pending = /[a-z]{3}/i.test(raw) && !IGNORE_RE.test(raw) && !META_RE.test(raw) ? raw : null;
      continue;
    }
    const label = m[1].trim();
    const amount = toNumber(m[2]);
    if (!Number.isFinite(amount)) continue;

    if (TOTAL_RE.test(label)) { total = amount; break; }
    if (META_RE.test(raw)) { pending = null; continue; }
    if (IGNORE_RE.test(label) && !SKIP_RE.test(label)) { pending = null; continue; }

    let name = label;
    let qty = 1;
    let unit = 'pcs';
    const q = label.match(QTY_LINE);
    if (q && pending) {
      name = pending;
      qty = toNumber(q[1]);
      unit = q[2] ? q[2].toLowerCase() : 'pcs';
    } else if (q && !pending) {
      continue; // a qty line we can't attach to a name
    } else {
      const inline = name.match(QTY_INLINE);
      if (inline) {
        qty = toNumber(inline[1]);
        unit = inline[2] ? inline[2].toLowerCase() : 'pcs';
        name = name.replace(inline[0], ' ').trim();
      }
      const pre = name.match(QTY_PREFIX);
      if (pre) {
        qty = Number(pre[1]);
        name = name.slice(pre[0].length);
      }
    }
    pending = null;
    if (!/[a-z]{2}/i.test(name)) continue;

    const skip = amount < 0 || SKIP_RE.test(name);
    const receiptText = (q ? `${name} ${label}` : label).trim();
    const hit = skip ? null : match(name, receiptText);
    out.push({
      receipt_text: receiptText,
      name: titleCase(name),
      category: guessCategory(name),
      qty: hit ? fitQty(name, qty, unit, hit.unit) : qty,
      unit: hit ? hit.unit : unit,
      line_total: round(amount, 2),
      match_id: hit ? hit.id : '',
      guess: !!hit?.guess,
      skip,
    });
  }

  const linesSum = out.reduce((t, l) => t + l.line_total, 0);
  return { store, date, total: round(total ?? linesSum, 2), lines: out };
}

// Express a receipt quantity in the pantry item's unit: "FC MILK 2L" x1 against
// a pantry item in L is 2 L; 0.856 kg against an item in g is 856 g.
function fitQty(name, qty, unit, itemUnit) {
  const direct = convertQty(qty, unit, itemUnit);
  if (unit !== 'pcs' && direct !== null) return direct;
  const size = packQty(name, itemUnit);
  return size ? round(qty * size) : qty;
}
