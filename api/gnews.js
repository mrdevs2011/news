// ============================================================
// /api/gnews.js — Vercel Serverless Function
// ============================================================
// Bratan, bu server tomonda ishlaydi — brauzer emas, Vercel'ning
// o'zi GNews'ga so'rov yuboradi. Shu sabab CORS muammosi yo'q
// (server-to-server so'rovlarda CORS degan narsa umuman yo'q,
// CORS faqat brauzer xavfsizlik mexanizmi).
//
// GNEWS_KEY endi bu faylda HAM yozilmagan — Vercel Environment
// Variables orqali keladi. Shu sabab u GitHub'ga push qilinsa ham
// hech qayerda ko'rinmaydi.
//
// SOZLASH:
// Vercel dashboard -> Project -> Settings -> Environment Variables
//   Key:   GNEWS_KEY
//   Value: <sening gnews.io key'ing>
// Keyin redeploy qil (env variable qo'shgandan keyin avtomatik
// qayta deploy bo'lmasa, "Redeploy" tugmasini bos).
// ============================================================

export default async function handler(req, res) {
  // Faqat GET so'rovlarga ruxsat
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Faqat GET so\'rov qabul qilinadi' });
  }

  const GNEWS_KEY = process.env.GNEWS_KEY;
  if (!GNEWS_KEY) {
    return res.status(500).json({
      error: 'Server konfiguratsiyasi noto\'g\'ri: GNEWS_KEY environment variable topilmadi. Vercel dashboard -> Settings -> Environment Variables ichida qo\'sh.'
    });
  }

  // Frontend faqat "mode" parametrini yuboradi (global | local),
  // qolgan hamma narsani (key, lang, country) shu yerda serverda hal qilamiz.
  const mode = req.query.mode === 'local' ? 'local' : 'global';

  let url;
  if (mode === 'global') {
    url = `https://gnews.io/api/v4/top-headlines?lang=en&max=15&apikey=${encodeURIComponent(GNEWS_KEY)}`;
  } else {
    url = `https://gnews.io/api/v4/top-headlines?country=uz&lang=ru&max=15&apikey=${encodeURIComponent(GNEWS_KEY)}`;
  }

  try {
    const gnewsRes = await fetch(url);
    const data = await gnewsRes.json();

    if (!gnewsRes.ok) {
      return res.status(gnewsRes.status).json({
        error: data.errors ? data.errors.join(', ') : `GNews HTTP ${gnewsRes.status}`
      });
    }

    // Vercel edge/CDN darajasida 5 daqiqa keshlash — kunlik 100 so'rov
    // limitini tejash uchun. Foydalanuvchilar ko'p bo'lsa juda foydali.
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
    return res.status(200).json(data);
  } catch (err) {
    console.error('GNews proxy error:', err);
    return res.status(502).json({ error: 'GNews\'ga ulanib bo\'lmadi: ' + err.message });
  }
}
