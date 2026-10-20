// GET  /api/lists -> { data, etag }
// PUT  /api/lists  (If-Match: <etag> | "none") body: { data } -> { data, etag }
//      409 { data, etag } when the stored document changed since <etag>.
// All requests require "Authorization: Bearer <APP_PASSCODE>".

import { timingSafeEqual } from 'node:crypto';
import { get, put, BlobPreconditionFailedError } from '@vercel/blob';

const PATHNAME = 'lists.json';
const CATEGORIES = ['books', 'comics', 'movies', 'shows', 'albums'];
const MAX_BYTES = 1_000_000;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

function authorized(request) {
  const expected = process.env.APP_PASSCODE;
  if (!expected) return false;
  const header = request.headers.get('authorization') || '';
  const given = header.startsWith('Bearer ') ? header.slice(7) : '';
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function emptyData() {
  return Object.fromEntries(CATEGORIES.map((c) => [c, []]));
}

// Accept only the expected shape; drop anything else.
function sanitize(input) {
  const out = emptyData();
  if (!input || typeof input !== 'object') return out;
  for (const cat of CATEGORIES) {
    const items = Array.isArray(input[cat]) ? input[cat] : [];
    out[cat] = items
      .filter((i) => i && typeof i.id === 'string' && typeof i.text === 'string')
      .map((i) => {
        const item = { id: i.id.slice(0, 64), text: i.text.slice(0, 500), done: i.done === true };
        if (item.done && Number.isFinite(i.doneAt)) item.doneAt = i.doneAt;
        return item;
      });
  }
  return out;
}

async function readDoc() {
  const result = await get(PATHNAME, { access: 'private', useCache: false });
  if (!result || result.statusCode !== 200) return { data: emptyData(), etag: null };
  const text = await new Response(result.stream).text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch (_) {}
  return { data: sanitize(parsed), etag: result.blob.etag };
}

export async function GET(request) {
  if (!authorized(request)) return json({ error: 'unauthorized' }, 401);
  return json(await readDoc());
}

export async function PUT(request) {
  if (!authorized(request)) return json({ error: 'unauthorized' }, 401);

  const ifMatch = request.headers.get('if-match');
  if (!ifMatch) return json({ error: 'If-Match header required' }, 428);

  const raw = await request.text();
  if (raw.length > MAX_BYTES) return json({ error: 'payload too large' }, 413);
  let body;
  try { body = JSON.parse(raw); } catch (_) { return json({ error: 'invalid JSON' }, 400); }

  const data = sanitize(body && body.data);
  const options = {
    access: 'private',
    contentType: 'application/json',
    addRandomSuffix: false,
    cacheControlMaxAge: 60,
  };
  if (ifMatch === 'none') {
    // First write: refuse if a document already exists.
    const current = await readDoc();
    if (current.etag) return json(current, 409);
    options.allowOverwrite = false;
  } else {
    options.allowOverwrite = true;
    options.ifMatch = ifMatch;
  }

  try {
    const blob = await put(PATHNAME, JSON.stringify(data), options);
    return json({ data, etag: blob.etag });
  } catch (err) {
    const exists = err && /already exists/i.test(String(err.message));
    if (err instanceof BlobPreconditionFailedError || exists) {
      return json(await readDoc(), 409);
    }
    console.error(err);
    return json({ error: 'write failed' }, 500);
  }
}
