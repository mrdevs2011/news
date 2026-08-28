// api/ai-chat.js
// Bratan: bu — sening eski frontend aiChat() funksiyang, lekin endi serverda.
// Key'lar Vercel Environment Variables'dan o'qiladi, brauzer ularni HECH QACHON ko'rmaydi.
//
// Kerakli env variable'lar (Vercel -> Settings -> Environment Variables):
//   OPENROUTER_KEYS   = "sk-or-xxx,sk-or-yyy"   (vergul yoki yangi qator bilan ajratilgan, 10+ bo'lishi mumkin)
//
// Bratan, Gemini butunlay olib tashlandi: Google endi yangi key'larni "AQ."
// prefiksi bilan chiqaryapti (OAuth token formati), eski "AIza" statik key
// formati emas — ?key= query parametr orqali ishlaydigan usul bilan mos
// kelmaydi, 401 ACCESS_TOKEN_TYPE_UNSUPPORTED beradi. Bu — Google tomonidagi
// platforma o'zgarishi, bizning kodimizdagi bug emas.
//
// Groq HAM olib tashlandi: sen curl bilan test qilganingda barcha Groq
// key'laring eskirgan/invalid chiqdi. OpenRouter esa ishladi. Endi faqat
// OpenRouter ishlaydi, uning 10+ key'i bor.

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
    openrouter: parseKeyList(process.env.OPENROUTER_KEYS)
  };
  // Diagnostika: Vercel -> Project -> Logs ichida shu qatorni ko'rasan —
  // agar bu yerda "openrouter=1" chiqsa-yu, sen 10+ key qo'ygan bo'lsang,
  // demak parsing muammosi bor edi (yoki hali eski deploy ishlab turibdi).
  console.log(`[key-pools] openrouter=${pools.openrouter.length}`);
  return pools;
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

const CALLERS = { openrouter: callOpenRouter };

// Groq ham, Gemini ham olib tashlangach — bitta provider qoldi: OpenRouter.
// Eski kodda 1-AYLANISH va 2-AYLANISH (retry) degan IKKI BOSQICHLI mantiq bor
// edi, chunki 3 xil provider orasida aylanish kerak edi. Endi provider bitta
// bo'lgach, "ikkinchi aylanish" tushunchasi ma'nosiz bo'lib qoladi — men buni
// avvalgi kommentariyimda aytgan edim: orada hech qanday kutish (delay) yo'q,
// shuning uchun ikkinchi aylanish bir xil 10+ key ustidan bir xil tartibda,
// millisekundlar ichida, xuddi bir xil natija bilan qayta yuguradi. Foyda
// yo'q, faqat funksiya vaqtini behuda cho'zadi.
//
// Shuning uchun ikki bosqichli mantiqni OLIB TASHLADIM — endi tryProvider()
// OpenRouter poolini FAQAT BIR MARTA, boshidan oxirigacha (10+ key) sinaydi.
// Bu — aslida eski mantiqning o'zi, faqat keraksiz takrorlanish yo'q.
const OPENROUTER_POOL = 'openrouter';

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

  // Faqat OpenRouter bor — poolni boshidan oxirigacha (10+ key) sinaymiz.
  const pool = KEY_POOLS[OPENROUTER_POOL];
  if (pool.length) {
    const out = await tryProvider(OPENROUTER_POOL, pool, messages);
    if (out.ok) {
      res.status(200).json({ result: out.result, provider: out.provider });
      return;
    }
  }

  // Pool bo'sh edi, yoki barcha key'lar (10+) navbat bilan sinalib,
  // hammasi xato berdi — endi rostini aytamiz, "AI ishlamayapti" emas,
  // "hozircha bandmiz, biroz kut" degan aniq xabar.
  res.status(503).json({
    error: "OpenRouter hozir band yoki kunlik limitga uchagan. Iltimos, bir necha daqiqadan so'ng qayta urinib ko'ring."
  });
}
