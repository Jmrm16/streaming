import { initializeApp } from 'firebase/app';
import { getAnalytics, isSupported } from 'firebase/analytics';
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
  sendEmailVerification,
  sendPasswordResetEmail,
  reload,
  User,
} from 'firebase/auth';
import { getDatabase, ref, set, remove, update, onValue } from 'firebase/database';

export type { User };

export const firebaseConfig = {
  apiKey: 'AIzaSyDwXUJajmOgLGNtg-nWk-1M7GBaY25kFGg',
  authDomain: 'streaming-47a7d.firebaseapp.com',
  databaseURL:
    import.meta.env.VITE_FIREBASE_DATABASE_URL ||
    'https://streaming-47a7d-default-rtdb.firebaseio.com',
  projectId: 'streaming-47a7d',
  storageBucket: 'streaming-47a7d.firebasestorage.app',
  messagingSenderId: '964745062613',
  appId: '1:964745062613:web:3a3d1076118022da505a5c',
  measurementId: 'G-FK56VDJDFJ',
};

// Initialize Firebase
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
auth.languageCode = 'es';
export const db = getDatabase(app);

// Initialize Analytics conditionally (only in supported browser environments)
export const initAnalytics = async () => {
  if (typeof window !== 'undefined' && (await isSupported())) {
    return getAnalytics(app);
  }
  return null;
};

// ============================================================
// Watch History & Episode Progress Types
// ============================================================
export interface WatchProgressItem {
  id: string; // Main movie or series ID
  title: string;
  poster?: string;
  backdrop?: string;
  landscape?: string;
  type?: 'movie' | 'series' | 'teleplay' | string;
  kind?: string;
  category?: string;
  year?: string;
  score?: string;
  durationText?: string;
  synopsis?: string;
  genres?: string[];
  // Playback progress data
  currentTime: number; // Seconds
  duration: number; // Total duration in seconds
  progressPercent: number; // 1..100
  updatedAt: number; // Timestamp ms
  // Optional series episode metadata
  episodeId?: string;
  seasonId?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  episodeTitle?: string;
  subtitle?: string;
}

export interface EpisodeProgressEntry {
  episodeId: string;
  seasonId?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  currentTime: number;
  duration: number;
  progressPercent: number;
  updatedAt: number;
}

export const WATCH_UPDATED_EVENT = 'maicaoflix-watch-updated';
export const AUTH_VERIFIED_EVENT = 'maicaoflix-auth-verified';
const MAX_HISTORY_ITEMS = 60;

// ============================================================
// Authentication Helpers
// ============================================================
export const loginWithEmail = async (email: string, password: string) => {
  return signInWithEmailAndPassword(auth, email.trim(), password);
};

export const registerWithEmail = async (
  email: string,
  password: string,
  displayName?: string
) => {
  const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
  const cleanName = displayName?.trim();
  if (cleanName) {
    await updateProfile(cred.user, { displayName: cleanName });
  }
  await sendEmailVerification(cred.user);
  return cred;
};

const ensureAuthUser = async (email?: string, password?: string): Promise<User | null> => {
  if (auth.currentUser) return auth.currentUser;
  if (email?.trim() && password) {
    const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
    return cred.user;
  }
  return null;
};

const emitAuthVerifiedEvent = () => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(AUTH_VERIFIED_EVENT));
  }
};

export const resendVerificationEmail = async (email?: string, password?: string) => {
  const user = await ensureAuthUser(email, password);
  if (!user) {
    throw new Error('Inicia sesión primero para reenviar el correo de verificación.');
  }
  await reload(user);
  if (user.emailVerified) {
    emitAuthVerifiedEvent();
    return { alreadyVerified: true };
  }
  await sendEmailVerification(user);
  return { alreadyVerified: false };
};

export const verifyEmailStatus = async (
  email?: string,
  password?: string
): Promise<{ verified: boolean; user: User | null }> => {
  const user = await ensureAuthUser(email, password);
  if (!user) {
    return { verified: false, user: null };
  }
  await reload(user);
  if (user.emailVerified) {
    await user.getIdToken(true);
    emitAuthVerifiedEvent();
    return { verified: true, user: auth.currentUser || user };
  }
  return { verified: false, user };
};

export const sendPasswordReset = async (email: string) => {
  return sendPasswordResetEmail(auth, email.trim());
};

export const logoutUser = async () => {
  return signOut(auth);
};

export const subscribeToAuth = (cb: (user: User | null) => void) => {
  const emit = (user: User | null) => {
    if (user && user.emailVerified) {
      cb(user);
    } else {
      cb(null);
    }
  };
  const unsubAuth = onAuthStateChanged(auth, emit);
  const handleVerified = () => {
    emit(auth.currentUser);
  };
  if (typeof window !== 'undefined') {
    window.addEventListener(AUTH_VERIFIED_EVENT, handleVerified);
  }
  return () => {
    unsubAuth();
    if (typeof window !== 'undefined') {
      window.removeEventListener(AUTH_VERIFIED_EVENT, handleVerified);
    }
  };
};

export const getFriendlyAuthError = (err: unknown): string => {
  const code = (err as { code?: string; message?: string })?.code || '';
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/user-not-found':
    case 'auth/wrong-password':
      return 'Correo o contraseña incorrectos. Verifica tus datos e inténtalo de nuevo.';
    case 'auth/email-already-in-use':
      return 'Este correo ya está registrado. Intenta iniciar sesión.';
    case 'auth/weak-password':
      return 'La contraseña es muy débil. Usa al menos 6 caracteres.';
    case 'auth/invalid-email':
      return 'El formato del correo electrónico no es válido.';
    case 'auth/too-many-requests':
      return 'Demasiados intentos seguidos. Espera un momento e inténtalo nuevamente.';
    case 'auth/operation-not-allowed':
      return 'El inicio de sesión con correo y contraseña aún no está habilitado en Firebase Authentication.';
    case 'auth/network-request-failed':
      return 'Sin conexión a internet. Verifica tu red e inténtalo de nuevo.';
    default:
      return (
        (err as { message?: string })?.message ||
        'No se pudo completar la autenticación. Inténtalo nuevamente.'
      );
  }
};

// ============================================================
// Realtime Database + Local Mirror Helpers
// ============================================================
export const sanitizeFirebaseKey = (key: string): string => {
  return String(key || 'unknown').replace(/[.#$/[\]]/g, '_');
};

export const cleanUndefined = <T extends Record<string, unknown>>(obj: T): Partial<T> => {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null) {
      if (Array.isArray(v)) {
        result[k] = v.filter((el) => el !== undefined && el !== null);
      } else if (typeof v === 'object' && !(v instanceof Date)) {
        result[k] = cleanUndefined(v as Record<string, unknown>);
      } else {
        result[k] = v;
      }
    }
  }
  return result as Partial<T>;
};

export const formatPlaybackTime = (seconds: number): string => {
  if (!seconds || isNaN(seconds) || !isFinite(seconds) || seconds <= 0) {
    return '0:00';
  }
  const totalSecs = Math.floor(seconds);
  const hrs = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  if (hrs > 0) {
    return `${hrs}:${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
};

const getWatchStorageKey = (uid: string | null) =>
  `maicaoflix_watch_history_${uid || 'guest'}`;

const getEpisodeStorageKey = (uid: string | null) =>
  `maicaoflix_ep_progress_${uid || 'guest'}`;

const readLocalWatchHistory = (uid: string | null): WatchProgressItem[] => {
  try {
    const raw = localStorage.getItem(getWatchStorageKey(uid));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is WatchProgressItem => Boolean(item && item.id))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .slice(0, MAX_HISTORY_ITEMS);
  } catch {
    return [];
  }
};

const writeLocalWatchHistory = (uid: string | null, items: WatchProgressItem[]) => {
  try {
    const sorted = items
      .slice()
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .slice(0, MAX_HISTORY_ITEMS);
    localStorage.setItem(getWatchStorageKey(uid), JSON.stringify(sorted));
  } catch {
    // Ignore storage quota errors
  }
};

const readLocalEpisodeMap = (
  uid: string | null
): Record<string, Record<string, EpisodeProgressEntry>> => {
  try {
    const raw = localStorage.getItem(getEpisodeStorageKey(uid));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const writeLocalEpisodeMap = (
  uid: string | null,
  map: Record<string, Record<string, EpisodeProgressEntry>>
) => {
  try {
    localStorage.setItem(getEpisodeStorageKey(uid), JSON.stringify(map));
  } catch {
    // Ignore storage quota errors
  }
};

const notifyLocalWatchUpdated = (uid: string | null) => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(WATCH_UPDATED_EVENT, { detail: { uid } }));
  }
};

const mergeGuestHistoryToUser = async (uid: string) => {
  const guestHistory = readLocalWatchHistory(null);
  const guestEpisodes = readLocalEpisodeMap(null);
  if (guestHistory.length === 0 && Object.keys(guestEpisodes).length === 0) {
    return;
  }

  // Merge local storage records
  const userHistory = readLocalWatchHistory(uid);
  const mergedMap = new Map<string, WatchProgressItem>();
  for (const item of userHistory) {
    mergedMap.set(item.id, item);
  }
  const rtdbUpdates: Record<string, unknown> = {};

  for (const guestItem of guestHistory) {
    const existing = mergedMap.get(guestItem.id);
    if (!existing || (guestItem.updatedAt || 0) > (existing.updatedAt || 0)) {
      mergedMap.set(guestItem.id, guestItem);
      const safeKey = sanitizeFirebaseKey(guestItem.id);
      rtdbUpdates[`users/${uid}/watchHistory/${safeKey}`] = cleanUndefined(
        guestItem as unknown as Record<string, unknown>
      );
    }
  }

  const userEpisodes = readLocalEpisodeMap(uid);
  for (const [seriesId, eps] of Object.entries(guestEpisodes)) {
    const safeSeriesKey = sanitizeFirebaseKey(seriesId);
    if (!userEpisodes[seriesId]) userEpisodes[seriesId] = {};
    for (const [epId, entry] of Object.entries(eps || {})) {
      const existingEp = userEpisodes[seriesId][epId];
      if (!existingEp || (entry.updatedAt || 0) > (existingEp.updatedAt || 0)) {
        userEpisodes[seriesId][epId] = entry;
        const safeEpKey = sanitizeFirebaseKey(epId);
        rtdbUpdates[`users/${uid}/episodeProgress/${safeSeriesKey}/${safeEpKey}`] =
          cleanUndefined(entry as unknown as Record<string, unknown>);
      }
    }
  }

  writeLocalWatchHistory(uid, Array.from(mergedMap.values()));
  writeLocalEpisodeMap(uid, userEpisodes);

  try {
    localStorage.removeItem(getWatchStorageKey(null));
    localStorage.removeItem(getEpisodeStorageKey(null));
  } catch {
    // ignore
  }

  if (Object.keys(rtdbUpdates).length > 0) {
    try {
      await update(ref(db), rtdbUpdates);
    } catch (err) {
      console.warn('Could not sync migrated guest history to RTDB:', err);
    }
  }
};

export const saveWatchProgress = (uid: string | null, item: WatchProgressItem) => {
  const safeCurrentTime = Math.max(0, Math.round(item.currentTime));
  const safeDuration = Math.max(0, Math.round(item.duration));
  const computedPercent =
    safeDuration > 0
      ? Math.min(100, Math.max(1, Math.round((safeCurrentTime / safeDuration) * 100)))
      : item.progressPercent || 1;

  const normalizedItem: WatchProgressItem = {
    ...item,
    currentTime: safeCurrentTime,
    duration: safeDuration,
    progressPercent: computedPercent,
    updatedAt: item.updatedAt || Date.now(),
  };

  // 1. Update local watch history immediately
  const currentList = readLocalWatchHistory(uid).filter(
    (entry) => entry.id !== normalizedItem.id
  );
  writeLocalWatchHistory(uid, [normalizedItem, ...currentList]);

  // 2. Update episode progress map if series episode
  let epEntry: EpisodeProgressEntry | null = null;
  if (normalizedItem.episodeId) {
    epEntry = {
      episodeId: normalizedItem.episodeId,
      seasonId: normalizedItem.seasonId,
      seasonNumber: normalizedItem.seasonNumber,
      episodeNumber: normalizedItem.episodeNumber,
      currentTime: normalizedItem.currentTime,
      duration: normalizedItem.duration,
      progressPercent: normalizedItem.progressPercent,
      updatedAt: normalizedItem.updatedAt,
    };
    const epMap = readLocalEpisodeMap(uid);
    if (!epMap[normalizedItem.id]) epMap[normalizedItem.id] = {};
    epMap[normalizedItem.id][normalizedItem.episodeId] = epEntry;
    writeLocalEpisodeMap(uid, epMap);
  }

  notifyLocalWatchUpdated(uid);

  // 3. Persist to Firebase Realtime Database when signed in
  if (uid) {
    const safeItemKey = sanitizeFirebaseKey(normalizedItem.id);
    set(
      ref(db, `users/${uid}/watchHistory/${safeItemKey}`),
      cleanUndefined(normalizedItem as unknown as Record<string, unknown>)
    ).catch((err) => {
      console.warn('RTDB saveWatchProgress error:', err);
    });

    if (normalizedItem.episodeId && epEntry) {
      const safeEpKey = sanitizeFirebaseKey(normalizedItem.episodeId);
      set(
        ref(db, `users/${uid}/episodeProgress/${safeItemKey}/${safeEpKey}`),
        cleanUndefined(epEntry as unknown as Record<string, unknown>)
      ).catch((err) => {
        console.warn('RTDB saveEpisodeProgress error:', err);
      });
    }
  }
};

export const removeWatchProgress = (uid: string | null, mediaId: string) => {
  const nextList = readLocalWatchHistory(uid).filter((entry) => entry.id !== mediaId);
  writeLocalWatchHistory(uid, nextList);
  notifyLocalWatchUpdated(uid);

  if (uid) {
    const safeItemKey = sanitizeFirebaseKey(mediaId);
    remove(ref(db, `users/${uid}/watchHistory/${safeItemKey}`)).catch((err) => {
      console.warn('RTDB removeWatchProgress error:', err);
    });
  }
};

export const clearAllWatchHistory = (uid: string | null) => {
  writeLocalWatchHistory(uid, []);
  writeLocalEpisodeMap(uid, {});
  notifyLocalWatchUpdated(uid);

  if (uid) {
    remove(ref(db, `users/${uid}/watchHistory`)).catch((err) => {
      console.warn('RTDB clearAllWatchHistory error:', err);
    });
    remove(ref(db, `users/${uid}/episodeProgress`)).catch((err) => {
      console.warn('RTDB clearAllEpisodeProgress error:', err);
    });
  }
};

export const subscribeWatchHistory = (
  uid: string | null,
  onUpdate: (items: WatchProgressItem[]) => void,
  onEpisodeMapUpdate?: (map: Record<string, Record<string, EpisodeProgressEntry>>) => void
) => {
  let isDisposed = false;

  // Emit current local snapshot immediately
  onUpdate(readLocalWatchHistory(uid));
  if (onEpisodeMapUpdate) {
    onEpisodeMapUpdate(readLocalEpisodeMap(uid));
  }

  const handleLocalEvent = (event: Event) => {
    const detailUid = (event as CustomEvent<{ uid?: string | null }>)?.detail?.uid;
    if (detailUid !== undefined && detailUid !== uid) return;
    if (isDisposed) return;
    onUpdate(readLocalWatchHistory(uid));
    if (onEpisodeMapUpdate) {
      onEpisodeMapUpdate(readLocalEpisodeMap(uid));
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener(WATCH_UPDATED_EVENT, handleLocalEvent);
  }

  let unsubHistory: (() => void) | null = null;
  let unsubEpisodes: (() => void) | null = null;

  if (uid) {
    mergeGuestHistoryToUser(uid).then(() => {
      if (isDisposed) return;
      onUpdate(readLocalWatchHistory(uid));
      if (onEpisodeMapUpdate) {
        onEpisodeMapUpdate(readLocalEpisodeMap(uid));
      }
    });

    const historyRef = ref(db, `users/${uid}/watchHistory`);
    unsubHistory = onValue(
      historyRef,
      (snapshot) => {
        if (isDisposed) return;
        const val = snapshot.val();
        if (!val || typeof val !== 'object') {
          writeLocalWatchHistory(uid, []);
          onUpdate([]);
          return;
        }
        const items = Object.values(val)
          .filter((entry): entry is WatchProgressItem => Boolean(entry && (entry as WatchProgressItem).id))
          .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
          .slice(0, MAX_HISTORY_ITEMS);
        writeLocalWatchHistory(uid, items);
        onUpdate(items);
      },
      (err) => {
        console.warn('RTDB watchHistory listener warning:', err);
      }
    );

    if (onEpisodeMapUpdate) {
      const episodesRef = ref(db, `users/${uid}/episodeProgress`);
      unsubEpisodes = onValue(
        episodesRef,
        (snapshot) => {
          if (isDisposed) return;
          const val = snapshot.val();
          if (!val || typeof val !== 'object') {
            writeLocalEpisodeMap(uid, {});
            onEpisodeMapUpdate({});
            return;
          }
          const cloudMap: Record<string, Record<string, EpisodeProgressEntry>> = {};
          const currentHistory = readLocalWatchHistory(uid);
          const safeKeyToRawId = new Map<string, string>();
          for (const h of currentHistory) {
            safeKeyToRawId.set(sanitizeFirebaseKey(h.id), h.id);
          }
          for (const [seriesKey, rawEps] of Object.entries(val)) {
            if (!rawEps || typeof rawEps !== 'object') continue;
            const resolvedSeriesId = safeKeyToRawId.get(seriesKey) || seriesKey;
            cloudMap[resolvedSeriesId] = {};
            for (const entry of Object.values(rawEps as Record<string, EpisodeProgressEntry>)) {
              if (entry && entry.episodeId) {
                cloudMap[resolvedSeriesId][entry.episodeId] = entry;
              }
            }
          }
          writeLocalEpisodeMap(uid, cloudMap);
          onEpisodeMapUpdate(cloudMap);
        },
        (err) => {
          console.warn('RTDB episodeProgress listener warning:', err);
        }
      );
    }
  }

  return () => {
    isDisposed = true;
    if (typeof window !== 'undefined') {
      window.removeEventListener(WATCH_UPDATED_EVENT, handleLocalEvent);
    }
    if (unsubHistory) unsubHistory();
    if (unsubEpisodes) unsubEpisodes();
  };
};
