// GNews so'rovini gnews.js va cron-news.js birga ishlatadi.

export const TECH_QUERIES = [
  '(AI OR ChatGPT OR Claude OR Gemini OR LLM OR OpenAI OR Anthropic)',
  '(Cursor OR Copilot OR "vibe coding" OR "code generation" OR Windsurf)',
  '(programming OR GitHub OR "open source" OR TypeScript OR Python)',
  '(electronics OR Arduino OR Raspberry OR semiconductor OR chip OR hardware)',
  '(cybersecurity OR vulnerability OR ransomware OR "zero day")',
  '(startup OR "developer tools" OR SaaS OR GPU OR NVIDIA)',
];

const UZ_CLAUSE = '(Uzbekistan OR \u0423\u0437\u0431\u0435\u043a\u0438\u0441\u0442\u0430\u043d OR "O\'zbekiston" OR Toshkent OR Tashkent OR \u0422\u0430\u0448\u043a\u0435\u043d\u0442)';

export const LOCAL_QUERIES = [
  '(AI OR "sun\'iy intellekt" OR ChatGPT OR Claude OR Gemini) AND ' + UZ_CLAUSE,
  '("IT Park" OR "raqamli iqtisodiyot" OR startup OR startap OR innovatsiya) AND ' + UZ_CLAUSE,
  '(dasturlash OR programming OR IT OR texnologiya OR technology) AND ' + UZ_CLAUSE,
  '(kiberxavfsizlik OR cybersecurity OR hacker OR "data markaz") AND ' + UZ_CLAUSE,
  '(telecom OR aloqa OR internet OR 5G OR mobil) AND ' + UZ_CLAUSE,
  '(robot OR robototexnika OR chip OR elektronika) AND ' + UZ_CLAUSE,
];

function gnewsErrorMessage(data, status) {
  if (Array.isArray(data && data.errors)) return data.errors.join(', ');
  if (typeof (data && data.errors) === 'string') return data.errors;
  if (typeof (data && data.message) === 'string') return data.message;
  return `GNews HTTP ${status}`;
}

function stripRepeatedImages(articles) {
  if (!Array.isArray(articles)) return articles;
  const freq = {};
  articles.forEach((a) => {
    const img = a.image || a.imageUrl || a.urlToImage;
    if (img) freq[img] = (freq[img] || 0) + 1;
  });
  return articles.map((a) => {
    const img = a.image || a.imageUrl || a.urlToImage;
    if (img && freq[img] >= 5) {
      return { ...a, image: '', imageUrl: '', urlToImage: '' };
    }
    return a;
  });
}

export function pickQuery(mode, topic, page) {
  const set = mode === 'local' ? LOCAL_QUERIES : TECH_QUERIES;
  const qIndex = topic >= 0
    ? topic % set.length
    : (new Date().getHours() + Math.max(0, page - 1)) % set.length;
  return set[qIndex];
}

export function fromParamHoursAgo(hours) {
  const fromDate = new Date(Date.now() - hours * 60 * 60 * 1000);
  return fromDate.toISOString().split('.')[0] + 'Z';
}

export function buildGnewsUrl({ mode, query, page, from, key }) {
  const base = 'https://gnews.io/api/v4/search';
  const params = new URLSearchParams({
    q: query,
    max: '10',
    page: String(page),
    sortby: 'publishedAt',
    from,
    apikey: key,
  });
  if (mode === 'local') {
    params.set('country', 'uz');
    params.set('lang', 'ru');
  } else {
    params.set('lang', 'en');
  }
  return `${base}?${params.toString()}`;
}

export async function fetchGnewsArticles({
  mode = 'global',
  key,
  page = 1,
  topic = -1,
} = {}) {
  if (!key) {
    return { ok: false, status: 500, articles: [], error: 'GNEWS_KEY topilmadi' };
  }

  const m = mode === 'local' ? 'local' : 'global';
  const query = pickQuery(m, topic, page);
  const from72 = fromParamHoursAgo(72);
  const url = buildGnewsUrl({ mode: m, query, page, from: from72, key });

  try {
    let gnewsRes = await fetch(url);
    let data = await gnewsRes.json().catch(() => ({}));

    if (gnewsRes.ok && Array.isArray(data.articles) && data.articles.length === 0) {
      const from7d = fromParamHoursAgo(7 * 24);
      const wideUrl = buildGnewsUrl({ mode: m, query, page, from: from7d, key });
      console.warn('[gnews] 72h oynada natija yo\'q, 7 kunga kengaytirildi:', query);
      gnewsRes = await fetch(wideUrl);
      data = await gnewsRes.json().catch(() => ({}));
    }

    if (!gnewsRes.ok) {
      return {
        ok: false,
        status: gnewsRes.status,
        articles: [],
        error: gnewsErrorMessage(data, gnewsRes.status),
      };
    }

    const articles = stripRepeatedImages(data.articles || []);
    return { ok: true, status: 200, articles, error: null, query };
  } catch (err) {
    return {
      ok: false,
      status: 502,
      articles: [],
      error: 'GNews\'ga ulanib bo\'lmadi: ' + (err && err.message ? err.message : String(err)),
    };
  }
}
