// Barcode scanning with the phone camera + product lookup in Open Food Facts
// (a free, open product database: no account, no key, no AI).

const ZXING_URL = 'https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/umd/zxing-browser.min.js';
const PRODUCT_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];
// Rear camera, sharp enough for small barcodes, refocusing continuously where supported.
const CAMERA = {
  facingMode: { ideal: 'environment' },
  width: { ideal: 1920 },
  height: { ideal: 1080 },
  advanced: [{ focusMode: 'continuous' }],
};

// GTIN check digit: rejects misreads and non-product codes (QR, loyalty cards).
export function validGtin(code) {
  if (!/^(\d{8}|\d{12,14})$/.test(code)) return false;
  if (code.length === 8 && code[0] === '0' && upcEtoA(code) && checkDigitOk(upcEtoA(code))) return true; // UPC-E
  return checkDigitOk(code);
}

function checkDigitOk(code) {
  const digits = code.split('').map(Number);
  const check = digits.pop();
  const sum = digits.reverse().reduce((t, d, i) => t + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

// UPC-E (8 digits, compressed) -> UPC-A (12 digits), whose check digit it shares.
function upcEtoA(e) {
  const [ns, d1, d2, d3, d4, d5, d6, check] = e.split('');
  let body;
  if ('012'.includes(d6)) body = `${d1}${d2}${d6}0000${d3}${d4}${d5}`;
  else if (d6 === '3') body = `${d1}${d2}${d3}00000${d4}${d5}`;
  else if (d6 === '4') body = `${d1}${d2}${d3}${d4}00000${d5}`;
  else body = `${d1}${d2}${d3}${d4}${d5}0000${d6}`;
  return `${ns}${body}${check}`;
}

function loadZxing() {
  if (globalThis.ZXingBrowser) return Promise.resolve(globalThis.ZXingBrowser);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = ZXING_URL;
    s.onload = () => resolve(globalThis.ZXingBrowser);
    s.onerror = () => reject(new Error('Could not load the barcode reader. Check your internet connection.'));
    document.head.appendChild(s);
  });
}

// Starts the rear camera in <video> and calls onCode(text) for each code seen.
// Returns stop(). Uses the browser's own detector where it exists (Android
// Chrome), else the ZXing library (iPhone Safari).
export async function startScanner(video, onCode) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser cannot open the camera here. Type the number instead.');
  if ('BarcodeDetector' in globalThis) {
    const supported = await globalThis.BarcodeDetector.getSupportedFormats().catch(() => []);
    const formats = PRODUCT_FORMATS.filter((f) => supported.includes(f));
    if (formats.length) {
      const stream = await navigator.mediaDevices.getUserMedia({ video: CAMERA, audio: false });
      try {
        video.srcObject = stream;
        await video.play();
      } catch (err) {
        stream.getTracks().forEach((t) => t.stop());
        video.srcObject = null;
        throw err;
      }
      const detector = new globalThis.BarcodeDetector({ formats });
      let busy = false;
      const timer = setInterval(async () => {
        if (busy || video.readyState < 2) return;
        busy = true;
        try {
          const codes = await detector.detect(video);
          if (codes[0]) onCode(codes[0].rawValue);
        } catch { /* frame not ready */ }
        busy = false;
      }, 250);
      return () => {
        clearInterval(timer);
        stream.getTracks().forEach((t) => t.stop());
        video.srcObject = null;
      };
    }
  }
  const ZX = await loadZxing();
  const reader = new ZX.BrowserMultiFormatReader();
  const controls = await reader.decodeFromConstraints(
    { video: CAMERA, audio: false },
    video,
    (result) => { if (result) onCode(result.getText()); },
  );
  return () => controls.stop();
}

// -> { status: 'found', name, brand, size, tags } | { status: 'missing' } | { status: 'error' }
export async function lookupProduct(code) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=product_name,product_name_en,generic_name,brands,quantity,categories_tags`,
      { signal: ctrl.signal },
    );
    if (res.status === 404) return { status: 'missing' };
    if (!res.ok) return { status: 'error' };
    const data = await res.json();
    const p = data.product;
    if (data.status !== 1 || !p) return { status: 'missing' };
    const name = (p.product_name_en || p.product_name || p.generic_name || '').trim();
    if (!name) return { status: 'missing' };
    return {
      status: 'found',
      name,
      brand: String(p.brands || '').split(',')[0].trim(),
      size: String(p.quantity || '').trim(),
      tags: (p.categories_tags || []).map((t) => t.replace(/^[a-z]{2}:/, '')).join(' '),
    };
  } catch {
    return { status: 'error' };
  } finally {
    clearTimeout(timer);
  }
}
