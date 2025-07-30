// firebase.js
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, set, get, child } from 'firebase/database';

const firebaseConfig = {
  apiKey: "AIzaSyAq79Q30UTPeN4UKZE5NyzeWJ3iMiiTNQI",
  authDomain: "wallets-app-772cc.firebaseapp.com",
  databaseURL: "https://wallets-app-772cc-default-rtdb.firebaseio.com",
  projectId: "wallets-app-772cc",
  storageBucket: "wallets-app-772cc.firebasestorage.app",
  messagingSenderId: "438461406823",
  appId: "1:438461406823:web:74fd056844b889af91bec2",
  measurementId: "G-ZKB05194LM"
};

// Inicializa Firebase
const app = initializeApp(firebaseConfig);

// Obtiene instancia de la base de datos
const db = getDatabase(app);

export { db, ref, set, get, child };
