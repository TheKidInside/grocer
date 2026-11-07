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

// Grocery chains, matched even when the faint header is misread
// ("Parejola Pree Clic" -> Puregold). Checked on the top lines and the footer
// (Puregold, SM and others print their name again at the bottom).
const CHAINS = [
  'Puregold', 'SM Supermarket', 'SM Hypermarket', 'Savemore', 'Robinsons Supermarket', 'Robinsons Easymart',
  'Waltermart', 'Landers', 'S&R Membership Shopping', 'Shopwise', "Rustan's", 'Metro Supermarket', 'Gaisano',
  'Alfamart', '7-Eleven', 'Ministop', 'AllDay', 'Mercury Drug', 'Watsons', 'South Supermarket', 'Super8',
  'Woolworths', 'Coles', 'Aldi', 'IGA', 'Costco', 'Harris Farm', 'FoodWorks', 'Drakes', 'Foodland',
];
const letters = (s) => s.toUpperCase().replace(/[^A-Z0-9&]/g, '');
function grams(s) { const t = letters(s); const g = new Set(); for (let k = 0; k < t.length - 1; k++) g.add(t.slice(k, k + 2)); return g; }
function dice(a, b) { let n = 0; for (const g of a) if (b.has(g)) n++; return a.size + b.size ? (2 * n) / (a.size + b.size) : 0; }
function knownChain(lines) {
  let best = null;
  let bestScore = 0;
  for (const l of [...lines.slice(0, 12), ...lines.slice(-20)]) {
    const words = l.split(' ');
    for (const chain of CHAINS) {
      const want = chain.split(' ').length;
      // compare against the start of the line, as long as the chain's name (+1 word for misreads)
      const head = words.slice(0, Math.max(1, want + 1)).join(' ');
      const cg = grams(chain);
      if (cg.size < 2) continue;
      // similar letters AND similar length ("SHOP 4" is not "SHOPWISE")
      const fit = (t) => { const tl = letters(t).length; const cl = letters(chain).length; return Math.min(tl, cl) / Math.max(tl, cl) >= 0.7 ? dice(cg, grams(t)) : 0; };
      const score = Math.max(fit(head), fit(words.slice(0, want).join(' ')));
      if (score > bestScore) { bestScore = score; best = chain; }
    }
  }
  return bestScore >= 0.6 ? best : null;
}
// The receipt's tax/business number (PH "VAT REG TIN", AU "ABN"): read
// reliably and unique per branch, so a store name you correct once sticks.
function taxId(lines) {
  for (const l of lines.slice(0, 15)) {
    if (!/\b(tin|abn|vat\s*reg)\b/i.test(l)) continue;
    const digits = l.replace(/[^0-9]/g, '');
    if (digits.length >= 9) return digits.slice(0, 14);
  }
  return '';
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
  // The store: a known chain if one is recognisable, else the first proper line at the top.
  const chain = knownChain(lines);
  const store = chain || titleCase(cleanLead(storeLine).slice(0, 40));
  const storeHints = { tin: taxId(lines), header: cleanLead(storeLine), chain: !!chain };
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
  return { store, storeHints, date, total: pickTotal(amounts, linesSum), itemsCount: countLine ? Number(countLine[1]) : null, lines: out };
}

// Several photos of one long receipt -> one receipt. Each photo is read on its
// own; then photos are joined wherever their lines overlap, in whatever order
// they were picked (and a photo picked twice adds nothing). Prices are what
// line photos up - OCR reads them more reliably than names - and in the overlap
// the cleaner copy of each line is kept: a finger over a name in one photo is
// usually clear in the next.
export function parseReceiptPhotos(texts, opts = {}) {
  const parts = texts.map((t) => parseReceiptText(t, opts));
  const lines = flagRepeats(joinPhotos(parts.map((p) => p.lines)));
  const counted = lines.filter((l) => !l.duplicate);
  const totals = parts.map((p) => p.total).filter((t) => t !== null);
  const sum = counted.reduce((t, l) => t + l.line_total, 0);
  let date = parts.find((p) => p.date)?.date || '';
  const age = date ? -daysUntil(date) : null;
  if (age === null || age < -1 || age > 45) date = today(); // misread dates (2026-1.1-) are usually far off
  // A total far below what the lines add up to was misread ("4.33" for
  // "9,114.33"): use the lines' sum and say so on the review screen.
  let total = totals.length ? pickTotal(totals, sum) : null;
  const plausible = (t) => sum <= 0 || t >= sum * 0.75; // larger is fine: lines were missed
  if (total !== null && !plausible(total)) total = totals.find(plausible) ?? null;
  return {
    // a recognised chain from any photo (the footer one may be clearer), else the top photo's header
    store: parts.find((p) => p.storeHints.chain)?.store || parts.find((p) => p.storeHints.tin || p.date)?.store || parts.find((p) => p.store)?.store || '',
    storeHints: { tin: parts.map((p) => p.storeHints.tin).find(Boolean) || '', header: parts.find((p) => p.storeHints.header)?.storeHints.header || '' },
    date,
    total: round(total ?? sum, 2),
    totalGuessed: total === null && lines.length > 0,
    itemsCount: parts.map((p) => p.itemsCount).find((n) => n) ?? null,
    lines,
  };
}

const samePrice = (a, b) => Math.abs(a.line_total - b.line_total) < 0.011;
// For lining photos up: equal, or one digit apart ("141.59" vs "141.50",
// "198.25" vs "108.25") - the same printed price read twice with one slip.
function nearPrice(a, b) {
  if (samePrice(a, b)) return true;
  const x = a.line_total.toFixed(2);
  const y = b.line_total.toFixed(2);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let k = 0; k < x.length; k++) if (x[k] !== y[k] && ++diff > 1) return false;
  return true;
}
// Judged on the product as printed, not the expanded name ("Oishi Salted Egg Chips"
// is longer than "OKI SLT ECGS" but was read no better).
const quality = (l) => ((l.printed ?? l.name).match(/[a-z]/gi) || []).length + (l.barcode ? 12 : 0) - (l.check ? 4 : 0);
const better = (x, y) => (quality(y) > quality(x) ? y : x);

// Longest in-order run of equal prices between two photos (like a text diff).
function alignPrices(a, b) {
  const L = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      L[i][j] = nearPrice(a[i], b[j]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    }
  }
  const pairs = [];
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    if (nearPrice(a[i], b[j]) && L[i][j] === L[i + 1][j + 1] + 1) { pairs.push([i, j]); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++;
  }
  return pairs;
}

// How photo b relates to photo a: 'inside' (b is all within a), 'after' (b
// continues a), 'before' (b comes first) or null (no real overlap).
// A run of equal prices only counts if it is dense - scattered matches of
// common prices (60.00, 25.00) between unrelated parts mean nothing.
export function relate(a, b) {
  const pairs = alignPrices(a, b);
  const same = (x, y) => (x.barcode && x.barcode === y.barcode) || (x.printed ?? x.name).toLowerCase() === (y.printed ?? y.name).toLowerCase();
  // a single shared line counts only when it is plainly the same line, exactly
  // where one photo ends and the next begins
  if (pairs.length === 1) {
    const [i, j] = pairs[0];
    if (!same(a[i], b[j])) return null;
    if (i === a.length - 1 && j === 0) return { kind: 'after', pairs };
    if (j === b.length - 1 && i === 0) return { kind: 'before', pairs };
    return null;
  }
  if (pairs.length < 2) return null;
  const spanA = pairs[pairs.length - 1][0] - pairs[0][0] + 1;
  const spanB = pairs[pairs.length - 1][1] - pairs[0][1] + 1;
  if (pairs.length < 0.4 * Math.max(spanA, spanB)) return null; // not a dense block
  if (pairs.length < 3 && !pairs.every(([i, j]) => same(a[i], b[j]))) return null;
  const edge = 6; // lines lost at a photo's cut edge
  const headB = pairs[0][1];
  const tailB = b.length - 1 - pairs[pairs.length - 1][1];
  const headA = pairs[0][0];
  const tailA = a.length - 1 - pairs[pairs.length - 1][0];
  if (headB <= edge && tailB <= edge) return { kind: 'inside', pairs };
  if (headA <= edge && tailA <= edge) return { kind: 'contains', pairs };
  if (tailA <= edge && headB <= edge) return { kind: 'after', pairs };
  if (tailB <= edge && headA <= edge) return { kind: 'before', pairs };
  return null;
}

// Name likeness, 0..1 (shared letter pairs): "NESTLE NONFATMLK1L" vs "Fe." ~ 0.
function likeness(x, y) {
  const grams = (s) => { const t = s.toUpperCase().replace(/[^A-Z0-9]/g, ''); const g = new Set(); for (let k = 0; k < t.length - 1; k++) g.add(t.slice(k, k + 2)); return g; };
  const a = grams(x.receipt_text || x.name);
  const b = grams(y.receipt_text || y.name);
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const g of a) if (b.has(g)) n++;
  return (2 * n) / (a.size + b.size);
}
const sameLine = (x, y) => nearPrice(x, y) || likeness(x, y) >= 0.45 || (x.barcode && x.barcode === y.barcode);

// Join two photos that overlap, `second` continuing (or sitting inside) `first`.
// Lines between matched prices were read in both photos: pair them by name or
// price and keep the cleaner copy. A line only one photo has is kept when it
// is a readable line and resembles nothing nearby in the other photo (so it is
// a line the other photo missed, not a garbled second copy).
function weave(first, second, pairs) {
  const out = [];
  const settle = (as, bs) => {
    const usedB = new Set();
    const merged = [];
    for (const x of as) {
      const k = bs.findIndex((y, idx) => !usedB.has(idx) && sameLine(x, y));
      if (k >= 0) { usedB.add(k); merged.push(better(x, bs[k])); } else merged.push(x);
    }
    const leftovers = bs.filter((_, idx) => !usedB.has(idx));
    // keep a leftover only if it is a real-looking line not echoed on the other side
    for (const y of leftovers) {
      const letters = ((y.printed ?? y.name).match(/[a-z]/gi) || []).length;
      const echoed = as.some((x) => likeness(x, y) >= 0.3);
      if (letters >= 4 && !echoed) merged.push(y);
      else if (!as.length && letters >= 4) merged.push(y);
    }
    // unmatched lines from `as` with no letters are junk from a cut edge
    return merged.filter((l) => ((l.printed ?? l.name).match(/[a-z]/gi) || []).length >= 3 || l.barcode);
  };
  let i = 0;
  let j = 0;
  for (const [pi, pj] of pairs) {
    out.push(...settle(first.slice(i, pi), second.slice(j, pj)));
    out.push(better(first[pi], second[pj]));
    i = pi + 1;
    j = pj + 1;
  }
  // after the last match: the overlap continues for a few lines, then only
  // `second` (if it continues) or only `first` (if second sat inside it) remains
  const ta = first.slice(i);
  const tb = second.slice(j);
  const n = Math.min(ta.length, tb.length, 6);
  out.push(...settle(ta.slice(0, n), tb.slice(0, n)));
  out.push(...ta.slice(n), ...tb.slice(n));
  return out;
}

export function joinPhotos(photos) {
  let parts = photos.filter((p) => p.length);
  if (parts.length < 2) return parts[0]?.slice() || [];
  // Repeatedly join the two photos with the strongest overlap.
  for (;;) {
    let best = null;
    for (let x = 0; x < parts.length; x++) {
      for (let y = 0; y < parts.length; y++) {
        if (x === y) continue;
        const r = relate(parts[x], parts[y]);
        if (r && (!best || r.pairs.length > best.r.pairs.length)) best = { x, y, r };
      }
    }
    if (!best) break;
    const { x, y, r } = best;
    const a = parts[x];
    const b = parts[y];
    let joined;
    if (r.kind === 'after' || r.kind === 'inside') joined = weave(a, b, r.pairs);
    else joined = weave(b, a, r.pairs.map(([i, j]) => [j, i])); // b first, or b holds a
    parts = parts.filter((_, k) => k !== x && k !== y);
    parts.splice(Math.min(x, y), 0, joined);
  }
  return parts.flat(); // photos that overlap nothing: kept in the order picked
}

// Mark lines that look like the same purchase twice (same barcode, or same name
// and price) - a leftover from overlapping photos. Shops print a real repeat as
// "2 x", so these come in unticked with a note, one tick away if it was real.
function flagRepeats(lines) {
  const seen = new Set();
  return lines.map((l) => {
    const key = l.barcode ? `b${l.barcode}` : `n${l.name.toLowerCase().replace(/[^a-z0-9]/g, '')}|${l.line_total}`;
    if (l.skip || !seen.has(key)) { seen.add(key); return l; }
    return { ...l, duplicate: true };
  });
}

// Kept for older callers/tests: join photos given in reading order.
export function mergeLines(prev, next) {
  return joinPhotos([prev, next]);
}

// Express a receipt quantity in the pantry item's unit: "FC MILK 2L" x1 against
// a pantry item in L is 2 L; 0.856 kg against an item in g is 856 g.
function fitQty(name, qty, unit, itemUnit) {
  const direct = convertQty(qty, unit, itemUnit);
  if (unit !== 'pcs' && direct !== null) return direct;
  const size = packQty(name, itemUnit);
  return size ? round(qty * size) : qty;
}
