// api/translate.js
// Bratan: bu AI EMAS — haqiqiy tarjima API (Google Translate'ning key'siz,
// bepul "unofficial" endpoint'i, translate.googleapis.com). Groq/OpenRouter
// bilan hech qanday aloqasi yo'q, shuning uchun "AI band" degan xato bu yerda
// UMUMAN chiqmaydi — bu boshqa xizmat, boshqa limit (juda yuqori, amalda
// bizning trafik uchun yetarli).
//
// Key kerak emas — Vercel Environment Variables'ga hech narsa qo'shmaysan.
//
// Frontend bitta so'rovda bir nechta matnni (title+desc, hamma article uchun)
// yuboradi -> biz har birini serverda parallel tarjima qilib, bitta massiv
// qilib qaytaramiz.

async function translateOne(text, target) {
  if (!text) return '';
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(target)}&dt=t&q=${encodeURIComponent(text)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Translate HTTP ${res.status}`);
  }
  const data = await res.json();
  // Javob shakli: [[["tarjima qismi 1", "original 1", null, null, ...], ["tarjima qismi 2", ...], ...], ...]
  // Uzun matn bir nechta segmentga bo'linishi mumkin — hammasini birlashtiramiz.
  const segments = data[0] || [];
  return segments.map(seg => seg[0]).join('');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Faqat POST qabul qilinadi.' });
    return;
  }

  const { items, target } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: 'items massivi kerak: [{id, title, desc}, ...]' });
    return;
  }

  const tl = target || 'uz';

  try {
    const results = await Promise.all(items.map(async (item) => {
      const [title, desc] = await Promise.all([
        translateOne(item.title || '', tl),
        translateOne(item.desc || '', tl)
      ]);
      return { id: item.id, title, desc };
    }));

    res.status(200).json({ translations: results });
  } catch (err) {
    console.error('[translate] xato:', err.message);
    res.status(502).json({ error: 'Tarjima xizmatiga ulanib bo\'lmadi: ' + err.message });
  }
}
