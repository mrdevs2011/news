// /api/cron-news.js
// Vercel Cron: Toshkent 03:05 / 07:05 / 14:05 / 20:05 da GNews olib
// shu kungi to'plamga QO'SHADI (eski partiyani o'chirmaydi).
// Brauzer ochilishini kutmaydi.
//
// Env:
//   GNEWS_KEY          — majburiy
//   CRON_SECRET        — ixtiyoriy, lekin tavsiya etiladi
//
// Qo'lda chaqirish:
//   GET /api/cron-news
//   Header: Authorization: Bearer <CRON_SECRET>

import { createHash } from 'crypto';
import { fetchGnewsArticles } from './_gnews.js';

const PROJECT_ID = 'news-90fb9';
const FIREBASE_API_KEY = 'AIzaSyCd2WkgSdFvK3gFcRIhGxb4uHLZlKf4EmQ';
const FS_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  const vercelCron = req.headers['x-vercel-cron'] === '1';
  if (vercelCron) return true;
  if (!secret) return true;
  const hdr = String(req.headers.authorization || '');
  const q = String((req.query && req.query.secret) || '');
  return hdr === `Bearer ${secret}` || q === secret;
}

function uzNow() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tashkent',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const g = (t) => parts.find((p) => p.type === t).value;
  return {
    dateKey: `${g('year')}-${g('month')}-${g('day')}`,
    hour: Number(g('hour')),
  };
}

function currentNewsSlot() {
  const { dateKey, hour } = uzNow();
  if (hour >= 20) return { dateKey, slot: '20' };
  if (hour >= 14) return { dateKey, slot: '14' };
  if (hour >= 7) return { dateKey, slot: '07' };
  return { dateKey, slot: '03' };
}

function hashUrl(url) {
  return createHash('sha256').update(String(url || '')).digest('hex').slice(0, 24);
}

function strField(v) {
  return { stringValue: String(v || '') };
}

function intField(v) {
  return { integerValue: String(v || 0) };
}

function tsField(date) {
  return { timestampValue: (date instanceof Date ? date : new Date()).toISOString() };
}

async function patchDoc(collection, id, fields) {
  const url = `${FS_BASE}/${collection}/${encodeURIComponent(id)}?key=${encodeURIComponent(FIREBASE_API_KEY)}&allowMissing=true`;
  const mask = Object.keys(fields).map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
  const res = await fetch(`${url}&${mask}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Firestore ${collection}/${id} HTTP ${res.status}: ${text.slice(0, 240)}`);
  }
  return res.json();
}

async function writeArticle(article, dateKey, slot, mode) {
  const url = article.url || '';
  if (!url) return null;
  const id = hashUrl(url);
  const title = article.title || '';
  const description = article.description || '';
  const image = article.image || article.imageUrl || article.urlToImage || '';
  const source = (article.source && article.source.name) || article.source || '';
  await patchDoc('articles', id, {
    title: strField(title),
    description: strField(description),
    url: strField(url),
    image: strField(image),
    source: strField(source),
    publishedAt: strField(article.publishedAt || ''),
    mode: strField(mode),
    dateKey: strField(dateKey),
    slot: strField(slot),
    fetchedAt: tsField(new Date()),
  });
  return id;
}

async function markDay(dateKey) {
  await patchDoc('days', dateKey, { date: strField(dateKey) });
}

async function finishSlot(dateKey, mode, slot, extra) {
  const id = `${dateKey}_${mode}_${slot}`;
  const fields = {
    status: strField(extra.status || 'done'),
    dateKey: strField(dateKey),
    mode: strField(mode),
    slot: strField(slot),
    count: intField(extra.count || 0),
    error: strField(extra.error || ''),
    finishedAt: tsField(new Date()),
  };
  await patchDoc('sync', id, fields);
}

async function syncMode(dateKey, slot, mode, key) {
  const result = await fetchGnewsArticles({ mode, key });
  if (!result.ok) {
    await finishSlot(dateKey, mode, slot, { status: 'error', count: 0, error: result.error });
    return { mode, ok: false, count: 0, error: result.error };
  }
  const articles = result.articles || [];
  if (!articles.length) {
    await finishSlot(dateKey, mode, slot, {
      status: 'error',
      count: 0,
      error: 'GNews 0 ta maqola qaytardi',
    });
    return { mode, ok: false, count: 0, error: 'GNews 0 ta maqola qaytardi' };
  }

  await markDay(dateKey);
  let saved = 0;
  const errors = [];
  for (const a of articles) {
    try {
      const id = await writeArticle(a, dateKey, slot, mode);
      if (id) saved += 1;
    } catch (e) {
      errors.push(e.message);
    }
  }

  if (!saved) {
    await finishSlot(dateKey, mode, slot, {
      status: 'error',
      count: 0,
      error: errors[0] || 'Firestore yozilmadi',
    });
    return { mode, ok: false, count: 0, error: errors[0] || 'Firestore yozilmadi' };
  }

  await finishSlot(dateKey, mode, slot, { status: 'done', count: saved, error: '' });
  return { mode, ok: true, count: saved, error: errors[0] || null };
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET yoki POST' });
  }
  if (!authorized(req)) {
    return res.status(401).json({ error: 'Cron ruxsati yo\'q' });
  }

  const GNEWS_KEY = process.env.GNEWS_KEY;
  if (!GNEWS_KEY) {
    return res.status(500).json({ error: 'GNEWS_KEY environment variable topilmadi' });
  }

  const { dateKey, slot } = currentNewsSlot();
  const modes = ['global', 'local'];
  const results = [];
  for (const mode of modes) {
    try {
      results.push(await syncMode(dateKey, slot, mode, GNEWS_KEY));
    } catch (e) {
      results.push({ mode, ok: false, count: 0, error: e.message });
    }
  }

  const ok = results.some((r) => r.ok);
  return res.status(ok ? 200 : 502).json({
    dateKey,
    slot,
    results,
  });
}
