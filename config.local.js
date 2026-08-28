// ============================================================
// WIRE TERMINAL — LOCAL CONFIG
// ============================================================
// Bratan, bu faylni HECH QACHON GitHub'ga, hostingga yoki
// boshqa public joyga qo'yma. Faqat o'zingda, local, tur.
//
// Key'laringni pastdagi massivlarga qo'y. Tartib muhim emas —
// kod ularni round-robin bilan ishlatadi va biri limit/xato
// bersa avtomatik keyingisiga o'tadi.
//
// Fallback ketma-ketligi (index.html ichida belgilangan):
//   GROQ (hammasi tugasa) -> OPENROUTER (hammasi tugasa) -> GEMINI
// ============================================================

window.WIRE_KEYS = {
  groq: [
    // "gsk_...",
    // "gsk_...",
  ],
  openrouter: [
    // "sk-or-...",
    // "sk-or-...",
  ],
  gemini: [
    // "AQ....",
  ]
};
