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
  const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);

  // Bratan aytdi: umumiy siyosat-iqtisod aralashmasi kerak emas — faqat
  // DASTURLASH / SUN'IY INTELLEKT / TEXNOLOGIYA OLAMI kerak. Shuning uchun
  // endi top-headlines emas, "search" endpoint ishlatilyapti — GNews'ga aniq
  // qidiruv so'zlari beramiz, faqat shu mavzudagi yangiliklar qaytadi.
  // Bratan, MUHIM: GNews q parametri 200 belgi bilan cheklangan (Free/Basic tarif).
  // Avvalgi 30+ so'zli query 500+ belgi edi -> doim "too long" xatosi berardi.
  // Endi 2 ta QISQA query bor: har biri navbat bilan (soat asosida) ishlatiladi,
  // shunda mavzular kengroq qamrab olinadi, lekin har biri 200 belgidan kichik.
  // Har MORE bosilishi YANGI qiziq mavzuning BOSHINI oladi.
  // Bitta query'ning 2-3-sahifasi (qoldiq, zerikarli) olinmaydi.
  const TECH_QUERIES = [
    '(AI OR ChatGPT OR Claude OR Gemini OR LLM OR OpenAI OR Anthropic)',
    '(Cursor OR Copilot OR "vibe coding" OR "code generation" OR Windsurf)',
    '(programming OR GitHub OR "open source" OR TypeScript OR Python)',
    '(electronics OR Arduino OR Raspberry OR semiconductor OR chip OR hardware)',
    '(cybersecurity OR vulnerability OR ransomware OR "zero day")',
    '(startup OR "developer tools" OR SaaS OR GPU OR NVIDIA)',
  ];
  const topic = Math.max(0, parseInt(String(req.query.topic || '-1'), 10));
  const isMore = req.query.more === '1' || topic >= 0;
  const qIndex = topic >= 0
    ? topic % TECH_QUERIES.length
    : (new Date().getHours() + Math.max(0, page - 1)) % TECH_QUERIES.length;
  const TECH_QUERY = TECH_QUERIES[qIndex];
  // MORE: relevance + page=1 (mavzuning eng yaxshi boshi).
  // Birinchi yuklash: publishedAt (yangiligi).
  const sortby = 'publishedAt';
  const usePage = isMore ? 1 : page;

  // Bratishka, MUHIM: sortby=publishedAt yolg'iz o'zi YETARLI EMAS —
  // u faqat "natijalarni yangidan eskiga tartibla" degani, lekin GNews
  // baribir 2-3 KUNLIK "eskirgan" maqolalarni ham ro'yxatga qo'shishi
  // mumkin edi (agar ular kalit so'zga mos kelsa). Foydalanuvchi aniq
  // aytdi: eskirgan/allaqachon ma'lum bo'lgan xabarlar ko'rinmasin,
  // faqat YANGI — bugun/kecha sodir bo'lgan, HOZIR sodir bo'layotgan
  // yoki yaqin kunlarda bo'lishi KUTILAYOTGAN voqealar haqidagi
  // maqolalar (masalan: "iPhone 18 Pro Max sentabrda taqdim etilishi
  // kutilmoqda" — bu HAM "yangi" hisoblanadi, chunki bu maqolaning
  // O'ZI yangi chop etilgan, garchi voqea kelajakda bo'lsa ham).
  // Shu sabab GNews'ga qattiq `from=` sana chegarasi qo'shamiz — bu
  // maqola nashr sanasini cheklaydi, voqea sanasini emas. Natijada:
  // "kecha/bugun yozilgan, ertaga/yaqin kelajak haqidagi" maqolalar
  // o'tadi, "3 kun oldin yozilgan eski xabar" esa butunlay kesiladi.
  const FRESHNESS_WINDOW_HOURS = 72;
  const fromDate = new Date(Date.now() - FRESHNESS_WINDOW_HOURS * 60 * 60 * 1000);
  const fromParam = fromDate.toISOString().split('.')[0] + 'Z'; // GNews kutgan format: YYYY-MM-DDThh:mm:ssZ

  let url;
  if (mode === 'global') {
    url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(TECH_QUERY)}&lang=en&max=10&page=${usePage}&sortby=${sortby}&from=${fromParam}&apikey=${encodeURIComponent(GNEWS_KEY)}`;
  } else {
    url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(TECH_QUERY)}&country=uz&lang=ru&max=10&page=${usePage}&sortby=${sortby}&from=${fromParam}&apikey=${encodeURIComponent(GNEWS_KEY)}`;
  }

  try {
    let gnewsRes = await fetch(url);
    let data = await gnewsRes.json();

    // Bratan, FALLBACK: agar 72 soatlik qat'iy oyna hech narsa
    // qaytarmasa (niche mavzu, tinch tungi soat va h.k.), bo'sh feed
    // ko'rsatishdan ko'ra — oynani 7 kunga kengaytirib qayta so'raymiz.
    // Bu "eskirgan xabar ko'rsatmaslik" qoidasini butunlay buzmaydi,
    // chunki bu FAQAT hech qanday yangi maqola topilmagan holatda
    // ishga tushadi (fallback), asosiy oqim doim 72 soatlik.
    if (gnewsRes.ok && Array.isArray(data.articles) && data.articles.length === 0) {
      const wideFrom = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('.')[0] + 'Z';
      const wideUrl = url.replace(`from=${fromParam}`, `from=${wideFrom}`);
      console.warn('[gnews] 72h oynada natija yo\'q, 7 kunga kengaytirildi:', TECH_QUERY);
      gnewsRes = await fetch(wideUrl);
      data = await gnewsRes.json();
    }

    if (!gnewsRes.ok) {
      // Bratan, MUHIM: GNews xato bo'lganda "errors" kalitini har doim
      // massiv qilib qaytaravermaydi — ba'zan string, ba'zan boshqa shakl.
      // Shuning uchun avval Array.isArray bilan TUR tekshiriladi, keyingina
      // .join() chaqiriladi. Aks holda "truthy lekin array emas" holatda
      // xuddi shu joyda yana TypeError chiqib, 502'ga aylanaveradi.
      let gnewsMessage;
      if (Array.isArray(data.errors)) {
        gnewsMessage = data.errors.join(', ');
      } else if (typeof data.errors === 'string') {
        gnewsMessage = data.errors;
      } else if (typeof data.message === 'string') {
        gnewsMessage = data.message;
      } else {
        gnewsMessage = `GNews HTTP ${gnewsRes.status}`;
      }
      console.warn('[gnews] non-ok response body:', JSON.stringify(data));
      return res.status(gnewsRes.status).json({ error: gnewsMessage });
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
