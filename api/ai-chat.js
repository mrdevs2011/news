// api/ai-chat.js
// Bratan: bu — sening eski frontend aiChat() funksiyang, lekin endi serverda.
// Key'lar Vercel Environment Variables'dan o'qiladi, brauzer ularni HECH QACHON ko'rmaydi.
//
// Kerakli env variable'lar (Vercel -> Settings -> Environment Variables):
//   GROQ_KEYS        = "gsk_xxx,gsk_yyy"        (vergul bilan ajratilgan, bir nechta bo'lishi mumkin)
//   OPENROUTER_KEYS   = "sk-or-xxx"
//   GEMINI_KEYS       = "AIzaxxx,AIzayyy"

const PROVIDER_ORDER = ['groq', 'openrouter', 'gemini'];

function loadKeyPools() {
  return {
    groq: (process.env.GROQ_KEYS || '').split(',').map(s => s.trim()).filter(Boolean),
    openrouter: (process.env.OPENROUTER_KEYS || '').split(',').map(s => s.trim()).filter(Boolean),
    gemini: (process.env.GEMINI_KEYS || '').split(',').map(s => s.trim()).filter(Boolean)
  };
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

async function callGemini(key, messages) {
  const sysMsg = messages.find(m => m.role === 'system');
  const convo = messages.filter(m => m.role !== 'system');
  const contents = convo.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));
  const body = {
    contents,
    ...(sysMsg ? { systemInstruction: { parts: [{ text: sysMsg.content }] } } : {})
  };
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }
  );
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    const err = new Error(errBody.error?.message || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
}

const CALLERS = { groq: callGroq, openrouter: callOpenRouter, gemini: callGemini };

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
  let lastErr = null;

  for (const provider of PROVIDER_ORDER) {
    const pool = KEY_POOLS[provider];
    if (!pool.length) continue;

    // Ko'p key bo'lsa (masalan 10-20 tasi) — har doim 0-indexdan boshlab
    // sinasak, birinchi key doim eng ko'p urilib, tezroq limitga yetadi.
    // Shuning uchun har so'rovda TASODIFIY boshlang'ich nuqtadan boshlaymiz —
    // bu oddiy load-balancing, key'lar orasida yuk taxminan teng taqsimlanadi.
    const startOffset = Math.floor(Math.random() * pool.length);

    for (let i = 0; i < pool.length; i++) {
      const idx = (startOffset + i) % pool.length;
      const key = pool[idx];
      try {
        const result = await CALLERS[provider](key, messages);
        res.status(200).json({ result, provider });
        return;
      } catch (err) {
        console.warn(`[${provider}] key#${idx} xato:`, err.message);
        lastErr = err;
        // 401/403/429 bo'lsa ham, keyingi key'ga o'tamiz — dead key tracking
        // serverless'da state saqlamaydi (har chaqiruv yangi instance bo'lishi
        // mumkin), shuning uchun cheklovni doimiy eslab qololmaymiz.
        continue;
      }
    }
  }

  res.status(502).json({
    error: (lastErr && lastErr.message) || "Barcha AI provider/key'lar ishlamadi."
  });
}
