// Shelf-tag photos: the price tag is a small white sticker in a busy photo of
// packaging, which the text reader can't make sense of as a whole. So first find
// the tag and cut it out, enlarged, for the reader. Two ways to find it:
//   - its barcode (findBarcodes): a tight block of thin vertical bars, the most
//     distinctive thing on a shelf; the name sits above it and the price beside it;
//   - a white, roughly rectangular patch with dark print (findTags), for tags
//     whose barcode is blurred.
// Pure canvas work; no AI.

const WORK = 480; // long edge of the low-res copy the white-patch search runs on
const BAR_WORK = 1100; // barcode bars need more pixels to stay apart

function greyAt(canvas, maxEdge) {
  const scale = Math.min(1, maxEdge / Math.max(canvas.width, canvas.height));
  const w = Math.max(1, Math.round(canvas.width * scale));
  const h = Math.max(1, Math.round(canvas.height * scale));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(canvas, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  c.width = 0;
  const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
  return { g, w, h, scale };
}

// Box blur via an integral image: mean of the (2r+1)^2 square around each pixel.
function blur(src, w, h, r) {
  const sum = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += src[y * w + x];
      sum[(y + 1) * (w + 1) + x + 1] = sum[y * (w + 1) + x + 1] + row;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      out[y * w + x] = (sum[y1 * (w + 1) + x1] - sum[y0 * (w + 1) + x1] - sum[y1 * (w + 1) + x0] + sum[y0 * (w + 1) + x0]) / ((y1 - y0) * (x1 - x0));
    }
  }
  return out;
}

// canvas -> barcode boxes in the canvas's own pixels, best first: [{ x, y, w, h, score }].
// Bars make strong left-right brightness changes and almost no up-down ones;
// letters and pictures make both. Where that difference is dense, and a line
// across the middle crosses many dark/light edges, there's a barcode.
export function findBarcodes(canvas, max = 3) {
  const { g, w, h, scale } = greyAt(canvas, BAR_WORK);
  const diff = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = (g[i + 1 - w] + 2 * g[i + 1] + g[i + 1 + w]) - (g[i - 1 - w] + 2 * g[i - 1] + g[i - 1 + w]);
      const gy = (g[i + w - 1] + 2 * g[i + w] + g[i + w + 1]) - (g[i - w - 1] + 2 * g[i - w] + g[i - w + 1]);
      diff[i] = Math.max(0, Math.abs(gx) - Math.abs(gy));
    }
  }
  const r = Math.max(4, Math.round(w / 110));
  const soft = blur(diff, w, h, r);
  let peak = 0;
  for (const v of soft) if (v > peak) peak = v;
  if (!peak) return [];
  const on = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) on[i] = soft[i] >= peak * 0.35 ? 1 : 0;

  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const found = [];
  for (let start = 0; start < w * h; start++) {
    if (!on[start] || seen[start]) continue;
    let top = 0, area = 0, x0 = w, y0 = h, x1 = 0, y1 = 0, energy = 0;
    stack[top++] = start;
    seen[start] = 1;
    while (top) {
      const i = stack[--top];
      const x = i % w, y = (i - x) / w;
      area++;
      energy += soft[i];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && on[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; stack[top++] = i - 1; }
      if (x < w - 1 && on[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; stack[top++] = i + 1; }
      if (y > 0 && on[i - w] && !seen[i - w]) { seen[i - w] = 1; stack[top++] = i - w; }
      if (y < h - 1 && on[i + w] && !seen[i + w]) { seen[i + w] = 1; stack[top++] = i + w; }
    }
    // the blur grew the region by r on each side
    x0 = Math.min(w - 1, x0 + r); x1 = Math.max(x0, x1 - r); y0 = Math.min(h - 1, y0 + r); y1 = Math.max(y0, y1 - r);
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    if (bw < 20 || bh < 8 || bw / bh > 6 || bh / bw > 2.5) continue;
    // Edges along three lines across the box: a barcode has dozens, evenly.
    let edges = 0;
    for (const f of [0.3, 0.5, 0.7]) {
      const y = Math.round(y0 + bh * f);
      const row = [];
      for (let x = x0; x <= x1; x++) row.push(g[y * w + x]);
      const mid = (Math.max(...row) + Math.min(...row)) / 2;
      for (let k = 1; k < row.length; k++) if ((row[k] < mid) !== (row[k - 1] < mid)) edges++;
    }
    edges /= 3;
    if (edges < 16) continue;
    found.push({ x: x0 / scale, y: y0 / scale, w: bw / scale, h: bh / scale, score: (energy / area) * Math.min(1, edges / 40) * Math.sqrt(area) });
  }
  return found.sort((a, b) => b.score - a.score).slice(0, max);
}

// The price on a cleaned (black on white) tag: the tallest row of characters.
// Shelf tags print it several times taller than the name, so find dark blobs
// shaped like digits, keep the tallest group that shares a baseline, and split
// it where the gap before the cents is ("120 .00"). -> { box, groups } | null,
// groups = [[x0, x1], ...] left to right, in the canvas's pixels.
export function findPrice(canvas) {
  const w = canvas.width, h = canvas.height;
  const px = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const ink = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) ink[i] = px[i * 4] < 128 ? 1 : 0;
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const blobs = [];
  for (let start = 0; start < w * h; start++) {
    if (!ink[start] || seen[start]) continue;
    let top = 0, area = 0, x0 = w, y0 = h, x1 = 0, y1 = 0;
    stack[top++] = start;
    seen[start] = 1;
    while (top) {
      const i = stack[--top];
      const x = i % w, y = (i - x) / w;
      area++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && ink[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; stack[top++] = i - 1; }
      if (x < w - 1 && ink[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; stack[top++] = i + 1; }
      if (y > 0 && ink[i - w] && !seen[i - w]) { seen[i - w] = 1; stack[top++] = i - w; }
      if (y < h - 1 && ink[i + w] && !seen[i + w]) { seen[i + w] = 1; stack[top++] = i + w; }
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    // digit-shaped: taller than wide, not a sliver, not the black surround of the sticker
    if (x0 === 0 || y0 === 0 || x1 === w - 1 || y1 === h - 1) continue;
    if (bh < h * 0.12 || bh > h * 0.75 || bh / bw < 1.1 || bh / bw > 6 || area / (bw * bh) < 0.15) continue;
    blobs.push({ x0, x1, y0, y1, h: bh });
  }
  // Group blobs of about the same height whose vertical spans overlap (one row of print).
  let best = null;
  for (const a of blobs) {
    const row = blobs.filter((b) => Math.abs(b.h - a.h) <= a.h * 0.25 && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) >= a.h * 0.5);
    const score = row.length * a.h;
    if (row.length >= 2 && (!best || score > best.score)) best = { row, score, h: a.h };
  }
  if (!best) return null;
  const row = best.row.sort((a, b) => a.x0 - b.x0);
  const groups = [[row[0].x0, row[0].x1]];
  for (const b of row.slice(1)) {
    const g = groups[groups.length - 1];
    if (b.x0 - g[1] > best.h * 0.35) groups.push([b.x0, b.x1]); else g[1] = Math.max(g[1], b.x1);
  }
  const y0 = Math.min(...row.map((b) => b.y0)), y1 = Math.max(...row.map((b) => b.y1));
  const m = Math.round(best.h * 0.15);
  return {
    box: { x: Math.max(0, row[0].x0 - m), y: Math.max(0, y0 - m), w: Math.min(w, row[row.length - 1].x1 + m) - Math.max(0, row[0].x0 - m), h: Math.min(h, y1 + m) - Math.max(0, y0 - m) },
    groups,
    digits: row.length,
    chars: row.map((b) => ({ x: b.x0, y: b.y0, w: b.x1 - b.x0 + 1, h: b.y1 - b.y0 + 1 })),
    groupOf: row.map((b) => groups.findIndex(([g0, g1]) => b.x0 >= g0 && b.x1 <= g1)),
  };
}

// Redraw the price row for the reader: each character ~70px tall, a little
// wider, with a clear gap after it. Shelf tags use condensed digits set tight,
// and the reader takes "00" for one 0 otherwise.
export function cropPrice(canvas, found) {
  const H = 70;
  const pad = 24;
  const k = H / Math.max(...found.chars.map((c) => c.h));
  const gap = Math.round(H * 0.35);
  const widths = found.chars.map((c) => Math.round(c.w * k * 1.35));
  const out = document.createElement('canvas');
  out.width = widths.reduce((t, x) => t + x + gap, pad * 2);
  out.height = H + pad * 2;
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.imageSmoothingQuality = 'high';
  let x = pad;
  found.chars.forEach((c, i) => {
    const dh = Math.round(c.h * k);
    ctx.drawImage(canvas, c.x, c.y, c.w, c.h, x, pad + (H - dh), widths[i], dh);
    x += widths[i] + gap;
  });
  return out;
}

// The tag around a barcode, for the common layout: name across the top, store
// and barcode on the left, the price to the right. Generous, so other stores'
// layouts still fit; the text reader ignores what isn't text.
export function tagAroundBarcode(canvas, bc) {
  const x = Math.max(0, bc.x - bc.w * 0.6);
  const y = Math.max(0, bc.y - bc.h * 2.4);
  const x2 = Math.min(canvas.width, bc.x + bc.w * 3.4);
  const y2 = Math.min(canvas.height, bc.y + bc.h * 1.6);
  return { x, y, w: x2 - x, h: y2 - y, score: bc.score };
}

// canvas -> candidate tag boxes in the canvas's own pixels, best first:
// [{ x, y, w, h, score }]
export function findTags(canvas, max = 3) {
  const scale = Math.min(1, WORK / Math.max(canvas.width, canvas.height));
  const w = Math.max(1, Math.round(canvas.width * scale));
  const h = Math.max(1, Math.round(canvas.height * scale));
  const small = document.createElement('canvas');
  small.width = w;
  small.height = h;
  const ctx = small.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(canvas, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  small.width = 0;

  // Brightness and "whiteness" per pixel. White is judged against the photo's
  // own brightest paper (store lighting is often dim or yellow).
  const lum = new Float32Array(w * h);
  const sat = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
    lum[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    sat[i] = Math.max(r, g, b) - Math.min(r, g, b);
  }
  const sorted = Float32Array.from(lum).sort();
  const bright = sorted[Math.floor(sorted.length * 0.98)];
  const whiteMin = Math.max(120, bright * 0.78);
  const white = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) white[i] = lum[i] >= whiteMin && sat[i] <= 45 ? 1 : 0;

  // Close small gaps (text strokes cut the sticker into pieces): a pixel counts as
  // tag-ish when most of its 5x5 neighbourhood is white.
  const filled = new Uint8Array(w * h);
  const R = 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let n = 0, t = 0;
      for (let dy = -R; dy <= R; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -R; dx <= R; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          t++;
          n += white[yy * w + xx];
        }
      }
      filled[y * w + x] = n / t >= 0.5 ? 1 : 0;
    }
  }

  // Connected white patches, each scored as a possible tag.
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const found = [];
  const minArea = w * h * 0.004;
  for (let start = 0; start < w * h; start++) {
    if (!filled[start] || seen[start]) continue;
    let top = 0, area = 0, x0 = w, y0 = h, x1 = 0, y1 = 0;
    stack[top++] = start;
    seen[start] = 1;
    while (top) {
      const i = stack[--top];
      const x = i % w, y = (i - x) / w;
      area++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && filled[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; stack[top++] = i - 1; }
      if (x < w - 1 && filled[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; stack[top++] = i + 1; }
      if (y > 0 && filled[i - w] && !seen[i - w]) { seen[i - w] = 1; stack[top++] = i - w; }
      if (y < h - 1 && filled[i + w] && !seen[i + w]) { seen[i + w] = 1; stack[top++] = i + w; }
    }
    if (area < minArea) continue;
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    const fill = area / (bw * bh);
    const aspect = bw / bh;
    if (fill < 0.55 || aspect < 1.1 || aspect > 7) continue;
    // Print inside: dark pixels within the box (a blank white board has none,
    // a busy pack has colour everywhere).
    let dark = 0, colour = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * w + x;
        if (lum[i] < whiteMin * 0.55) dark++;
        if (sat[i] > 70) colour++;
      }
    }
    const darkRatio = dark / (bw * bh);
    const colourRatio = colour / (bw * bh);
    if (darkRatio < 0.03 || darkRatio > 0.5 || colourRatio > 0.25) continue;
    // Tags are wide, filled, have a fair amount of print and little colour.
    const score = Math.sqrt(area) * fill * Math.min(1, darkRatio / 0.08) * (1 - colourRatio * 2) * (aspect >= 1.4 && aspect <= 4.5 ? 1 : 0.6);
    found.push({ x: x0 / scale, y: y0 / scale, w: bw / scale, h: bh / scale, score });
  }
  return found.sort((a, b) => b.score - a.score).slice(0, max);
}

// Cut a box out of the canvas with a margin, enlarged so the small print is
// ~30px tall, in black and white. -> canvas
export function cropTag(canvas, box, targetHeight = 900) {
  const mx = box.w * 0.06, my = box.h * 0.1;
  const x = Math.max(0, box.x - mx), y = Math.max(0, box.y - my);
  const cw = Math.min(canvas.width - x, box.w + 2 * mx), ch = Math.min(canvas.height - y, box.h + 2 * my);
  const k = Math.min(4, targetHeight / ch);
  const out = document.createElement('canvas');
  out.width = Math.round(cw * k);
  out.height = Math.round(ch * k);
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, x, y, cw, ch, 0, 0, out.width, out.height);
  return out;
}

// One shelf photo -> { store, name, printed, category, price, check, preview }.
// Tries each place a tag might be (around barcodes, then white patches), reads
// them, and keeps the read with a price and the most name.
export async function readShelfPhoto(file, onProgress) {
  const [{ cleanTag }, ocr] = await Promise.all([import('./textprep.js'), import('./ocr.js')]);
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 2400 / Math.max(bmp.width, bmp.height)); // a 12 MP photo is more than the search needs
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * k);
  canvas.height = Math.round(bmp.height * k);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  const preview = canvas.toDataURL('image/jpeg', 0.7);
  const boxes = [...findBarcodes(canvas, 2).map((b) => tagAroundBarcode(canvas, b)), ...findTags(canvas, 2)];
  const tags = boxes.map((b) => {
    const crop = cropTag(canvas, b, 700);
    const clean = cleanTag(crop);
    const f = findPrice(clean);
    const priceRow = f ? cropPrice(clean, f) : null;
    const t = { text: clean.toDataURL('image/png'), price: priceRow ? priceRow.toDataURL('image/png') : null, groupOf: f?.groupOf || null };
    for (const c of [crop, clean, priceRow]) if (c) c.width = 0; // free them now (iOS memory)
    return t;
  });
  canvas.width = 0;
  const reads = tags.length ? await ocr.readTagText(tags, onProgress) : [];
  let best = null;
  let bestScore = -1;
  reads.forEach((r, i) => {
    const t = ocr.parseShelfTag(r.text, r.priceText, tags[i].groupOf);
    const score = (t.price ? (t.check ? 4 : 8) : 0) + Math.min(4, (t.printed.match(/[a-z]/gi) || []).length / 5) + (t.store ? 1 : 0);
    if (score > bestScore) { bestScore = score; best = t; }
  });
  return { ...(best || { store: '', name: '', printed: '', category: 'Pantry', price: null, check: true }), preview };
}
