// No-AI receipt reading: Tesseract.js reads the text on the phone, then fixed
// rules turn the text into receipt lines. Returns the same shape the AI readers
// return, so the review screen doesn't care which reader was used.

import { guessCategory, validDate, today, round, convertQty, packQty, daysUntil } from './store.js';
import { expandName } from './phnames.js';

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
// -> one text per photo; parseReceiptPhotos turns them into one receipt.
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
    return texts;
  } finally {
    if (active === worker) active = null;
    worker.terminate().catch(() => {});
  }
}

// ---------- text -> receipt ----------

const PRICE_RE = /-?\$?(?:\d{1,3}(?:,\d{3})+|\d{1,5})[.,:]\d{2}-?/g;
// Header/footer lines that can look like "text + price" (times like 17:42, phone numbers).
// Short labels (TIN, MIN, REG, PH) only count with their usual punctuation, so
// TIN TOMATOES or COKE REG 1.5L are still products.
const META_RE = /\b(abn|acn|s\/n|phone|terminal|txn|invoice|receipt|store\s*no|operator|cashier|bagger|approval|card\s*no)\b|\b(tin|min|ptu|tel|ph|trans|time)\s*[:#.]|\breg\s*(#|no\b|\d)|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{1,2}:\d{2}:\d{2}/i;
// Money bookkeeping, not purchases: dropped. Only when the line STARTS with it,
// so a "BIRTHDAY CARD" or "CASHEWS" is still an item. GST/VAT anywhere.
const IGNORE_RE = /^(sub\s*-?total|change|cash|eftpos|visa|master\s*card|amex|debit|credit|card|tender|paid|rounding|items?\s+(sold|purchased)|balance|payment|vatable|zero\s*rated|non\s*vat)\b|\b(gst|vat|tax)\b/i;
// Lines that cost money but aren't pantry items: shown unticked.
const SKIP_RE = /\b(bags?|discount|disc|savings?|saved|loyalty|rewards?|points|coupon|voucher|deposit|promo|member)\b/i;
// ...except bags you actually stock (trash bags, freezer bags, "TRASHBAG XL").
const BAG_PRODUCT_RE = /\b(trash|garbage|bin|freezer|zip|ziplock|sandwich|tea|z\s*s)\b|trashbag/i;
// "2 @ $2.50", "3 x 1.50", "2 % 34.70" (OCR'd x), "0.856 kg @ $3.90/kg", "0.856 kg NET @ $3.90/kg"
const QTY_RE = /(\d+(?:[.,]\d+)?)\s*(kg|g)?(?:\s+[a-z]+)?\s*[@xX%×]\s*\$?(\d+[.,]\d{2})(?:\s*\/\s*(?:kg|ea))?/i;
const QTY_PREFIX = /^(\d{1,2})\s*[xX@]\s+/;

const toNumber = (s) => {
  let t = String(s).replace(/\$/g, '');
  if (/\d,\d{3}[.,:]\d{2}/.test(t)) t = t.replace(/,(?=\d{3}\b)/g, '');
  t = t.replace(/[,:]/g, '.');
  const neg = t.startsWith('-') || t.endsWith('-');
  t = t.replace(/-/g, '');
  const n = parseFloat(t);
  return Number.isFinite(n) ? (neg ? -n : n) : NaN;
};

// The last price on a line, allowing a VAT flag and a few junk characters after
// it ("148.00 V", "153.75 Vv. <"). -> { label, amount } | null
function splitPrice(line) {
  let last = null;
  for (const m of line.matchAll(PRICE_RE)) last = m;
  if (!last) return null;
  const after = line.slice(last.index + last[0].length);
  if (after.length > 8 || (after.match(/[a-z0-9]/gi) || []).length > 3) return null;
  return { label: line.slice(0, last.index).trim(), amount: toNumber(last[0]) };
}

// A product code at the start of a name line (Puregold, SM and many others).
// OCR reads some digits as look-alike letters, so map those back, then keep the
// code only if its check digit is right.
const LOOKALIKE = { O: '0', o: '0', D: '0', Q: '0', B: '8', l: '1', I: '1', i: '1', '|': '1', Z: '2', z: '2', S: '5', s: '5', G: '6', b: '6', A: '4', g: '9', q: '9' };
function splitCode(line) {
  const tokens = line.split(' ');
  for (let i = 0; i < Math.min(tokens.length - 1, 3); i++) {
    const t = tokens[i];
    const digits = (t.match(/\d/g) || []).length;
    if (t.length >= 8 && t.length <= 15 && digits / t.length >= 0.6) {
      const code = t.replace(/\D/g, (c) => LOOKALIKE[c] ?? '');
      return { code: gtinOk(code) ? code : '', name: tokens.slice(i + 1).join(' ') };
    }
  }
  return { code: '', name: line };
}
function gtinOk(code) {
  if (!/^(\d{8}|\d{12,14})$/.test(code)) return false;
  const d = code.split('').map(Number);
  const check = d.pop();
  return (10 - (d.reverse().reduce((t, x, i) => t + x * (i % 2 ? 1 : 3), 0) % 10)) % 10 === check;
}

// Drop stray symbols OCR leaves at the start of a line ("¥ ", "W1 x", "| ").
const cleanLead = (s) => s.replace(/^(?:[^A-Za-z0-9]+\s*|[A-Za-z](?=\s*\d))+/, '').trim();

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

// "qty x unit price" and the line total are the same money printed twice, so a
// disagreement means OCR misread one of them:
//  - total / unit price is a whole number -> the quantity was misread ("11 x" for "1 x");
//  - otherwise trust whichever looks like a shop price (cents in steps of 5: .00 .25 .80,
//    not .89 or .06, the usual 0<->9 / 0<->6 slips).
function reconcile(qty, unitText, amount, unit = 'pcs', dollar = false) {
  const unitPrice = toNumber(unitText);
  const calc = round(qty * unitPrice, 2);
  if (!Number.isFinite(calc) || Math.abs(calc - amount) < 0.011) return { qty, amount, check: false };
  // "@ $2.50" read as "@ 32.50" / "@ 52.50": the dollar sign became a digit
  // (only where a $ is printed, i.e. "@" lines - "1 x 80.25" has none)
  const digits = String(unitText).replace(/^\$/, '');
  if (dollar && /^\d{2,}[.,:]\d{2}$/.test(digits) && Math.abs(qty * toNumber(digits.slice(1)) - amount) < 0.011) return { qty, amount, check: false };
  const ratio = amount / unitPrice;
  if (unitPrice > 0 && Math.round(ratio) >= 1 && Math.round(ratio) <= 12 && Math.abs(Math.round(ratio) * unitPrice - amount) < 0.011) return { qty: Math.round(ratio), amount, check: false };
  // weighed items: the weight is the likeliest misread; work it out from the price
  if ((unit === 'kg' || unit === 'g') && unitPrice > 0) return { qty: round(amount / unitPrice, 3), amount, check: true };
  const tidy = (v) => { const c = Math.round(v * 100) % 100; return c % 25 === 0 ? 2 : c % 5 === 0 ? 1 : 0; };
  if (tidy(calc) > tidy(amount)) return { qty, amount: calc, check: true };
  // the total lost leading digits ("0.25" for "80.25"): far below one unit's price
  if (calc > amount && (calc.toFixed(2).endsWith(amount.toFixed(2)) || amount < unitPrice * 0.5)) return { qty, amount: calc, check: true };
  return { qty, amount, check: true };
}

// Lines below the items: "Subtotal", "Total Amt Due", "Total Discount", even when
// OCR clips the first letters ("Wototal", "Otal Ant Due").
const FOOTER_RE = /otal\b|\btota[l1]\b|\b(?:amt|amount|balance)\s*due\b/i;

// Usually printed 2-4 times (subtotal, amount due, card charged): an amount that
// repeats is the one to trust. With no repeat, take the one closest to what the
// item lines add up to (a misread "Total Discount 9.00" is nowhere near it).
function pickTotal(amounts, linesSum = null) {
  if (!amounts.length) return null;
  const counts = new Map();
  for (const a of amounts) counts.set(a, (counts.get(a) || 0) + 1);
  const ranked = [...counts.entries()].sort((x, y) => y[1] - x[1]);
  if (ranked[0][1] > 1 || linesSum === null) return ranked[0][0];
  return amounts.reduce((best, a) => (Math.abs(a - linesSum) < Math.abs(best - linesSum) ? a : best));
}

// Pure: one photo's text -> { store, date, total, itemsCount, lines[] } in the AI
// readers' shape. match(name, receiptText, barcode) -> { id, unit, guess } | null.
export function parseReceiptText(text, { dayFirst = true, match = () => null } = {}) {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  // The store name: the first line that is mostly real letters (not the paper
  // edge read as "EEEE———", nor a header like TIN/ABN).
  const wordy = (l) => {
    const letters = l.replace(/[^a-z]/gi, '');
    return letters.length >= 4 && new Set(letters.toLowerCase()).size >= 4 && letters.length / l.replace(/\s/g, '').length >= 0.6;
  };
  const storeLine = lines.slice(0, 8).find((l) => wordy(l) && !META_RE.test(l)) || '';
  const store = titleCase(cleanLead(storeLine).slice(0, 40));
  const date = findDate(lines, dayFirst);
  const countLine = lines.map((l) => l.match(/items?\s+(?:purchased|sold)\D{0,4}(\d{1,4})/i)).find(Boolean);

  const out = [];
  let footerAt = -1;
  let pending = null; // a name line with no price, waiting for its "1 x 148.00" line

  for (let li = 0; li < lines.length; li++) {
    const raw = lines[li];
    const p = splitPrice(raw);
    if (!p) {
      const name = cleanLead(raw);
      pending = /[a-z]{3}/i.test(name) && !IGNORE_RE.test(name) && !META_RE.test(name) ? name : null;
      continue;
    }
    const label = cleanLead(p.label);
    const amount = p.amount;
    if (!Number.isFinite(amount)) continue;

    if (FOOTER_RE.test(label)) { footerAt = li; break; }
    if (META_RE.test(raw)) { pending = null; continue; }
    if (IGNORE_RE.test(label) && !SKIP_RE.test(label)) { pending = null; continue; }

    let name = label;
    let qty = 1;
    let unit = 'pcs';
    let check = false;
    let lineTotal = amount;
    const q = label.match(QTY_RE);
    // A quantity line starts with the quantity: "1 x 148.00", "2 @ $2.50". OCR
    // sometimes turns "1 x" into letters ("Xk 67.80", "Ll X 34.55"): a line that
    // is a price with at most two stray letters is a quantity line too.
    const garbled = !q && pending && label.replace(/[^a-z]/gi, '').length <= 2 && /\d+[.,]\d{2}/.test(label);
    const qtyLine = (!!q && label.slice(0, q.index).replace(/[^a-z]/gi, '').length === 0) || garbled;
    if (qtyLine && pending) {
      name = pending;
      if (q) {
        unit = q[2] ? q[2].toLowerCase() : 'pcs';
        ({ qty, amount: lineTotal, check } = reconcile(toNumber(q[1]), q[3], amount, unit, q[0].includes('@')));
      } else {
        const nums = label.match(/\d+[.,]\d{2}/g);
        ({ qty, amount: lineTotal, check } = reconcile(1, nums[nums.length - 1], amount));
      }
    } else if (qtyLine) {
      continue; // a quantity line whose name line wasn't read
    } else {
      if (q) {
        unit = q[2] ? q[2].toLowerCase() : 'pcs';
        name = name.replace(q[0], ' ').trim();
        ({ qty, amount: lineTotal, check } = reconcile(toNumber(q[1]), q[3], amount, unit, q[0].includes('@')));
      }
      const pre = name.match(QTY_PREFIX);
      if (pre) {
        qty = Number(pre[1]);
        name = name.slice(pre[0].length);
      }
    }
    pending = null;
    const { code, name: product } = splitCode(name);
    name = product.trim();
    if (!/[a-z]{2}/i.test(name)) continue;

    const skip = lineTotal < 0 || (SKIP_RE.test(name) && !BAG_PRODUCT_RE.test(name));
    if (skip && lineTotal === 0) continue;
    const receiptText = (qtyLine ? `${name} ${label}` : label).trim();
    // "PF CB 210G" -> "Purefoods Corned Beef 210g" (phnames.js); unknown lines keep the printed name
    const full = skip ? null : expandName(name);
    const shown = full ? full.name : titleCase(name);
    const hit = skip ? null : match(shown, receiptText, code);
    out.push({
      receipt_text: receiptText,
      printed: name, // the product as printed, before expansion (mergeLines judges reads by it)
      name: shown,
      category: full?.category || guessCategory(shown),
      qty: hit ? fitQty(name, qty, unit, hit.unit) : qty,
      unit: hit ? hit.unit : unit,
      line_total: round(lineTotal, 2),
      match_id: hit ? hit.id : '',
      guess: !!hit?.guess,
      barcode: code,
      check,
      skip,
    });
  }

  // The total: amounts on the footer lines (subtotal, amount due, card charged),
  // never discount / change / VAT lines.
  const amounts = [];
  if (footerAt >= 0) {
    for (const raw of lines.slice(footerAt)) {
      const p = splitPrice(raw);
      if (!p || /disc|sav|change|vat|tax|gst|items?\s+(?:sold|purchased)|point/i.test(p.label)) continue;
      if (FOOTER_RE.test(p.label) || /credit|debit|cash|card|visa|eftpos|gcash|maya|pay/i.test(p.label)) amounts.push(round(p.amount, 2));
    }
  }
  const linesSum = out.reduce((t, l) => t + l.line_total, 0);
  return { store, date, total: pickTotal(amounts, linesSum), itemsCount: countLine ? Number(countLine[1]) : null, lines: out };
}

// Several photos of one long receipt -> one receipt. Each photo is read on its
// own, then consecutive photos are lined up by their sequence of prices (which
// OCR reads more reliably than names); in the overlap the cleaner copy of each
// line is kept - a finger over the name in one photo is usually clear in the next.
export function parseReceiptPhotos(texts, opts = {}) {
  const parts = texts.map((t) => parseReceiptText(t, opts));
  let lines = [];
  for (const part of parts) lines = mergeLines(lines, part.lines);
  const totals = parts.map((p) => p.total).filter((t) => t !== null);
  const sum = lines.reduce((t, l) => t + l.line_total, 0);
  let date = parts.find((p) => p.date)?.date || '';
  const age = date ? -daysUntil(date) : null;
  if (age === null || age < -1 || age > 45) date = today(); // misread dates (2026-1.1-) are usually far off
  // A total nowhere near what the lines add up to was misread ("4.33" for
  // "9,114.33"): use the lines' sum and say so on the review screen.
  let total = totals.length ? pickTotal(totals, sum) : null;
  const plausible = (t) => sum <= 0 || t >= sum * 0.75; // larger is fine: lines were missed
  if (total !== null && !plausible(total)) total = totals.find(plausible) ?? null;
  const totalGuessed = total === null && lines.length > 0;
  return {
    store: parts.find((p) => p.store)?.store || '',
    date,
    total: round(total ?? sum, 2),
    totalGuessed,
    itemsCount: parts.map((p) => p.itemsCount).find((n) => n) ?? null,
    lines,
  };
}

const samePrice = (a, b) => Math.abs(a.line_total - b.line_total) < 0.011;
// Judged on the product as printed, not the expanded name ("Oishi Salted Egg Chips"
// is longer than "OKI SLT ECGS" but was read no better).
const quality = (l) => ((l.printed ?? l.name).match(/[a-z]/gi) || []).length + (l.barcode ? 12 : 0) - (l.check ? 4 : 0);

// prev + next where next's first lines repeat prev's last ones. Like a text
// diff: find the longest in-order run of equal prices between prev's tail and
// next's head; matched pairs, and unmatched lines sitting between them, are the
// same receipt lines read twice - keep the cleaner copy of each.
export function mergeLines(prev, next) {
  if (!prev.length) return next.slice();
  const off = Math.max(0, prev.length - 80);
  const A = prev.slice(off);
  const B = next.slice(0, 80);
  const L = Array.from({ length: A.length + 1 }, () => new Uint16Array(B.length + 1));
  for (let i = A.length - 1; i >= 0; i--) {
    for (let j = B.length - 1; j >= 0; j--) {
      L[i][j] = samePrice(A[i], B[j]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    }
  }
  const pairs = [];
  for (let i = 0, j = 0; i < A.length && j < B.length;) {
    if (samePrice(A[i], B[j]) && L[i][j] === L[i + 1][j + 1] + 1) { pairs.push([i, j]); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++;
  }
  // A real overlap starts at next's top and runs to prev's bottom (give or take
  // a few lines cut off at the photo edges). Otherwise the photos don't overlap.
  const real = pairs.filter(([, j]) => j < 40);
  const sure = real.length >= 2 || (real.length === 1 && (() => {
    const [a, b] = real[0]; // a one-line overlap only counts when it is plainly the same line
    return (A[a].barcode && A[a].barcode === B[b].barcode) || A[a].name.toLowerCase() === B[b].name.toLowerCase();
  })());
  if (!sure || real[0][1] > 6 || A.length - 1 - real[real.length - 1][0] > 6) return [...prev, ...next];

  const out = prev.slice();
  const take = (a, b) => { if (quality(B[b]) > quality(out[off + a])) out[off + a] = B[b]; };
  for (let k = 0; k < real.length; k++) {
    const [a, b] = real[k];
    take(a, b);
    const [na, nb] = real[k + 1] || [A.length, B.length];
    const gap = Math.min(na - a - 1, nb - b - 1, k + 1 < real.length ? Infinity : A.length - a - 1);
    for (let g = 1; g <= gap; g++) take(a + g, b + g); // misread on both sides: same position
  }
  const [la, lb] = real[real.length - 1];
  const tailPaired = Math.min(A.length - la - 1, B.length - lb - 1);
  return [...out, ...next.slice(lb + 1 + tailPaired)];
}

// Express a receipt quantity in the pantry item's unit: "FC MILK 2L" x1 against
// a pantry item in L is 2 L; 0.856 kg against an item in g is 856 g.
function fitQty(name, qty, unit, itemUnit) {
  const direct = convertQty(qty, unit, itemUnit);
  if (unit !== 'pcs' && direct !== null) return direct;
  const size = packQty(name, itemUnit);
  return size ? round(qty * size) : qty;
}
