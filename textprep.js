// Clean a receipt photo before on-device text reading:
//   1. straighten it (find the tilt where text rows line up best),
//   2. turn it into black text on white, judging each pixel against its own
//      neighbourhood, so shadows, uneven light and grey thermal print all work.
// Pure canvas maths, no libraries.

// canvas (any size) -> new canvas, straightened and black/white.
export function cleanForText(src) {
  const angle = findSkew(src);
  const rotated = rotate(src, angle);
  return binarize(rotated);
}

function greyOf(ctx, w, h) {
  const px = ctx.getImageData(0, 0, w, h).data;
  const g = new Uint8ClampedArray(w * h);
  for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = (px[i] * 77 + px[i + 1] * 150 + px[i + 2] * 29) >> 8;
  return g;
}

// Projection-profile skew: on a small copy, mark "ink" pixels, then try angles
// and keep the one whose rotated rows are most uneven (text rows vs gaps).
function findSkew(src) {
  const scale = Math.min(1, 500 / src.width);
  const w = Math.max(1, Math.round(src.width * scale));
  const h = Math.max(1, Math.round(src.height * scale));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, 0, 0, w, h);
  const ink = adaptiveInk(greyOf(ctx, w, h), w, h, Math.max(8, Math.round(w / 16)), 0.85);
  const xs = [];
  const ys = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (ink[y * w + x]) { xs.push(x); ys.push(y); }
  if (xs.length < 50) return 0;
  let best = 0;
  let bestScore = -1;
  const rows = new Float64Array(h * 2 + w * 2);
  for (let deg = -12; deg <= 12; deg += 0.5) {
    const t = (deg * Math.PI) / 180;
    const sin = Math.sin(t);
    const cos = Math.cos(t);
    rows.fill(0);
    for (let i = 0; i < xs.length; i++) rows[Math.round(ys[i] * cos - xs[i] * sin) + w] += 1;
    let score = 0;
    for (let r = 0; r < rows.length; r++) score += rows[r] * rows[r];
    if (score > bestScore) { bestScore = score; best = deg; }
  }
  return best;
}

function rotate(src, deg) {
  if (!deg) return src;
  const t = (deg * Math.PI) / 180;
  const w = src.width;
  const h = src.height;
  const nw = Math.round(Math.abs(w * Math.cos(t)) + Math.abs(h * Math.sin(t)));
  const nh = Math.round(Math.abs(w * Math.sin(t)) + Math.abs(h * Math.cos(t)));
  const c = document.createElement('canvas');
  c.width = nw;
  c.height = nh;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, nw, nh);
  ctx.translate(nw / 2, nh / 2);
  ctx.rotate(-t);
  ctx.drawImage(src, -w / 2, -h / 2);
  return c;
}

// 1 = ink: darker than `ratio` x the mean of its (2r+1)^2 neighbourhood (integral image).
function adaptiveInk(g, w, h, r, ratio) {
  const sum = new Uint32Array((w + 1) * (h + 1)); // max 255 x 16M px fits
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += g[y * w + x];
      sum[(y + 1) * (w + 1) + x + 1] = sum[y * (w + 1) + x + 1] + row;
    }
  }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      const area = (y1 - y0) * (x1 - x0);
      const s = sum[y1 * (w + 1) + x1] - sum[y0 * (w + 1) + x1] - sum[y1 * (w + 1) + x0] + sum[y0 * (w + 1) + x0];
      out[y * w + x] = g[y * w + x] < (s / area) * ratio ? 1 : 0;
    }
  }
  return out;
}

function binarize(src) {
  const w = src.width;
  const h = src.height;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, 0, 0);
  const ink = adaptiveInk(greyOf(ctx, w, h), w, h, Math.max(10, Math.round(w / 40)), 0.88);
  const img = ctx.createImageData(w, h);
  for (let i = 0, j = 0; j < ink.length; i += 4, j++) {
    const v = ink[j] ? 0 : 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
