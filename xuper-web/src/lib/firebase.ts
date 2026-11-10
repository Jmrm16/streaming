import { initializeApp } from 'firebase/app';
import { getAnalytics, isSupported } from 'firebase/analytics';

export const firebaseConfig = {
  apiKey: 'AIzaSyDwXUJajmOgLGNtg-nWk-1M7GBaY25kFGg',
  authDomain: 'streaming-47a7d.firebaseapp.com',
  projectId: 'streaming-47a7d',
  storageBucket: 'streaming-47a7d.firebasestorage.app',
  messagingSenderId: '964745062613',
  appId: '1:964745062613:web:3a3d1076118022da505a5c',
  measurementId: 'G-FK56VDJDFJ',
};

// Initialize Firebase
export const app = initializeApp(firebaseConfig);

// Initialize Analytics conditionally (only in supported browser environments)
export const initAnalytics = async () => {
  if (typeof window !== 'undefined' && (await isSupported())) {
    return getAnalytics(app);
  }
  return null;
};
