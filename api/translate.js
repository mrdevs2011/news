// api/translate.js
// Haqiqiy tarjima (AI EMAS). Maxsus "unlimited browser"/Puppeteer sessiyasiga
// bog'lanmaydi — oddiy HTTPS so'rovlar.
//
// sl=auto  -> manba tilini o'zi aniqlaydi (en, ru, ... farqi yo'q)
// tl=uz    -> o'zbekcha
//
// Key kerak emas. Birinchi ishlagan provider ishlatiladi, yiqilsa keyingisi.

const PROVIDERS = [
  translateGoogleGtx,
  translateEdge,
  translateMyMemory,
];

async function translateGoogleGtx(text, target) {
  const url =
    'https://translate.googleapis.com/translate_a/single' +
    `?client=gtx&sl=auto&tl=${encodeURIComponent(target)}&dt=t&q=${encodeURIComponent(text)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  if (!res.ok) throw new Error(`Google GTX HTTP ${res.status}`);
  const data = await res.json();
  const segments = data[0] || [];
  const out = segments.map((seg) => (seg && seg[0]) || '').join('');
  if (!out) throw new Error('Google GTX bo\'sh javob');
  return out;
}

async function translateEdge(text, target) {
  const tokenRes = await fetch('https://edge.microsoft.com/translate/auth', {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  if (!tokenRes.ok) throw new Error(`Edge auth HTTP ${tokenRes.status}`);
  const token = (await tokenRes.text()).trim();
  if (!token) throw new Error('Edge token yo\'q');

  const url =
    'https://api-edge.cognitive.microsofttranslator.com/translate' +
    `?from=&to=${encodeURIComponent(target)}&api-version=3.0&includeSentenceLength=true`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'Mozilla/5.0',
    },
    body: JSON.stringify([{ Text: text }]),
  });
  if (!res.ok) throw new Error(`Edge HTTP ${res.status}`);
  const data = await res.json();
  const out = data?.[0]?.translations?.[0]?.text || '';
  if (!out) throw new Error('Edge bo\'sh javob');
  return out;
}

async function translateMyMemory(text, target) {
  const url =
    'https://api.mymemory.translated.net/get' +
    `?q=${encodeURIComponent(text)}&langpair=autodetect|${encodeURIComponent(target)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`MyMemory HTTP ${res.status}`);
  const data = await res.json();
  const out = data?.responseData?.translatedText || '';
  if (!out) throw new Error('MyMemory bo\'sh javob');
  if (/MYMEMORY WARNING/i.test(out)) throw new Error('MyMemory limit');
  return out;
}

async function translateOne(text, target) {
  if (!text) return '';
  let lastErr = null;
  for (const fn of PROVIDERS) {
    try {
      return await fn(text, target);
    } catch (err) {
      lastErr = err;
      console.warn('[translate] provider yiqildi:', fn.name, err.message);
    }
  }
  throw lastErr || new Error('Hech bir tarjima xizmati ishlamadi');
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
    const results = await Promise.all(
      items.map(async (item) => {
        const [title, desc] = await Promise.all([
          translateOne(item.title || '', tl),
          translateOne(item.desc || '', tl),
        ]);
        return { id: item.id, title, desc };
      })
    );

    res.status(200).json({ translations: results });
  } catch (err) {
    console.error('[translate] xato:', err.message);
    res.status(502).json({
      error: "Tarjima xizmatiga ulanib bo'lmadi: " + err.message,
    });
  }
}
