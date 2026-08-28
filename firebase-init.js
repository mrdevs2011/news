// firebase-init.js
// Bratan: bu yerdagi firebaseConfig PUBLIC bo'lishi normal — bu secret emas.
// Haqiqiy himoya firestore.rules faylida. AI API key'lar bu yerga HECH QACHON kelmaydi.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  collection,
  addDoc,
  getDocs,
  query,
  orderBy,
  where,
  limit,
  serverTimestamp,
  runTransaction,
  arrayUnion
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCd2WkgSdFvK3gFcRIhGxb4uHLZlKf4EmQ",
  authDomain: "news-90fb9.firebaseapp.com",
  projectId: "news-90fb9",
  storageBucket: "news-90fb9.firebasestorage.app",
  messagingSenderId: "207862699341",
  appId: "1:207862699341:web:dfef1e584e2f7a326dd304",
  measurementId: "G-779SXT8YR9"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

// ---- Yordamchi funksiyalar ----

// article.url dan barqaror ID chiqaramiz — shunda bir xil yangilik
// qayta fetch qilinganda duplicate document yaratilmaydi.
export async function hashUrl(url) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(url));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 24);
}

// Feed'dan kelgan article'ni Firestore'ga yozadi (merge — mavjud bo'lsa ustiga qo'shiladi,
// explainResult, translatedTitle/Desc va chat tarixi buzilmaydi).
// dateKey = "YYYY-MM-DD" (client tomonda hisoblanadi) — TARIX bo'limi shu maydon
// bo'yicha kunlarga ajratadi. serverTimestamp() write payti hali noma'lum bo'lgani
// uchun (u faqat serverda resolve bo'ladi), kun bo'yicha guruhlash uchun alohida
// oddiy string maydon kerak edi.
export async function upsertArticle(articleId, article, mode, dateKey) {
  const ref = doc(db, "articles", articleId);
  await setDoc(
    ref,
    {
      title: article.title || "",
      description: article.description || "",
      url: article.url || "",
      image: article.image || article.imageUrl || article.urlToImage || "",
      source: article.source?.name || "",
      publishedAt: article.publishedAt || "",
      mode,
      dateKey: dateKey || "",
      slot: article.slot || "",
      fetchedAt: serverTimestamp()
    },
    { merge: true }
  );

  // Original matn faqat bir marta yoziladi — keyin GNews qayta kelsa ham
  // originalText / uzText o'zgarmaydi.
  const existing = await getDoc(ref);
  const data = existing.exists() ? existing.data() : {};
  const originalText = packText(article.title || "", article.description || "");
  if (originalText && !data.originalText) {
    await setDoc(ref, { originalText }, { merge: true });
  }
}

export function packText(title, desc) {
  return `${title || ""}\n\n${desc || ""}`.trim();
}

export function unpackText(text) {
  const raw = String(text || "");
  const i = raw.indexOf("\n\n");
  if (i < 0) return { title: raw, desc: "" };
  return { title: raw.slice(0, i), desc: raw.slice(i + 2) };
}

export function articleOriginal(docOrArticle) {
  if (!docOrArticle) return { title: "", desc: "" };
  if (docOrArticle.originalText) return unpackText(docOrArticle.originalText);
  return {
    title: docOrArticle.title || "",
    desc: docOrArticle.description || docOrArticle.desc || ""
  };
}

export function articleUz(docOrArticle) {
  if (!docOrArticle) return null;
  if (docOrArticle.uzText) return unpackText(docOrArticle.uzText);
  if (docOrArticle.translatedTitle || docOrArticle.uzTitle) {
    return {
      title: docOrArticle.translatedTitle || docOrArticle.uzTitle || "",
      desc: docOrArticle.translatedDesc || docOrArticle.uzDesc || ""
    };
  }
  return null;
}

export async function getArticleDoc(articleId) {
  const ref = doc(db, "articles", articleId);
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}

// AI "tarjima+tushuntirish" natijasini keshlab qo'yamiz — token tejash uchun.
export async function saveExplainResult(articleId, text) {
  const ref = doc(db, "articles", articleId);
  const snap = await getDoc(ref);
  const data = snap.exists() ? snap.data() : {};
  if (data.aiSharh || data.explainResult) return;
  const sharh = text || "";
  if (!sharh) return;
  await setDoc(ref, { aiSharh: sharh, explainResult: sharh }, { merge: true });
}

export async function loadChatHistory(articleId) {
  const parent = await getArticleDoc(articleId);
  if (Array.isArray(parent?.aiMuhokama) && parent.aiMuhokama.length) {
    return parent.aiMuhokama.slice().sort((a, b) => (a.createdAtMs || 0) - (b.createdAtMs || 0));
  }
  const ref = collection(db, "articles", articleId, "chats");
  const q = query(ref, orderBy("createdAt", "asc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data());
}

export async function appendChatMessage(articleId, role, content) {
  const ref = doc(db, "articles", articleId);
  const msg = {
    role,
    content: content || "",
    createdAtMs: Date.now()
  };
  await setDoc(ref, { aiMuhokama: arrayUnion(msg) }, { merge: true });
}

// ---- Tarjima keshi ----
// Bratan: mana shu yo'q edi — "UZ TARJIMA" tugmasi bosilganda AI HAR SAFAR
// qayta chaqirilardi, hatto o'sha article ilgari tarjima qilingan bo'lsa ham.
// Endi natija shu yerda saqlanadi, ikkinchi safar Firestore'dan o'qiladi —
// AI umuman chaqirilmaydi (token tejaladi, tezroq ishlaydi).
export async function saveTranslation(articleId, translatedTitle, translatedDesc, originalTitle, originalDesc) {
  const ref = doc(db, "articles", articleId);
  const snap = await getDoc(ref);
  const data = snap.exists() ? snap.data() : {};
  const payload = {};

  if (!data.originalText) {
    const packedOrig = packText(originalTitle || "", originalDesc || "");
    if (packedOrig) payload.originalText = packedOrig;
  }

  if (!data.uzText) {
    const packedUz = packText(translatedTitle || "", translatedDesc || "");
    if (packedUz) {
      payload.uzText = packedUz;
      payload.translatedTitle = translatedTitle || "";
      payload.translatedDesc = translatedDesc || "";
    }
  }

  if (Object.keys(payload).length) {
    await setDoc(ref, payload, { merge: true });
  }
}

// ---- Tarix (kun bo'yicha arxiv) ----

// "days" collection — har kun uchun bitta marker document (id = dateKey).
// Nega alohida collection: Firestore'da "articles" ichidan DISTINCT dateKey
// so'rab bo'lmaydi (bunday query yo'q). Shuning uchun har safar yangi kun
// boshlanganda shu yerga bitta belgi qo'yamiz — TARIX tugmasi bosilganda
// "qaysi kunlar mavjud" ro'yxatini shu yerdan tez va arzon o'qiydi.
export async function markDay(dateKey) {
  const ref = doc(db, "days", dateKey);
  await setDoc(ref, { date: dateKey }, { merge: true });
}

// Oxirgi N ta kun (eng yangisi birinchi). Bittagina orderBy — composite
// index kerak emas, default index bilan ishlaydi.
export async function getRecentDays(maxDays = 30) {
  const ref = collection(db, "days");
  const q = query(ref, orderBy("date", "desc"), limit(maxDays));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.id);
}

// Berilgan kunga tegishli barcha article'lar. Faqat bitta equality filter
// (dateKey == ...) ishlatilgan, orderBy YO'Q — shu sabab composite index
// so'ramaydi. Tartiblashni (eng yangi tepada) client tomonda qilamiz.
export async function getArticlesByDate(dateKey) {
  const ref = collection(db, "articles");
  const q = query(ref, where("dateKey", "==", dateKey));
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.fetchedAt?.seconds || 0) - (a.fetchedAt?.seconds || 0));
}

export async function getArticlesByDateMode(dateKey, mode) {
  const all = await getArticlesByDate(dateKey);
  return all.filter((a) => !mode || a.mode === mode);
}

function slotDocId(dateKey, mode, slot) {
  return `${dateKey}_${mode}_${slot}`;
}

// Slot holati: done = shu vaqtda GNews allaqachon olingan.
export async function getNewsSlot(dateKey, mode, slot) {
  const snap = await getDoc(doc(db, "sync", slotDocId(dateKey, mode, slot)));
  return snap.exists() ? snap.data() : null;
}

// Birinchi tashrif buyuruvchi GNews oladi, qolganlari kutadi yoki keshdan o'qiydi.
export async function claimNewsSlot(dateKey, mode, slot) {
  const ref = doc(db, "sync", slotDocId(dateKey, mode, slot));
  return runTransaction(db, async (t) => {
    const snap = await t.get(ref);
    const now = Date.now();
    if (snap.exists()) {
      const d = snap.data();
      if (d.status === "done") return { action: "cached" };
      if (d.status === "pending" && d.startedAtMs && now - d.startedAtMs < 180000) {
        return { action: "wait" };
      }
    }
    t.set(ref, {
      status: "pending",
      dateKey,
      mode,
      slot,
      startedAtMs: now,
      startedAt: serverTimestamp()
    });
    return { action: "fetch" };
  });
}

export async function finishNewsSlot(dateKey, mode, slot, extra = {}) {
  const ref = doc(db, "sync", slotDocId(dateKey, mode, slot));
  await setDoc(
    ref,
    {
      status: extra.status || "done",
      dateKey,
      mode,
      slot,
      count: extra.count || 0,
      error: extra.error || "",
      finishedAt: serverTimestamp()
    },
    { merge: true }
  );
}

export async function waitForNewsSlot(dateKey, mode, slot, timeoutMs = 25000) {
  const ref = doc(db, "sync", slotDocId(dateKey, mode, slot));
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const snap = await getDoc(ref);
    if (snap.exists() && snap.data().status === "done") return true;
    if (snap.exists() && snap.data().status === "error") return false;
    await new Promise((r) => setTimeout(r, 900));
  }
  return false;
}

// ---- Foydalanuvchi holati (users/{uid}) ----
// Bratan aytdi: localStorage ENDI ISHLATILMAYDI (faqat anonim uid kaliti
// bundan mustasno — u shaxsiy ma'lumot emas, faqat tasodifiy identifikator).
// Tema, rejim/sozlamalar, o'qilgan/keyinroq/ochilgan ro'yxatlari — HAMMASI
// shu bitta hujjatda, Firestore'da saqlanadi.

export async function getUserState(uid) {
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}

// Qisman yangilash — faqat berilgan maydonlar yoziladi (merge:true), qolgani
// tegilmaydi. Ro'yxatlar (read/later/opened) to'liq massiv sifatida yuboriladi
// (arrayUnion emas — chunki o'chirish/qisqartirish ham kerak bo'ladi, masalan
// "later"dan olib tashlash).
export async function saveUserState(uid, partial) {
  const ref = doc(db, "users", uid);
  await setDoc(ref, { ...partial, updatedAt: serverTimestamp() }, { merge: true });
}

// Anonim uid — localStorage'dagi YAGONA kalit (tema bundan mustasno, u
// alohida saqlanadi, chunki sahifa birinchi chizilishidan oldin sinxron
// kerak bo'ladi). Bu shaxsiy ma'lumot emas, faqat tasodifiy identifikator —
// Firestore'dagi "users/{uid}" hujjatini topish uchun ishlatiladi.
export function getOrCreateUid() {
  const KEY = 'fmn-uid';
  try {
    let uid = localStorage.getItem(KEY);
    if (uid && /^[a-z0-9]{16,40}$/i.test(uid)) return uid;
    uid = 'u' + Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    localStorage.setItem(KEY, uid);
    return uid;
  } catch (e) {
    // localStorage butunlay o'chirilgan bo'lsa — sessiya davomida xotirada
    // saqlanadigan vaqtinchalik uid (sahifa yangilanganda yo'qoladi).
    return 'u' + Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
}
