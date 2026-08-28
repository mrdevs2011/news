# WIRE — Yangiliklar Terminali

## Struktura
```
├── index.html          ← asosiy sahifa (deploy qilinadigan fayl)
├── api/
│   └── gnews.js         ← Vercel serverless proxy (GNews key shu yerda EMAS)
├── config.local.js       ← AI key'lar (Groq/OpenRouter/Gemini) — .gitignore'da, COMMIT QILMA
└── .gitignore
```

## Sozlash — qadam-baqadam

### 1. GNews key (server-side, xavfsiz)
- Agar eski key allaqachon GitHub'ga commit bo'lgan bo'lsa: **gnews.io dashboard'ida uni revoke qilib, yangisini ol.** Eski key git history'da qolib ketadi, `.gitignore` buni orqaga qaytarmaydi.
- Vercel → loyihang → **Settings → Environment Variables**
  - Key: `GNEWS_KEY`
  - Value: yangi gnews.io key'ing
- Saqlagach **Redeploy** bos (env variable qo'shilgach avtomatik qayta ishlamasligi mumkin).

### 2. AI key'lar (Groq / OpenRouter / Gemini)
`config.local.js` faylini och, key'laringni massivlarga yoz:
```js
window.WIRE_KEYS = {
  groq: ["gsk_...", "gsk_..."],
  openrouter: ["sk-or-..."],
  gemini: ["AQ...."]
};
```
**MUHIM:** bu fayl hozircha frontend'da ochiq turadi — ya'ni deploy qilsang, `view-source` orqali har kim ko'radi. `.gitignore`ga qo'shilgan, ya'ni GitHub'ga tushmaydi, lekin **Vercel'ga qanday qilib yuklaysan** — buni hal qilish kerak (masalan Vercel CLI orqali qo'lda yuklash, yoki keyingi qadamda buni ham `/api/groq.js`, `/api/openrouter.js`, `/api/gemini.js` proxy'lariga o'tkazish — bu tavsiya etiladi).

### 3. Deploy
```
git add .
git commit -m "wire terminal setup"
git push
```
Vercel avtomatik deploy qiladi (agar repo ulangan bo'lsa).

## Xavfsizlik eslatmasi
- `config.local.js` va eski `gnews.localkey.js` — HECH QACHON commit qilinmasin.
- Agar git history'da allaqachon key bor bo'lsa — key'ni **revoke qilish** yagona ishonchli yechim, faylni o'chirish yetarli emas.
