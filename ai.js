// Photo reading: shrinks a photo in the browser, sends it to Claude with a
// JSON schema, and returns the structured result. Loaded on demand so the
// rest of the app works offline.

import Anthropic from 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.3.0/+esm';
import { CATEGORIES, UNITS, LOCATIONS } from './store.js';

const MODEL = 'claude-opus-5-5';
const MAX_EDGE = 1568; // Claude downsizes anything larger, so don't upload it

export class AIError extends Error {}

// File -> { block: Claude image block, preview: data URL }
export async function prepareImage(file) {
  const img = await decode(file);
  const w = img.width || img.naturalWidth;
  const h = img.height || img.naturalHeight;
  const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
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

export async function readReceipt(apiKey, images, items) {
  const prompt = `These photos show one grocery receipt (several photos = consecutive parts of a long receipt).
Extract every purchased line.

Rules:
- name: a short, generic product name a person would use on a shopping list ("Bananas", "Greek yoghurt"), not the store's abbreviation.
- qty and unit: what was bought. Weighed items use kg/g. Multi-buys ("3 @ 1.20") give qty 3.
- If a line matches an item already in the pantry below, set match_id to its id and express qty in that item's unit (e.g. a 2 L milk bottle against a pantry item measured in L is qty 2).
- skip = true for discounts, loyalty savings, bag charges, deposits, rounding, tax summaries, and anything that is not a product.
- total is the final amount paid. If a value is unreadable, make your best estimate from the other numbers.

Pantry (id | name | unit | category):
${pantryIndex(items)}`;
  return call(apiKey, images, prompt, RECEIPT_SCHEMA);
}

export async function readItems(apiKey, images, items) {
  const prompt = `These photos show groceries (on a bench, in a fridge, or on a shelf). List each distinct product you can identify.

Rules:
- name: short generic name ("Peanut butter"); put the brand in brand and pack size in size.
- qty and unit: count what is visible. Use pcs/pack/bottle/can/box/bag for packaged goods; only use kg/g/L/mL when the product is loose.
- If a product matches an item already in the pantry below, set match_id to its id and express qty in that item's unit.
- location: where it is normally stored once put away.
- Only list things you can actually see; do not guess hidden items.

Pantry (id | name | unit | category):
${pantryIndex(items)}`;
  return call(apiKey, images, prompt, ITEMS_SCHEMA);
}

async function call(apiKey, images, prompt, schema) {
  if (!apiKey) throw new AIError('Add your Anthropic API key in Settings to scan photos.');
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
    throw toAIError(err);
  }

  if (res.stop_reason === 'refusal') throw new AIError('Claude declined to read this photo. Try a clearer shot.');
  if (res.stop_reason === 'max_tokens') throw new AIError('The receipt was too long to read in one go. Try splitting it into two scans.');
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  try {
    return JSON.parse(text);
  } catch {
    throw new AIError('Claude returned something unreadable. Please try again.');
  }
}

function toAIError(err) {
  if (err instanceof Anthropic.AuthenticationError) return new AIError('Your API key was rejected. Check it in Settings.');
  if (err instanceof Anthropic.PermissionDeniedError) return new AIError('This API key is not allowed to use that model.');
  if (err instanceof Anthropic.RateLimitError) return new AIError('Too many requests right now. Wait a minute and try again.');
  if (err instanceof Anthropic.BadRequestError) return new AIError(`Request rejected: ${err.message}`);
  if (err instanceof Anthropic.APIConnectionError) return new AIError('Could not reach Anthropic. Check your internet connection.');
  if (err instanceof Anthropic.APIError) return new AIError(`Anthropic error (${err.status ?? '?'}): ${err.message}`);
  return new AIError(err?.message || String(err));
}
