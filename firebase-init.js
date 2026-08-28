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
  serverTimestamp
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
      source: article.source?.name || "",
      publishedAt: article.publishedAt || "",
      mode,
      dateKey: dateKey || "",
      fetchedAt: serverTimestamp()
    },
    { merge: true }
  );
}

export async function getArticleDoc(articleId) {
  const ref = doc(db, "articles", articleId);
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}

// AI "tarjima+tushuntirish" natijasini keshlab qo'yamiz — token tejash uchun.
export async function saveExplainResult(articleId, text) {
  const ref = doc(db, "articles", articleId);
  await setDoc(ref, { explainResult: text }, { merge: true });
}

// Chat tarixi — subcollection, cheksiz o'sishi mumkin, 1MB document limitiga urilmaydi.
export async function loadChatHistory(articleId) {
  const ref = collection(db, "articles", articleId, "chats");
  const q = query(ref, orderBy("createdAt", "asc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data());
}

export async function appendChatMessage(articleId, role, content) {
  const ref = collection(db, "articles", articleId, "chats");
  await addDoc(ref, {
    role,
    content,
    createdAt: serverTimestamp()
  });
}

// ---- Tarjima keshi ----
// Bratan: mana shu yo'q edi — "UZ TARJIMA" tugmasi bosilganda AI HAR SAFAR
// qayta chaqirilardi, hatto o'sha article ilgari tarjima qilingan bo'lsa ham.
// Endi natija shu yerda saqlanadi, ikkinchi safar Firestore'dan o'qiladi —
// AI umuman chaqirilmaydi (token tejaladi, tezroq ishlaydi).
export async function saveTranslation(articleId, translatedTitle, translatedDesc) {
  const ref = doc(db, "articles", articleId);
  await setDoc(
    ref,
    {
      translatedTitle: translatedTitle || "",
      translatedDesc: translatedDesc || ""
    },
    { merge: true }
  );
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
