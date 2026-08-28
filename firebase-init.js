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
// explainResult va chat tarixi buzilmaydi).
export async function upsertArticle(articleId, article, mode) {
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
