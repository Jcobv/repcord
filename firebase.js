import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAT_mERjmKL9lq9MidTQsSvBvpxcx5gW7k",
  authDomain: "repcord-5ad82.firebaseapp.com",
  projectId: "repcord-5ad82",
  storageBucket: "repcord-5ad82.firebasestorage.app",
  messagingSenderId: "381450045855",
  appId: "1:381450045855:web:92b9b88f58f38ad28e55aa"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);