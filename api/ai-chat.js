// api/ai-chat.js
// Bratan: bu — sening eski frontend aiChat() funksiyang, lekin endi serverda.
// Key'lar Vercel Environment Variables'dan o'qiladi, brauzer ularni HECH QACHON ko'rmaydi.
//
// Kerakli env variable'lar (Vercel -> Settings -> Environment Variables):
//   GROQ_KEYS        = "gsk_xxx,gsk_yyy"        (vergul bilan ajratilgan, bir nechta bo'lishi mumkin)
//   OPENROUTER_KEYS   = "sk-or-xxx"
//
// Bratan, Gemini butunlay olib tashlandi: Google endi yangi key'larni "AQ."
// prefiksi bilan chiqaryapti (OAuth token formati), eski "AIza" statik key
// formati emas — ?key= query parametr orqali ishlaydigan usul bilan mos
// kelmaydi, 401 ACCESS_TOKEN_TYPE_UNSUPPORTED beradi. Bu — Google tomonidagi
// platforma o'zgarishi, bizning kodimizdagi bug emas. Endi faqat Groq va
// OpenRouter ishlaydi.

// Bratan, MUHIM TUZATISH: avval FAQAT vergul (",") bilan ajratardi. Agar
// Vercel'ga key'larni har birini ALOHIDA QATORGA (Enter bilan) joylagan bo'lsang,
// vergul yo'qligi sabab BUTUN matn BITTA "key" deb o'qilardi — shu bitta buzuq
// key har doim 401 berardi, va 22 ta key emas, aslida 1 tasi ishlardi.
// Endi vergul HAM, yangi qator HAM qabul qilinadi — qaysi usulda joylagan bo'lsang ham ishlaydi.
function parseKeyList(raw) {
  return (raw || '')
    .split(/[\n,]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

function loadKeyPools() {
  const pools = {
    groq: parseKeyList(process.env.GROQ_KEYS),
    openrouter: parseKeyList(process.env.OPENROUTER_KEYS)
  };
  // Diagnostika: Vercel -> Project -> Logs ichida shu qatorni ko'rasan —
  // agar bu yerda "groq=1" chiqsa-yu, sen 10+ key qo'ygan bo'lsang, demak
  // parsing muammosi bor edi (yoki hali eski deploy ishlab turibdi — pastga qara).
  console.log(`[key-pools] groq=${pools.groq.length} openrouter=${pools.openrouter.length}`);
  return pools;
}

async function callGroq(key, messages) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages,
      temperature: 0.4
    })
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error?.message || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

async function callOpenRouter(key, messages) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`
    },
    body: JSON.stringify({
      model: 'meta-llama/llama-3.3-70b-instruct:free',
      messages,
      temperature: 0.4
    })
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error?.message || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

const CALLERS = { groq: callGroq, openrouter: callOpenRouter };

// Gemini olib tashlangandan keyin: 1-AYLANISH va 2-AYLANISH (retry) endi
// AYNAN BIR XIL ro'yxat (groq -> openrouter) bo'lib qoldi. Bratan, buni
// bilib qo'y: agar ikkalasi ORASIDA vaqt o'tmasa (masalan Groq rate-limit
// oynasi qayta ochilishi uchun kerak bo'lgan soniyalar), ikkinchi aylanish
// birinchisi bilan XUDDI BIR XIL natija beradi — key'lar o'zgarmagan,
// xato sabab o'zgarmagan. Shuning uchun ikkinchi aylanishdan oldin qisqa
// kutish (masalan 1-2 soniya) qo'shilmasa, RETRY_PASS deyarli foydasiz
// bo'lib qoladi, faqat funksiya ishlash vaqtini (va Vercel hisobingni)
// bekorga oshiradi. Hozircha mantiqni o'zgartirmadim — faqat shuni bilib
// yur, keyinchalik kerak bo'lsa retry oldiga await sleep(1500) qo'shamiz.
const FIRST_PASS = ['groq', 'openrouter'];
const RETRY_PASS = ['groq', 'openrouter'];

// Bitta provider'ning barcha key'larini TARTIB BILAN (0-indexdan boshlab, tasodifiy emas)
// sinab chiqadi. Bratan aniq shuni so'radi: har doim DEFAULT (birinchi) key'dan
// boshlansin, faqat o'sha limitga urilganda keyingisiga o'tsin — random offset kerak emas.
async function tryProvider(provider, pool, messages) {
  for (let i = 0; i < pool.length; i++) {
    const key = pool[i];
    try {
      const result = await CALLERS[provider](key, messages);
      return { ok: true, result, provider };
    } catch (err) {
      console.warn(`[${provider}] key#${i + 1}/${pool.length} xato (HTTP ${err.status || '?'}):`, err.message);
      // 401/403/429 — sabab qanaqa bo'lishidan qat'iy nazar, keyingi key'ga o'tamiz.
      // Serverless funksiya har chaqiruvda yangi instance bo'lishi mumkin, shuning
      // uchun "bu key limitga urildi" degan holatni doimiy eslab qololmaymiz —
      // shu sabab har so'rovda qaytadan 1-key'dan boshlanadi, bu normal.
      continue;
    }
  }
  return { ok: false };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Faqat POST qabul qilinadi.' });
    return;
  }

  const { messages } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: 'messages massivi kerak.' });
    return;
  }

  const KEY_POOLS = loadKeyPools();

  // 1-AYLANISH: groq -> openrouter
  for (const provider of FIRST_PASS) {
    const pool = KEY_POOLS[provider];
    if (!pool.length) continue;
    const out = await tryProvider(provider, pool, messages);
    if (out.ok) {
      res.status(200).json({ result: out.result, provider: out.provider });
      return;
    }
  }

  // 2-AYLANISH (retry loop): 1-aylanishda HAMMASI (groq, openrouter) tugagan
  // bo'lsa ham, ba'zan bir necha soniyada rate-limit oyna qayta ochilishi mumkin —
  // shuning uchun groq va openrouter'ni yana bir bor sinab ko'ramiz.
  for (const provider of RETRY_PASS) {
    const pool = KEY_POOLS[provider];
    if (!pool.length) continue;
    const out = await tryProvider(provider, pool, messages);
    if (out.ok) {
      res.status(200).json({ result: out.result, provider: out.provider });
      return;
    }
  }

  // Ikkala aylanish ham quladi — endi rostini aytamiz, "AI ishlamayapti" emas,
  // "hozircha bandmiz, biroz kut" degan aniq xabar.
  res.status(503).json({
    error: "Barcha AI provayderlar (Groq, OpenRouter) hozir band yoki kunlik limitga uchagan. Iltimos, bir necha daqiqadan so'ng qayta urinib ko'ring."
  });
}
