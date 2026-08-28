// api/ai-chat.js
// Bratan: OpenRouter BUTUNLAY OLIB TASHLANDI. Endi FAQAT Groq ishlaydi,
// BITTA key bilan — GROQ_KEY env variable.
//
// Kerakli env variable (Vercel -> Settings -> Environment Variables):
//   GROQ_KEY = "gsk_xxx"   (bitta dona key, pool/rotation yo'q)
//
// Key kelguncha shu holatda tur — GROQ_KEY topilmasa aniq xabar bilan 500 beradi.
//
// YANGI: mavzu Claude / Anthropic / AI modellari haqida bo'lsa, javob
// berishdan OLDIN internetdan (Wikipedia + DuckDuckGo) qisqa, real vaqtli
// ma'lumot tortib olinadi va model kontekstiga qo'shiladi — shunda model
// eski/noto'g'ri "xotira"siga tayanib taxmin qilib yozmaydi.

const SEARCH_TIMEOUT_MS = 4500;

// Mavzu AI-model / Claude / Anthropic bilan bog'liqmi — shu so'zlarga qarab aniqlaymiz.
const AI_TOPIC_RE =
  /\b(claude|anthropic|gpt|chatgpt|openai|gemini|google ai|deepmind|llm|large language model|sun'iy intellekt|neyroset\w*|ai model(i|lari)?|copilot|grok|xai|mistral|llama|midjourney|sora)\b/i;

function looksLikeAiTopic(messages) {
  const text = messages
    .filter((m) => m && (m.role === 'system' || m.role === 'user'))
    .map((m) => (typeof m.content === 'string' ? m.content : ''))
    .join('\n');
  return AI_TOPIC_RE.test(text);
}

// Qidiruv uchun eng so'nggi user xabari + system kontekstidagi sarlavhani ishlatamiz.
function buildSearchQuery(messages) {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const sys = messages.find((m) => m.role === 'system');
  const titleMatch = sys && typeof sys.content === 'string'
    ? sys.content.match(/Sarlavha[^\n:]*:\s*(.+)/i)
    : null;
  const parts = [];
  if (titleMatch && titleMatch[1]) parts.push(titleMatch[1].trim());
  if (lastUser && typeof lastUser.content === 'string' && lastUser.content.trim()) {
    parts.push(lastUser.content.trim());
  }
  return parts.join(' — ').slice(0, 300) || 'Claude Anthropic AI latest news';
}

async function withTimeout(promise, ms) {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error('timeout')), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(t);
  }
}

async function searchWikipedia(query) {
  const url =
    'https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&origin=*&srlimit=3&srsearch=' +
    encodeURIComponent(query);
  const res = await fetch(url, { headers: { 'User-Agent': 'news-site-aichat/1.0' } });
  if (!res.ok) throw new Error(`Wikipedia HTTP ${res.status}`);
  const data = await res.json();
  const hits = (data.query && data.query.search) || [];
  return hits.map((h) => ({
    title: h.title,
    snippet: String(h.snippet || '').replace(/<[^>]+>/g, ''),
  }));
}

async function searchDuckDuckGo(query) {
  const url =
    'https://api.duckduckgo.com/?format=json&no_html=1&skip_disambig=1&q=' +
    encodeURIComponent(query);
  const res = await fetch(url, { headers: { 'User-Agent': 'news-site-aichat/1.0' } });
  if (!res.ok) throw new Error(`DuckDuckGo HTTP ${res.status}`);
  const data = await res.json();
  const out = [];
  if (data.AbstractText) {
    out.push({ title: data.Heading || query, snippet: data.AbstractText });
  }
  (data.RelatedTopics || []).slice(0, 4).forEach((t) => {
    if (t && t.Text) out.push({ title: t.Text.split(' - ')[0], snippet: t.Text });
  });
  return out;
}

// Ikkala manbadan ham urinadi, natijalarni birlashtiradi. Ikkalasi ham
// yiqilsa — bo'sh massiv qaytadi, chaqiruvchi tomon buni jim o'tkazib yuboradi
// (grounding ixtiyoriy — bo'lmasa ham oddiy javob davom etadi).
async function fetchGroundingSnippets(query) {
  const results = await Promise.allSettled([
    withTimeout(searchWikipedia(query), SEARCH_TIMEOUT_MS),
    withTimeout(searchDuckDuckGo(query), SEARCH_TIMEOUT_MS),
  ]);
  const merged = [];
  for (const r of results) {
    if (r.status === 'fulfilled' && Array.isArray(r.value)) merged.push(...r.value);
  }
  const seen = new Set();
  const dedup = [];
  for (const item of merged) {
    const key = (item.title || '').toLowerCase();
    if (key && !seen.has(key)) {
      seen.add(key);
      dedup.push(item);
    }
    if (dedup.length >= 6) break;
  }
  return dedup;
}

function injectGrounding(messages, snippets) {
  if (!snippets.length) return messages;
  const block =
    "=== JONLI QIDIRUV NATIJALARI (real vaqtli, ishonchli manba — o'zingdagi eski ma'lumotdan KO'RA SHU YERDAGIGA ustunlik ber) ===\n" +
    snippets
      .map((s, i) => `${i + 1}. ${s.title}: ${s.snippet}`)
      .join('\n') +
    '\n=== QIDIRUV NATIJALARI TUGADI ===\n' +
    "Agar yuqoridagi qidiruv natijalari mavzuga aloqador bo'lsa, javobingni shularga tayanib ber, " +
    "eskirgan yoki noaniq 'xotira'ga asoslanib taxmin qilma. Aloqador bo'lmasa — e'tiborsiz qoldir.";

  const out = messages.map((m) => ({ ...m }));
  const sysIdx = out.findIndex((m) => m.role === 'system');
  if (sysIdx >= 0) {
    out[sysIdx].content = `${out[sysIdx].content}\n\n${block}`;
  } else {
    out.unshift({ role: 'system', content: block });
  }
  return out;
}

async function callGroq(key, messages, opts) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`
    },
    body: JSON.stringify({
      model: (opts && opts.model) || 'openai/gpt-oss-20b',
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
    let finalMessages = messages;
    let grounded = false;

    // Mavzu AI/Claude/Anthropic haqida bo'lsa — javobdan oldin real qidiruv qilamiz.
    if (looksLikeAiTopic(messages)) {
      try {
        const query = buildSearchQuery(messages);
        const snippets = await fetchGroundingSnippets(query);
        if (snippets.length) {
          finalMessages = injectGrounding(messages, snippets);
          grounded = true;
        }
      } catch (searchErr) {
        console.warn('[grounding] xato (davom etamiz):', searchErr.message);
      }
    }

    const result = await callGroq(GROQ_KEY, finalMessages);
    res.status(200).json({ result, provider: 'groq', grounded });
  } catch (err) {
    console.warn(`[groq] xato (HTTP ${err.status || '?'}):`, err.message);
    res.status(503).json({
      error: "Groq hozir band yoki kunlik limitga uchagan. Iltimos, bir necha daqiqadan so'ng qayta urinib ko'ring."
    });
  }
}
