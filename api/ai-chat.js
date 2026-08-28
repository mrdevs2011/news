// api/ai-chat.js
// Bratan: OpenRouter BUTUNLAY OLIB TASHLANDI. Endi FAQAT Groq ishlaydi,
// BITTA key bilan — GROQ_KEY env variable.
//
// Kerakli env variable (Vercel -> Settings -> Environment Variables):
//   GROQ_KEY = "gsk_xxx"   (bitta dona key, pool/rotation yo'q)
//
// Key kelguncha shu holatda tur — GROQ_KEY topilmasa aniq xabar bilan 500 beradi.

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

  const GROQ_KEY = process.env.GROQ_KEY;
  if (!GROQ_KEY) {
    res.status(500).json({
      error: 'Server konfiguratsiyasi noto\'g\'ri: GROQ_KEY environment variable topilmadi. Vercel dashboard -> Settings -> Environment Variables ichida qo\'sh.'
    });
    return;
  }

  try {
    const result = await callGroq(GROQ_KEY, messages);
    res.status(200).json({ result, provider: 'groq' });
  } catch (err) {
    console.warn(`[groq] xato (HTTP ${err.status || '?'}):`, err.message);
    res.status(503).json({
      error: "Groq hozir band yoki kunlik limitga uchagan. Iltimos, bir necha daqiqadan so'ng qayta urinib ko'ring."
    });
  }
}
