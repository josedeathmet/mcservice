// firebase.js
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, set, get, child } from 'firebase/database';

const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_DOMAIN,
  databaseURL: process.env.FIREBASE_DTURL,
  projectId: process.env.FIREBASE_PROJEC,
  storageBucket: process.env.FIREBASE_STORG,
  messagingSenderId: process.env.FIREBASE_MASSAG,
  appId: process.env.FIREBASE_APPID,
  measurementId: process.env.FIREBASE_MASURE,
};

// Inicializa Firebase
const app = initializeApp(firebaseConfig);

// Obtiene instancia de la base de datos
const db = getDatabase(app);

export { db, ref, set, get, child };
