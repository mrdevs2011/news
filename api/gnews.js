// ============================================================
// /api/gnews.js — Vercel Serverless Function
//
// GNEWS_KEY Vercel Environment Variables orqali keladi.
// ============================================================

import { fetchGnewsArticles } from './_gnews.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Faqat GET so\'rov qabul qilinadi' });
  }

  const GNEWS_KEY = process.env.GNEWS_KEY;
  if (!GNEWS_KEY) {
    return res.status(500).json({
      error: 'Server konfiguratsiyasi noto\'g\'ri: GNEWS_KEY environment variable topilmadi. Vercel dashboard -> Settings -> Environment Variables ichida qo\'sh.'
    });
  }

  const mode = req.query.mode === 'local' ? 'local' : 'global';
  const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
  const topic = Math.max(-1, parseInt(String(req.query.topic || '-1'), 10));
  const isMore = req.query.more === '1' || topic >= 0;
  const usePage = isMore ? 1 : page;
  const useTopic = topic >= 0 ? topic : -1;

  const result = await fetchGnewsArticles({
    mode,
    key: GNEWS_KEY,
    page: usePage,
    topic: useTopic,
  });

  if (!result.ok) {
    console.warn('[gnews] non-ok:', result.error);
    return res.status(result.status || 502).json({ error: result.error || 'GNews xatosi' });
  }

  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
  return res.status(200).json({ articles: result.articles });
}
