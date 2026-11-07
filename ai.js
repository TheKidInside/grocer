// Photo reading: shrinks a photo in the browser, sends it with a JSON schema to
// the chosen reader (Claude via Anthropic, or Qwen on a local llama.cpp server),
// and returns the structured result. Loaded on demand so the rest of the app
// works offline.

import { CATEGORIES, UNITS, LOCATIONS } from './store.js';
import { cleanForText } from './textprep.js';

const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.3.0/+esm';
const MODEL = 'claude-opus-5-5';
const MAX_EDGE = 1568; // Claude downsizes anything larger, so don't upload it

export class AIError extends Error {}

// File -> { block: Claude image block, preview: data URL }
// forText: prepare for on-device text reading instead - enlarge narrow photos so
// letters are big enough, straighten and turn black/white (textprep.js).
export async function prepareImage(file, maxEdge = MAX_EDGE, { forText = false } = {}) {
  const img = await decode(file);
  const w = img.width || img.naturalWidth;
  const h = img.height || img.naturalHeight;
  const fit = maxEdge / Math.max(w, h);
  const scale = Math.min(1, fit); // forText: textprep.js crops and resizes the paper itself
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  const out = forText ? cleanForText(canvas) : canvas;
  const dataUrl = forText ? out.toDataURL('image/png') : out.toDataURL('image/jpeg', 0.85);
  if (out !== canvas) { out.width = 0; out.height = 0; }
  // Free the full-size decode and the canvas backing store straight away (iOS memory).
  img.close?.();
  canvas.width = 0;
  canvas.height = 0;
  return {
    preview: dataUrl,
    block: { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: dataUrl.split(',')[1] } },
  };
}

async function decode(file) {
  try {
    return await createImageBitmap(file);
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } catch {
      throw new AIError('That file could not be opened as an image. Try a JPEG or PNG photo.');
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }
}

function pantryIndex(items) {
  if (!items.length) return '(pantry is empty)';
  return items.map((i) => `${i.id} | ${i.name} | ${i.unit} | ${i.category}`).join('\n');
}

const str = { type: 'string' };
const numT = { type: 'number' };
const obj = (properties) => ({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});

const RECEIPT_SCHEMA = obj({
  store: str,
  date: { type: 'string', description: 'Purchase date as YYYY-MM-DD, or empty string if not printed' },
  total: { type: 'number', description: 'Final amount paid, after discounts and tax' },
  lines: {
    type: 'array',
    items: obj({
      receipt_text: { type: 'string', description: 'The line exactly as printed' },
      name: { type: 'string', description: 'Plain generic product name, e.g. "Full cream milk"' },
      category: { type: 'string', enum: CATEGORIES },
      qty: { type: 'number', description: 'Quantity in the chosen unit' },
      unit: { type: 'string', enum: UNITS },
      line_total: { type: 'number', description: 'Amount charged for this line; negative for discounts' },
      match_id: { type: 'string', description: 'id of the matching pantry item, or empty string' },
      skip: { type: 'boolean', description: 'true for discounts, deposits, bags, fees and non-product lines' },
    }),
  },
});

const ITEMS_SCHEMA = obj({
  items: {
    type: 'array',
    items: obj({
      name: { type: 'string', description: 'Plain generic product name' },
      brand: str,
      size: { type: 'string', description: 'Pack size as printed, e.g. "2 L" or "500 g", or empty' },
      category: { type: 'string', enum: CATEGORIES },
      location: { type: 'string', enum: LOCATIONS },
      qty: { type: 'number', description: 'How many are visible, in the chosen unit' },
      unit: { type: 'string', enum: UNITS },
      expires: { type: 'string', description: 'Best-before / use-by date as YYYY-MM-DD if legible, else empty' },
      match_id: { type: 'string', description: 'id of the matching pantry item, or empty string' },
    }),
  },
});

export async function readReceipt(settings, images, items) {
  const prompt = `These photos show one grocery receipt (several photos = consecutive parts of a long receipt).
Extract every purchased line.

Rules:
- name: a short, generic product name a person would use on a shopping list ("Bananas", "Greek yoghurt"), not the store's abbreviation.
- qty and unit: what was bought. Weighed items use kg/g.
- A quantity line printed under a product belongs to that product: "2 @ $2.50" means qty 2, "0.856 kg @ $3.90/kg" means qty 0.856 kg.
- If a line matches an item already in the pantry below, set match_id to its id and express qty in that item's unit (e.g. a 2 L milk bottle against a pantry item measured in L is qty 2). If the units differ in kind (kg bought, pantry counts pcs), estimate the count (about 6 bananas per kg).
- skip = true for discounts, loyalty savings, bags of any kind (including reusable bags), deposits, rounding, tax summaries, and anything that is not food or a household product.
- total is the final amount paid. If a value is unreadable, make your best estimate from the other numbers.

Pantry (id | name | unit | category):
${pantryIndex(items)}`;
  return call(settings, images, prompt, RECEIPT_SCHEMA);
}

export async function readItems(settings, images, items) {
  const prompt = `These photos show groceries (on a bench, in a fridge, or on a shelf). List each distinct product you can identify.

Rules:
- name: short generic name ("Peanut butter"); put the brand in brand and pack size in size.
- qty and unit: count what is visible. Use pcs/pack/bottle/can/box/bag for packaged goods; only use kg/g/L/mL when the product is loose.
- If a product matches an item already in the pantry below, set match_id to its id and express qty in that item's unit.
- location: where it is normally stored once put away.
- Only list things you can actually see; do not guess hidden items.

Pantry (id | name | unit | category):
${pantryIndex(items)}`;
  return call(settings, images, prompt, ITEMS_SCHEMA);
}

function call(settings, images, prompt, schema) {
  return settings.provider === 'local'
    ? callLocal(settings.localUrl, images, prompt, schema)
    : callClaude(settings.apiKey, images, prompt, schema);
}

function parseJson(text, who) {
  try {
    return JSON.parse(text);
  } catch {
    throw new AIError(`${who} returned something unreadable. Please try again.`);
  }
}

// ---------- Qwen on a local llama.cpp server (OpenAI-compatible API) ----------

async function callLocal(url, images, prompt, schema) {
  const base = String(url || '').trim().replace(/\/+$/, '').replace(/\/v1$/, '');
  if (!base) throw new AIError('Set the Qwen server address in Settings (e.g. http://127.0.0.1:8080).');
  let res;
  try {
    res = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{
          role: 'user',
          content: [...images.map((i) => ({ type: 'image_url', image_url: { url: i.preview } })), { type: 'text', text: prompt }],
        }],
        // llama.cpp turns the schema into a grammar, so the reply always parses.
        response_format: { type: 'json_schema', json_schema: { name: 'result', strict: true, schema } },
        chat_template_kwargs: { enable_thinking: false },
        temperature: 0.1,
        max_tokens: 8192,
      }),
    });
  } catch {
    throw new AIError(`Could not reach Qwen at ${base}. Check that start-qwen is running on this PC, and that this site is allowed `
      + '"Local network access" (click the icon left of the address bar). A phone can\'t reach it.');
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (/image|mmproj|multimodal/i.test(body)) {
      throw new AIError('This Qwen server cannot see images. Start it with the vision file (--mmproj); see the README.');
    }
    throw new AIError(`Qwen server error (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const choice = data.choices?.[0];
  if (choice?.finish_reason === 'length') throw new AIError('The receipt was too long for Qwen in one go. Try splitting it into two scans.');
  return parseJson(choice?.message?.content || '', 'Qwen');
}

// ---------- Claude via the Anthropic API ----------

async function callClaude(apiKey, images, prompt, schema) {
  if (!apiKey) throw new AIError('Add your Anthropic API key in Settings to scan photos.');
  let Anthropic;
  try {
    ({ default: Anthropic } = await import(SDK_URL));
  } catch {
    throw new AIError('Could not load the Anthropic library. Check your internet connection.');
  }
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
  const base = {
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
    messages: [{ role: 'user', content: [...images.map((i) => i.block), { type: 'text', text: prompt }] }],
  };

  let res;
  try {
    try {
      // Server-side fallback: if the request is declined, the API retries it on another model.
      res = await client.beta.messages.create({ ...base, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
    } catch (err) {
      if (!(err instanceof Anthropic.BadRequestError)) throw err;
      res = await client.messages.create(base);
    }
  } catch (err) {
    throw toAIError(Anthropic, err);
  }

  if (res.stop_reason === 'refusal') throw new AIError('Claude declined to read this photo. Try a clearer shot.');
  if (res.stop_reason === 'max_tokens') throw new AIError('The receipt was too long to read in one go. Try splitting it into two scans.');
  return parseJson(res.content.filter((b) => b.type === 'text').map((b) => b.text).join(''), 'Claude');
}

function toAIError(Anthropic, err) {
  if (err instanceof Anthropic.AuthenticationError) return new AIError('Your API key was rejected. Check it in Settings.');
  if (err instanceof Anthropic.PermissionDeniedError) return new AIError('This API key is not allowed to use that model.');
  if (err instanceof Anthropic.RateLimitError) return new AIError('Too many requests right now. Wait a minute and try again.');
  if (err instanceof Anthropic.BadRequestError) return new AIError(`Request rejected: ${err.message}`);
  if (err instanceof Anthropic.APIConnectionError) return new AIError('Could not reach Anthropic. Check your internet connection.');
  if (err instanceof Anthropic.APIError) return new AIError(`Anthropic error (${err.status ?? '?'}): ${err.message}`);
  return new AIError(err?.message || String(err));
}
