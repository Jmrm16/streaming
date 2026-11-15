import React, { useEffect, useState, useMemo, useRef, useCallback, useDeferredValue, useTransition } from 'react';
import {
  Search,
  Play,
  Info,
  X,
  ChevronDown,
  Heart,
  RefreshCw,
  Server,
  Tv,
  Film,
  Clapperboard,
  Sparkles,
  Star,
  User,
  Activity,
  Check,
  Plus,
  ArrowRight,
  ArrowLeft,
  Loader2,
  Home,
  Smile,
  Settings,
  Lock,
  LogIn,
  LogOut,
  History,
  Trash2,
  Cloud,
  CloudOff,
} from 'lucide-react';
import { MaicaoflixLogo } from './components/MaicaoflixLogo';
import { NetflixRow } from './components/NetflixRow';
import { MediaDetailPage, EpisodePlaybackMeta } from './components/MediaDetailPage';
import { Player, cleanEpisodeTitleText } from './components/Player';
import { SettingsModal } from './components/SettingsModal';
import { AuthModal } from './components/AuthModal';
import {
  subscribeToAuth,
  logoutUser,
  subscribeWatchHistory,
  saveWatchProgress,
  removeWatchProgress,
  clearAllWatchHistory,
  formatPlaybackTime,
  User as FirebaseUser,
  WatchProgressItem,
  EpisodeProgressEntry,
} from './lib/firebase';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Badge } from './components/ui/badge';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
} from './components/ui/alert-dialog';
import {
  api,
  Channel,
  Episode,
  Season,
  MediaItem,
  SubtitleTrack,
  AudioLanguage,
  getApiBaseUrl,
  setApiBaseUrl,
  isAdultCategory,
  isAdultChannel,
} from './services/api';

type TabView = 'home' | 'series' | 'movies' | 'live' | 'anime' | 'kids' | 'favorites';
const LIVE_CHANNEL_PAGE_SIZE = 120;
const CATALOG_PAGE_SIZE = 72;
const SEARCH_RESULT_LIMIT = 48;
const normalizeFilterValue = (value: string) => value.trim().toLocaleLowerCase('es');

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabView>('home');
  const [isBackendOnline, setIsBackendOnline] = useState<boolean | null>(null);
  const [apiUrl, setApiUrlState] = useState(getApiBaseUrl());

  // Data states
  const [homeFeatured, setHomeFeatured] = useState<MediaItem[]>([]);
  const [movies, setMovies] = useState<MediaItem[]>([]);
  const [series, setSeries] = useState<MediaItem[]>([]);
  const [anime, setAnime] = useState<MediaItem[]>([]);
  const [kids, setKids] = useState<MediaItem[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [isPublicLiveMode, setIsPublicLiveMode] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [liveQuery, setLiveQuery] = useState('');
  const [liveSort, setLiveSort] = useState<'recommended' | 'title'>('recommended');
  const [liveVisibleLimit, setLiveVisibleLimit] = useState(LIVE_CHANNEL_PAGE_SIZE);
  const [selectedGenre, setSelectedGenre] = useState<string>('all');
  const [sortOption, setSortOption] = useState<string>('recommended');
  const [catalogVisibleLimit, setCatalogVisibleLimit] = useState(CATALOG_PAGE_SIZE);
  const [isCatalogFiltering, startCatalogFiltering] = useTransition();

  // Search states
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<MediaItem[]>([]);
  const [channelSearchResults, setChannelSearchResults] = useState<Channel[]>([]);
  const [searchFilterTab, setSearchFilterTab] = useState<'all' | 'media' | 'channels'>('all');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const searchRequestRef = useRef(0);
  const searchAbortRef = useRef<AbortController | null>(null);
  const deferredSearchQuery = useDeferredValue(searchQuery);

  // Pagination & Loading
  const [isLoading, setIsLoading] = useState(true);
  const [initialLoadFailed, setInitialLoadFailed] = useState(false);
  const [catalogPages, setCatalogPages] = useState<Record<string, number>>({
    movies: 1,
    series: 1,
    anime: 1,
    kids: 1,
  });
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMoreMap, setHasMoreMap] = useState<Record<string, boolean>>({
    movies: true,
    series: true,
    anime: true,
    kids: true,
  });

  // Favorites (Stored in localStorage)
  const [favChannels, setFavChannels] = useState<Channel[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('xuper_fav_channels') || '[]');
    } catch {
      return [];
    }
  });
  const [favMedia, setFavMedia] = useState<MediaItem[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('xuper_fav_media') || '[]');
    } catch {
      return [];
    }
  });

  // UI state
  const [scrolled, setScrolled] = useState(false);
  const [profileName, setProfileName] = useState(() => {
    return localStorage.getItem('maicaoflix_profile_name') || 'Invitado';
  });
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [exploreMenuOpen, setExploreMenuOpen] = useState(false);
  const [alertModal, setAlertModal] = useState<{ open: boolean; title: string; description: string } | null>(null);
  const [toastMessage, setToastMessage] = useState('');

  // Parental Control (+18 Live TV Security)
  const [adultPin, setAdultPin] = useState<string>(() => {
    return localStorage.getItem('maicaoflix_adult_pin') || '1234';
  });
  const [hideAdultCategory, setHideAdultCategory] = useState<boolean>(() => {
    return localStorage.getItem('maicaoflix_hide_adult') === '1';
  });
  const [isAdultUnlocked, setIsAdultUnlocked] = useState<boolean>(false);
  const [pinModal, setPinModal] = useState<{
    open: boolean;
    pendingCategoryId?: string;
    pendingChannel?: Channel;
  }>({ open: false });
  const [pinInput, setPinInput] = useState<string>('');
  const [pinError, setPinError] = useState<string>('');

  // Auth & Watch History (Firebase Auth + Realtime Database)
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<'login' | 'register'>('login');
  const [watchHistory, setWatchHistory] = useState<WatchProgressItem[]>([]);
  const [episodeProgressMap, setEpisodeProgressMap] = useState<
    Record<string, Record<string, EpisodeProgressEntry>>
  >({});

  // Dedicated Detail Page & Playback
  const [selectedMedia, setSelectedMedia] = useState<MediaItem | null>(null);
  const [activePlayback, setActivePlayback] = useState<{
    url: string;
    title: string;
    subtitle?: string;
    isLive?: boolean;
    initialTime?: number;
    subtitles?: SubtitleTrack[];
    audioLanguages?: AudioLanguage[];
    contentId?: string;
    seriesId?: string;
    mediaItem?: MediaItem;
    episodeMeta?: EpisodePlaybackMeta;
  } | null>(null);

  const headerRef = useRef<HTMLElement>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activePlaybackRef = useRef(activePlayback);
  activePlaybackRef.current = activePlayback;

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => {
      setToastMessage('');
    }, 3200);
  }, []);

  // Listen to Firebase Auth state
  useEffect(() => {
    const unsub = subscribeToAuth((user) => {
      setCurrentUser(user);
      if (user) {
        const display =
          user.displayName?.trim() ||
          user.email?.split('@')[0] ||
          'Usuario';
        setProfileName(display);
      } else {
        setProfileName(localStorage.getItem('maicaoflix_profile_name') || 'Invitado');
      }
    });
    return () => unsub();
  }, []);

  // Subscribe to Watch History in Firebase Realtime Database (+ instant local mirror)
  useEffect(() => {
    return subscribeWatchHistory(
      currentUser?.uid || null,
      (items) => setWatchHistory(items),
      (epMap) => setEpisodeProgressMap(epMap)
    );
  }, [currentUser?.uid]);

  const watchProgressMap = useMemo(() => {
    const map: Record<string, WatchProgressItem> = {};
    for (const entry of watchHistory) {
      if (entry.id) map[entry.id] = entry;
    }
    return map;
  }, [watchHistory]);

  const watchHistoryMediaItems = useMemo<MediaItem[]>(() => {
    return watchHistory.map((entry) => ({
      id: entry.id,
      title: entry.title,
      poster: entry.poster || entry.landscape || entry.backdrop || '',
      backdrop: entry.backdrop || entry.landscape || entry.poster || '',
      landscape: entry.landscape || entry.backdrop || entry.poster || '',
      type: (entry.type as MediaItem['type']) || (entry.episodeId ? 'series' : 'movie'),
      kind: entry.kind,
      category: entry.category,
      year: entry.year,
      score: entry.score,
      duration: entry.durationText,
      synopsis: entry.synopsis,
      genres: entry.genres,
    }));
  }, [watchHistory]);

  const handlePlaybackProgress = useCallback(
    (currentTime: number, duration: number) => {
      const pb = activePlaybackRef.current;
      if (!pb || pb.isLive || !pb.mediaItem || !duration || !isFinite(duration)) return;
      saveWatchProgress(currentUser?.uid || null, {
        id: pb.mediaItem.id,
        title: pb.mediaItem.title,
        poster: pb.mediaItem.poster,
        backdrop: pb.mediaItem.backdrop,
        landscape: pb.mediaItem.landscape,
        type: pb.mediaItem.type,
        kind: pb.mediaItem.kind,
        category: pb.mediaItem.category,
        year: pb.mediaItem.year,
        score: pb.mediaItem.score,
        durationText: pb.mediaItem.duration,
        synopsis: pb.mediaItem.synopsis,
        genres: pb.mediaItem.genres,
        currentTime,
        duration,
        progressPercent: Math.min(100, Math.max(1, Math.round((currentTime / duration) * 100))),
        updatedAt: Date.now(),
        episodeId: pb.episodeMeta ? pb.contentId : undefined,
        seasonId: pb.episodeMeta?.seasonId || pb.seriesId,
        seasonNumber: pb.episodeMeta?.seasonNumber,
        episodeNumber: pb.episodeMeta?.episodeNumber,
        episodeTitle: pb.episodeMeta?.episodeTitle,
        subtitle: pb.subtitle,
      });
    },
    [currentUser?.uid]
  );

  const handleRemoveWatchItem = useCallback(
    (e: React.MouseEvent, item: MediaItem) => {
      e.stopPropagation();
      removeWatchProgress(currentUser?.uid || null, item.id);
      showToast(`"${item.title}" quitado de Continuar viendo.`);
    },
    [currentUser?.uid, showToast]
  );

  const handleDirectResume = useCallback(
    async (item: MediaItem, prog: WatchProgressItem) => {
      const resumeAt = prog.progressPercent >= 96 ? 0 : prog.currentTime;
      showToast(
        resumeAt > 5
          ? `Reanudando "${item.title}" desde ${formatPlaybackTime(resumeAt)}...`
          : `Cargando "${item.title}"...`
      );
      try {
        if (prog.episodeId) {
          const seriesId = prog.seasonId || item.id;
          const res = await api.resolveMedia(prog.episodeId, seriesId);
          if (res && res.url) {
            const epLabel =
              prog.subtitle ||
              `T${prog.seasonNumber || 1} : E${prog.episodeNumber || 1}${
                prog.episodeTitle ? ` — ${prog.episodeTitle}` : ''
              }`;
            setActivePlayback({
              url: res.url,
              title: item.title,
              subtitle: epLabel,
              isLive: false,
              initialTime: resumeAt,
              subtitles: res.subtitles,
              audioLanguages: res.audioLanguages,
              contentId: prog.episodeId,
              seriesId,
              mediaItem: item,
              episodeMeta: {
                seasonId: seriesId,
                seasonNumber: prog.seasonNumber || 1,
                episodeNumber: prog.episodeNumber || 1,
                episodeTitle: prog.episodeTitle || '',
              },
            });
            return;
          }
        } else {
          const res = await api.resolveMedia(item.id);
          if (res && res.url) {
            setActivePlayback({
              url: res.url,
              title: item.title,
              subtitle:
                prog.subtitle ||
                (item.year && item.year !== '—' ? `Película • ${item.year}` : 'Película'),
              isLive: false,
              initialTime: resumeAt,
              subtitles: res.subtitles,
              audioLanguages: res.audioLanguages,
              contentId: item.id,
              mediaItem: item,
            });
            return;
          }
        }
      } catch (err) {
        console.warn('Direct resume failed, falling back to detail page:', err);
      }
      openMediaDetail(item);
    },
    [showToast]
  );

  // Listen to window scroll to trigger solid header
  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Browser back button support for full-page detail view
  useEffect(() => {
    const handlePopState = () => {
      if (!window.location.hash.startsWith('#detalle')) {
        setSelectedMedia(null);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const openMediaDetail = (item: MediaItem) => {
    setSelectedMedia(item);
    window.location.hash = `#detalle-${encodeURIComponent(item.id)}`;
  };

  const closeMediaDetail = () => {
    if (window.location.hash.startsWith('#detalle')) {
      window.history.back();
    } else {
      setSelectedMedia(null);
    }
  };

  // Check backend connectivity
  const checkBackend = useCallback(async () => {
    const online = await api.checkStatus();
    setIsBackendOnline(online);
  }, []);

  useEffect(() => {
    checkBackend();
    const interval = setInterval(checkBackend, 30000);
    return () => clearInterval(interval);
  }, [checkBackend]);

  // Sync favorites with localStorage
  useEffect(() => {
    try {
      localStorage.setItem('xuper_fav_channels', JSON.stringify(favChannels));
    } catch (e) {
      console.warn('Failed to save fav channels:', e);
    }
  }, [favChannels]);

  useEffect(() => {
    try {
      localStorage.setItem('xuper_fav_media', JSON.stringify(favMedia));
    } catch (e) {
      console.warn('Failed to save fav media:', e);
    }
  }, [favMedia]);

  const isMediaFav = useCallback(
    (id: string) => favMedia.some((m) => m.id === id),
    [favMedia]
  );

  const isChannelFav = useCallback(
    (id: string) =>
      favChannels.some(
        (c) =>
          (c.channelCode && c.channelCode === id) || (c.id && c.id === id)
      ),
    [favChannels]
  );

  const toggleFavoriteMedia = useCallback(
    (e: React.MouseEvent | undefined, item: MediaItem) => {
      if (e) e.stopPropagation();
      setFavMedia((prev) => {
        const exists = prev.some((m) => m.id === item.id);
        if (exists) {
          showToast(`"${item.title}" se quitó de Mi lista.`);
          return prev.filter((m) => m.id !== item.id);
        } else {
          showToast(`"${item.title}" se añadió a Mi lista.`);
          return [item, ...prev];
        }
      });
    },
    [showToast]
  );

  const toggleFavoriteChannel = useCallback(
    (e: React.MouseEvent, ch: Channel) => {
      e.stopPropagation();
      const code = ch.channelCode || ch.id;
      setFavChannels((prev) => {
        const exists = prev.some(
          (c) => (c.channelCode && c.channelCode === code) || (c.id && c.id === code)
        );
        if (exists) {
          showToast(`"${ch.name}" se quitó de Mi lista.`);
          return prev.filter(
            (c) => (c.channelCode && c.channelCode !== code) || (c.id && c.id !== code)
          );
        } else {
          showToast(`"${ch.name}" se añadió a Mi lista.`);
          return [ch, ...prev];
        }
      });
    },
    [showToast]
  );

  // Close menus when clicking outside
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (headerRef.current && !headerRef.current.contains(e.target as Node)) {
        setIsProfileMenuOpen(false);
        setExploreMenuOpen(false);
      }
    };
    document.addEventListener('click', handleOutsideClick);
    return () => document.removeEventListener('click', handleOutsideClick);
  }, []);

  // Desktop search click outside handler
  useEffect(() => {
    const handleSearchOutsideClick = (e: MouseEvent) => {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(e.target as Node)
      ) {
        if (!searchQuery) {
          setIsSearchOpen(false);
        }
      }
    };
    document.addEventListener('click', handleSearchOutsideClick);
    return () => document.removeEventListener('click', handleSearchOutsideClick);
  }, [searchQuery]);

  // Keyboard shortcut '/' for search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault();
        setIsSearchOpen(true);
        setTimeout(() => searchInputRef.current?.focus(), 50);
      } else if (e.key === 'Escape' && isSearchOpen) {
        setIsSearchOpen(false);
        setSearchQuery('');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSearchOpen]);

  // Initial Data Load
  const loadInitialData = useCallback(async (force = false) => {
    setIsLoading(true);
    setInitialLoadFailed(false);
    try {
      const [feat, mov, ser, anim, kid, cats, chs] = await Promise.all([
        api.getHome('featured', 1, force),
        api.getHome('movies', 1, force),
        api.getHome('series', 1, force),
        api.getHome('anime', 1, force),
        api.getHome('kids', 1, force),
        api.getLiveColumns(force),
        api.getLiveChannels('all', 1, 100, force),
      ]);

      if (feat.length > 0) setHomeFeatured(feat);
      if (mov.length > 0) setMovies(mov);
      if (ser.length > 0) setSeries(ser);
      if (anim.length > 0) setAnime(anim);
      if (kid.length > 0) setKids(kid);

      let hasLive = chs.length > 0;
      if (hasLive) {
        setIsPublicLiveMode(false);
        if (cats.length > 0) setCategories(cats);
        setChannels(chs);
      } else {
        const publicLiveCatalog = await api.getPublicLiveCatalog(force);
        if (publicLiveCatalog.channels.length > 0) {
          hasLive = true;
          setIsPublicLiveMode(true);
          setCategories(publicLiveCatalog.categories);
          setChannels(publicLiveCatalog.channels);
        }
      }

      setInitialLoadFailed(
        feat.length === 0 &&
          mov.length === 0 &&
          ser.length === 0 &&
          anim.length === 0 &&
          kid.length === 0 &&
          !hasLive
      );
    } catch (err) {
      console.error('Error loading initial data:', err);
      setInitialLoadFailed(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  // Category change for Live TV
  const loadCategoryChannels = async (catId: string) => {
    setSelectedCategory(catId);
    setLiveVisibleLimit(LIVE_CHANNEL_PAGE_SIZE);
    if (isPublicLiveMode) return;
    setIsLoading(true);
    try {
      const chs = await api.getLiveChannels(catId, 1, 200, false);
      setChannels(chs);
    } catch (err) {
      console.error('Error fetching category channels:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCategorySelect = async (catId: string) => {
    const catObj = categories.find((c) => c.id === catId);
    if (isAdultCategory(catObj || { id: catId }) && !isAdultUnlocked) {
      setPinInput('');
      setPinError('');
      setPinModal({ open: true, pendingCategoryId: catId });
      return;
    }
    await loadCategoryChannels(catId);
  };

  const handleLockAdultSection = async () => {
    setIsAdultUnlocked(false);
    showToast('Sección +18 bloqueada con éxito.');
    const currentCatObj = categories.find((c) => c.id === selectedCategory);
    if (isAdultCategory(currentCatObj || { id: selectedCategory })) {
      await loadCategoryChannels('all');
    }
  };

  const handleVerifyAdultPin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pinInput.trim() !== adultPin) {
      setPinError('Código PIN incorrecto. Inténtalo de nuevo.');
      return;
    }
    const targetCat = pinModal.pendingCategoryId;
    const targetCh = pinModal.pendingChannel;
    setIsAdultUnlocked(true);
    setPinModal({ open: false });
    setPinInput('');
    setPinError('');
    showToast('Control Parental: Sección +18 desbloqueada temporalmente.');
    if (targetCat) {
      await loadCategoryChannels(targetCat);
    } else if (targetCh) {
      await playChannel(targetCh, true);
    }
  };

  // Load more pagination for catalogs
  const handleLoadMore = async () => {
    if (activeTab === 'home' || activeTab === 'live' || activeTab === 'favorites') return;
    const nextPage = (catalogPages[activeTab] || 1) + 1;
    setIsLoadingMore(true);

    try {
      const rootType =
        activeTab === 'movies'
          ? 'movies'
          : activeTab === 'series'
          ? 'series'
          : activeTab === 'anime'
          ? 'anime'
          : 'kids';

      const newItems = await api.getHome(rootType, nextPage, false);

      if (newItems.length === 0) {
        setHasMoreMap((prev) => ({ ...prev, [activeTab]: false }));
      } else {
        setCatalogPages((prev) => ({ ...prev, [activeTab]: nextPage }));
        if (activeTab === 'movies') {
          setMovies((prev) => [...prev, ...newItems]);
        } else if (activeTab === 'series') {
          setSeries((prev) => [...prev, ...newItems]);
        } else if (activeTab === 'anime') {
          setAnime((prev) => [...prev, ...newItems]);
        } else if (activeTab === 'kids') {
          setKids((prev) => [...prev, ...newItems]);
        }
      }
    } catch (err) {
      console.error('Error loading more titles:', err);
    } finally {
      setIsLoadingMore(false);
    }
  };

  // Live TV playback
  const playChannel = async (channel: Channel, bypassPinCheck = false) => {
    if (!bypassPinCheck && !isAdultUnlocked && isAdultChannel(channel)) {
      setPinInput('');
      setPinError('');
      setPinModal({ open: true, pendingChannel: channel });
      return;
    }
    try {
      const code = channel.channelCode || channel.id || '';
      const isPublicM3uChannel = code.startsWith('public_m3u_');
      const res = await api.resolveLive(code, isPublicM3uChannel ? undefined : channel.streamUrl);
      if (res && res.url) {
        setActivePlayback({
          url: res.url,
          title: channel.name,
          subtitle: `En Vivo • ${channel.category || 'Televisión'}`,
          isLive: true,
          contentId: code,
        });
      } else {
        setAlertModal({
          open: true,
          title: 'Canal no disponible',
          description: 'No se pudo sintonizar la transmisión de este canal en vivo en este momento.',
        });
      }
    } catch (e) {
      console.error('Error playing channel:', e);
      setAlertModal({
        open: true,
        title: 'Error de conexión',
        description: 'Error al conectar con la señal de televisión en vivo. Verifica tu conexión.',
      });
    }
  };

  // Audio track switch in player
  const handleSwitchAudioTrack = async (trackIndex: number) => {
    if (!activePlayback?.contentId) return;
    try {
      const res = await api.resolveMedia(
        activePlayback.contentId,
        activePlayback.seriesId,
        trackIndex
      );
      if (res && res.url) {
        setActivePlayback((prev) =>
          prev
            ? {
                ...prev,
                url: res.url,
                subtitles: res.subtitles || prev.subtitles,
                audioLanguages: res.audioLanguages || prev.audioLanguages,
              }
            : null
        );
      }
    } catch (e) {
      console.error('Error switching audio track:', e);
    }
  };

  // Switch episode directly from inside the video player without closing it
  const handleSwitchEpisodeInPlayer = async (
    ep: Episode,
    seasonId: string,
    seasonNumber: number,
    seasonsList?: Season[],
    episodesList?: Episode[]
  ) => {
    const current = activePlaybackRef.current;
    if (!current) return;
    try {
      const res = await api.resolveMedia(ep.id, seasonId);
      if (!res || !res.url) {
        showToast('No se pudo cargar este episodio. Intenta con otro.');
        return;
      }
      const rootMediaId = current.mediaItem?.id;
      const savedEp = rootMediaId ? episodeProgressMap[rootMediaId]?.[ep.id] : undefined;
      const resumeAt =
        savedEp && savedEp.currentTime > 10 && savedEp.progressPercent < 96
          ? savedEp.currentTime
          : 0;
      const epTitleClean = cleanEpisodeTitleText(
        ep.name || ep.title || `Episodio ${ep.number}`
      );
      const subtitleLabel = `T${seasonNumber} : E${ep.number}${
        epTitleClean ? ` — ${epTitleClean}` : ''
      }`;

      setActivePlayback((prev) =>
        prev
          ? {
              ...prev,
              url: res.url,
              subtitle: subtitleLabel,
              isLive: false,
              initialTime: resumeAt,
              subtitles: res.subtitles || [],
              audioLanguages: res.audioLanguages || [],
              contentId: ep.id,
              seriesId: seasonId,
              episodeMeta: {
                seasonId,
                seasonNumber,
                episodeNumber: ep.number,
                episodeTitle: epTitleClean,
                seasons:
                  seasonsList && seasonsList.length > 0 ? seasonsList : prev.episodeMeta?.seasons,
                episodes:
                  episodesList && episodesList.length > 0
                    ? episodesList
                    : prev.episodeMeta?.episodes,
              },
            }
          : null
      );
    } catch (e) {
      console.error('Error switching episode in player:', e);
      showToast('Error al cambiar de episodio.');
    }
  };

  // Search is deferred and cancellable: typing never waits for network or a large result render.
  useEffect(() => {
    const query = deferredSearchQuery.trim();
    searchAbortRef.current?.abort();
    if (query.length < 2) {
      searchRequestRef.current += 1;
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    const requestId = ++searchRequestRef.current;
    const controller = new AbortController();
    searchAbortRef.current = controller;
    setIsSearching(true);
    const timer = setTimeout(async () => {
      try {
        const mediaRes = await api.search(query, controller.signal);
        if (requestId === searchRequestRef.current) {
          setSearchResults(mediaRes.slice(0, SEARCH_RESULT_LIMIT));
        }
      } catch (err) {
        if (!controller.signal.aborted) console.error('Error searching:', err);
      } finally {
        if (requestId === searchRequestRef.current) {
          setIsSearching(false);
        }
      }
    }, 320);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [deferredSearchQuery]);

  // Channel search is local and should not re-query the remote media catalog.
  useEffect(() => {
    const query = deferredSearchQuery.trim().toLowerCase();
    if (query.length < 2) {
      setChannelSearchResults([]);
      return;
    }
    const matches: Channel[] = [];
    for (const channel of channels) {
      if (
        (isAdultUnlocked || !isAdultChannel(channel)) &&
        (channel.name.toLowerCase().includes(query) ||
          Boolean(channel.category && channel.category.toLowerCase().includes(query)))
      ) {
        matches.push(channel);
        if (matches.length >= SEARCH_RESULT_LIMIT) break;
      }
    }
    setChannelSearchResults(matches);
  }, [deferredSearchQuery, channels, isAdultUnlocked]);

  const visibleCategories = useMemo(() => {
    return categories.filter((cat) => !(hideAdultCategory && isAdultCategory(cat)));
  }, [categories, hideAdultCategory]);

  const filteredLiveChannels = useMemo(() => {
    const query = liveQuery.trim().toLocaleLowerCase('es');
    let list = isAdultUnlocked ? channels : channels.filter((c) => !isAdultChannel(c));
    if (isPublicLiveMode && selectedCategory !== 'all') {
      const category = categories.find((item) => item.id === selectedCategory);
      if (category) {
        list = list.filter((channel) =>
          String(channel.category || '')
            .split(';')
            .some((name) => name.trim() === category.name)
        );
      }
    }
    if (query) {
      list = list.filter((channel) =>
        `${channel.name || ''} ${channel.category || ''} ${channel.channelCode || ''}`
          .toLocaleLowerCase('es')
          .includes(query)
      );
    }
    if (liveSort === 'title') {
      list = [...list].sort((a, b) => a.name.localeCompare(b.name, 'es'));
    }
    return list;
  }, [channels, categories, isAdultUnlocked, isPublicLiveMode, liveQuery, liveSort, selectedCategory]);

  const visibleLiveChannels = useMemo(
    () => filteredLiveChannels.slice(0, liveVisibleLimit),
    [filteredLiveChannels, liveVisibleLimit]
  );

  const homeLiveChannels = useMemo(() => {
    return channels.filter((c) => !isAdultChannel(c));
  }, [channels]);

  const visibleFavChannels = useMemo(() => {
    if (isAdultUnlocked) return favChannels;
    return favChannels.filter((c) => !isAdultChannel(c));
  }, [favChannels, isAdultUnlocked]);

  const normalizedSearchQuery = searchQuery.trim();
  const isSearchActive = normalizedSearchQuery.length >= 1;
  const isSearchReady = normalizedSearchQuery.length >= 2;
  const totalSearchResults = searchResults.length + channelSearchResults.length;
  const visibleSearchResultCount =
    searchFilterTab === 'media'
      ? searchResults.length
      : searchFilterTab === 'channels'
        ? channelSearchResults.length
        : totalSearchResults;

  // Active Catalog List & Genres
  const currentCatalogList = useMemo(() => {
    if (activeTab === 'movies') return movies;
    if (activeTab === 'series') return series;
    if (activeTab === 'anime') return anime;
    if (activeTab === 'kids') return kids;
    if (activeTab === 'favorites') return favMedia;
    return [];
  }, [activeTab, movies, series, anime, kids, favMedia]);

  const availableGenres = useMemo(() => {
    const genres = new Map<string, string>();
    currentCatalogList.forEach((item) => {
      if (item.genres && Array.isArray(item.genres)) {
        item.genres.forEach((g) => {
          if (g && typeof g === 'string' && g.trim()) {
            const label = g.trim();
            genres.set(normalizeFilterValue(label), label);
          }
        });
      }
    });
    return ['all', ...Array.from(genres.values()).sort((a, b) => a.localeCompare(b, 'es'))];
  }, [currentCatalogList]);

  const filteredMediaList = useMemo(() => {
    let list = currentCatalogList;
    if (selectedGenre !== 'all') {
      list = list.filter((item) =>
        item.genres?.some((g) => normalizeFilterValue(g) === normalizeFilterValue(selectedGenre))
      );
    }
    if (sortOption === 'title') {
      list = [...list].sort((a, b) => a.title.localeCompare(b.title, 'es'));
    } else if (sortOption === 'year') {
      list = [...list].sort(
        (a, b) => parseInt(b.year || '0', 10) - parseInt(a.year || '0', 10)
      );
    }
    return list;
  }, [currentCatalogList, selectedGenre, sortOption]);

  // Keeping a bounded first render prevents a large catalog filter from blocking the UI.
  const visibleMediaList = useMemo(
    () => filteredMediaList.slice(0, catalogVisibleLimit),
    [filteredMediaList, catalogVisibleLimit]
  );

  // Billboard Hero Item
  const heroItem = useMemo(() => {
    if (homeFeatured.length > 0) return homeFeatured[0];
    if (movies.length > 0) return movies[0];
    if (series.length > 0) return series[0];
    return null;
  }, [homeFeatured, movies, series]);
  const hasHomeContent = Boolean(heroItem || movies.length || series.length || anime.length || kids.length || channels.length);

  const navigateTab = (tab: TabView) => {
    setSelectedMedia(null);
    if (window.location.hash.startsWith('#detalle')) {
      window.location.hash = '';
    }
    if (tab !== 'live' && isAdultUnlocked) {
      setIsAdultUnlocked(false);
      const currentCatObj = categories.find((c) => c.id === selectedCategory);
      if (isAdultCategory(currentCatObj || { id: selectedCategory })) {
        loadCategoryChannels('all');
      }
    }
    setActiveTab(tab);
    setSelectedGenre('all');
    setSortOption('recommended');
    setCatalogVisibleLimit(CATALOG_PAGE_SIZE);
    setSearchQuery('');
    setIsSearchOpen(false);
    setExploreMenuOpen(false);
    setIsProfileMenuOpen(false);
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  const saveApiUrl = (newUrl: string) => {
    setApiUrlState(newUrl);
    setApiBaseUrl(newUrl);
    showToast('Dirección del servidor actualizada.');
    checkBackend();
    loadInitialData(true);
  };

  return (
    <div className="browse-page zentix-app min-h-screen bg-[#141414] text-white selection:bg-red-600 selection:text-white">
      {/* ============================================================ */}
      {/* 1. DEDICATED FULL-PAGE DETAIL VIEW (IF TITLE SELECTED)       */}
      {/* ============================================================ */}
      {selectedMedia ? (
        <MediaDetailPage
          key={selectedMedia.id}
          media={selectedMedia}
          relatedItems={currentCatalogList.length > 0 ? currentCatalogList : movies}
          watchEntry={watchProgressMap[selectedMedia.id] || null}
          episodeProgressMap={episodeProgressMap[selectedMedia.id]}
          onBack={closeMediaDetail}
          onSelectMedia={openMediaDetail}
          onPlayMovie={(
            url,
            title,
            subtitle,
            subtitles,
            audioLanguages,
            contentId,
            initialTime,
            resolvedMedia
          ) => {
            setActivePlayback({
              url,
              title,
              subtitle,
              isLive: false,
              initialTime,
              subtitles,
              audioLanguages,
              contentId,
              mediaItem: { ...(resolvedMedia || selectedMedia), id: selectedMedia.id },
            });
          }}
          onPlayEpisode={(
            url,
            title,
            subtitle,
            subtitles,
            audioLanguages,
            contentId,
            seriesId,
            initialTime,
            episodeMeta,
            resolvedMedia
          ) => {
            setActivePlayback({
              url,
              title,
              subtitle,
              isLive: false,
              initialTime,
              subtitles,
              audioLanguages,
              contentId,
              seriesId,
              episodeMeta,
              mediaItem: { ...(resolvedMedia || selectedMedia), id: selectedMedia.id },
            });
          }}
          isFavorite={isMediaFav(selectedMedia.id)}
          onToggleFavorite={(item) => toggleFavoriteMedia(undefined, item)}
        />
      ) : (
        <>
          {/* ============================================================ */}
          {/* 2. AUTHENTIC MAICAOFLIX TOP HEADER BAR                       */}
          {/* ============================================================ */}
          <header
            ref={headerRef}
            className={`browse-header fixed left-0 top-0 z-40 flex w-full items-center transition-all duration-300 ${
              scrolled || activeTab !== 'home' || isSearchActive ? 'is-scrolled' : ''
            }`}
          >
            {/* Brand Logo */}
            <button
              type="button"
              onClick={() => navigateTab('home')}
              className="browse-brand cursor-pointer shrink-0 transition-opacity hover:opacity-90 flex items-center mr-3 sm:mr-6"
              aria-label="MAICAOFLIX, ir a inicio"
            >
              <MaicaoflixLogo width={122} height={26} className="sm:w-[138px] sm:h-[30px]" />
            </button>

            {/* Small anchored menu: navigation without covering the catalog. */}
            <div className="md:hidden relative flex items-center">
              <Button
                variant="ghost"
                size="sm"
                aria-haspopup="menu"
                aria-expanded={exploreMenuOpen}
                onClick={() => setExploreMenuOpen((open) => !open)}
                className="flex items-center gap-1.5 text-xs text-zinc-200 hover:text-white hover:bg-zinc-800/80 font-bold px-2.5 h-8 rounded-lg border border-zinc-800/80 bg-zinc-900/60 shadow-sm"
              >
                <span>Explorar</span>
                <ChevronDown className={`w-3.5 h-3.5 text-zinc-400 transition-transform duration-200 ${exploreMenuOpen ? 'rotate-180' : ''}`} />
              </Button>
              {exploreMenuOpen && (
                <nav
                  role="menu"
                  aria-label="Explorar catálogo"
                  className="absolute left-0 top-full z-50 mt-2 w-52 overflow-hidden rounded-lg border border-zinc-800 bg-[#181818] py-1 shadow-2xl"
                >
                  {[
                    { tab: 'home' as TabView, label: 'Inicio', icon: Home, tone: 'text-zinc-300' },
                    { tab: 'live' as TabView, label: 'TV en vivo', icon: Tv, tone: 'text-red-400' },
                    { tab: 'series' as TabView, label: 'Series', icon: Clapperboard, tone: 'text-zinc-300' },
                    { tab: 'movies' as TabView, label: 'Películas', icon: Film, tone: 'text-zinc-300' },
                    { tab: 'anime' as TabView, label: 'Animé', icon: Sparkles, tone: 'text-zinc-300' },
                    { tab: 'kids' as TabView, label: 'Infantil', icon: Smile, tone: 'text-zinc-300' },
                    { tab: 'favorites' as TabView, label: 'Mi lista', icon: Heart, tone: 'text-pink-400' },
                  ].map(({ tab, label, icon: Icon, tone }) => (
                    <button
                      key={tab}
                      type="button"
                      role="menuitem"
                      onClick={() => navigateTab(tab)}
                      className={`flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors ${
                        activeTab === tab && !isSearchActive
                          ? 'bg-zinc-800 text-white'
                          : 'text-zinc-300 hover:bg-zinc-800 hover:text-white'
                      }`}
                    >
                      <Icon className={`h-4 w-4 ${tone}`} />
                      <span>{label}</span>
                      {tab === 'favorites' && favChannels.length + favMedia.length > 0 && (
                        <span className="ml-auto rounded-full bg-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-100">
                          {favChannels.length + favMedia.length}
                        </span>
                      )}
                    </button>
                  ))}
                </nav>
              )}
            </div>

            {/* Primary Desktop Navigation Links */}
            <nav
              className="primary-navigation hidden md:flex items-center gap-5 text-sm font-medium"
              aria-label="Navegación principal"
            >
              <button
                type="button"
                className={`transition-colors cursor-pointer ${
                  activeTab === 'home' && !isSearchActive
                    ? 'font-bold text-white'
                    : 'text-zinc-300 hover:text-zinc-400'
                }`}
                onClick={() => navigateTab('home')}
                aria-current={activeTab === 'home' && !isSearchActive ? 'page' : undefined}
              >
                Inicio
              </button>
              <button
                type="button"
                className={`transition-colors cursor-pointer ${
                  activeTab === 'series' && !isSearchActive
                    ? 'font-bold text-white'
                    : 'text-zinc-300 hover:text-zinc-400'
                }`}
                onClick={() => navigateTab('series')}
                aria-current={activeTab === 'series' && !isSearchActive ? 'page' : undefined}
              >
                Series
              </button>
              <button
                type="button"
                className={`transition-colors cursor-pointer ${
                  activeTab === 'movies' && !isSearchActive
                    ? 'font-bold text-white'
                    : 'text-zinc-300 hover:text-zinc-400'
                }`}
                onClick={() => navigateTab('movies')}
                aria-current={activeTab === 'movies' && !isSearchActive ? 'page' : undefined}
              >
                Películas
              </button>
              <button
                type="button"
                className={`zentix-tv-link transition-colors cursor-pointer ${
                  activeTab === 'live' && !isSearchActive
                    ? 'font-bold text-white'
                    : 'text-zinc-300 hover:text-zinc-400'
                }`}
                onClick={() => navigateTab('live')}
                aria-current={activeTab === 'live' && !isSearchActive ? 'page' : undefined}
              >
                <span className="zentix-live-dot" />
                <span>TV en vivo</span>
              </button>
              <button
                type="button"
                className={`transition-colors cursor-pointer ${
                  activeTab === 'anime' && !isSearchActive
                    ? 'font-bold text-white'
                    : 'text-zinc-300 hover:text-zinc-400'
                }`}
                onClick={() => navigateTab('anime')}
                aria-current={activeTab === 'anime' && !isSearchActive ? 'page' : undefined}
              >
                Animé
              </button>
              <button
                type="button"
                className={`transition-colors cursor-pointer ${
                  activeTab === 'kids' && !isSearchActive
                    ? 'font-bold text-white'
                    : 'text-zinc-300 hover:text-zinc-400'
                }`}
                onClick={() => navigateTab('kids')}
                aria-current={activeTab === 'kids' && !isSearchActive ? 'page' : undefined}
              >
                Infantil
              </button>
              <button
                type="button"
                className={`transition-colors cursor-pointer flex items-center ${
                  activeTab === 'favorites' && !isSearchActive
                    ? 'font-bold text-white'
                    : 'text-zinc-300 hover:text-zinc-400'
                }`}
                onClick={() => navigateTab('favorites')}
                aria-current={activeTab === 'favorites' && !isSearchActive ? 'page' : undefined}
              >
                <span>Mi lista</span>
                {favChannels.length + favMedia.length > 0 && (
                  <span className="list-count ml-1.5 px-1.5 py-0.2 rounded-full bg-red-600 text-white text-[10px] font-bold">
                    {favChannels.length + favMedia.length}
                  </span>
                )}
              </button>
            </nav>

            {/* Right Header Actions */}
            <div className="browse-header-actions ml-auto flex items-center gap-2 sm:gap-4">
              {/* Single Responsive Search Input */}
              <div
                ref={searchContainerRef}
                className={`browse-search ${isSearchOpen || searchQuery ? 'is-open' : ''}`}
              >
                <button
                  className="header-icon cursor-pointer"
                  type="button"
                  id="search-toggle"
                  aria-expanded={isSearchOpen}
                  aria-controls="catalog-search"
                  aria-label={isSearchOpen ? 'Cerrar buscador' : 'Buscar títulos o canales (/) '}
                  onClick={() => {
                    setIsSearchOpen(!isSearchOpen);
                    if (!isSearchOpen) {
                      setTimeout(() => searchInputRef.current?.focus(), 50);
                    } else {
                      setSearchQuery('');
                    }
                  }}
                >
                  <Search className="w-5 h-5 text-white" />
                </button>
                <label htmlFor="catalog-search" className="sr-only">
                  Buscar por título, canal o género
                </label>
                <input
                  ref={searchInputRef}
                  id="catalog-search"
                  type="search"
                  placeholder="Buscar títulos, series o canales"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={100}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  tabIndex={isSearchOpen ? 0 : -1}
                />
                {!!searchQuery && (
                  <button
                    type="button"
                    className="search-clear cursor-pointer"
                    aria-label="Borrar búsqueda"
                    onClick={() => {
                      setSearchQuery('');
                      searchInputRef.current?.focus();
                    }}
                  >
                    <X className="w-4 h-4 text-white" />
                  </button>
                )}
              </div>

              {/* Quick Refresh Button */}
              <button
                type="button"
                className="header-icon text-zinc-300 hover:text-white transition-colors cursor-pointer hidden sm:grid"
                onClick={() => loadInitialData(true)}
                title="Actualizar catálogo"
              >
                <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
              </button>

              {/* Server Connection Status Dot */}
              <button
                type="button"
                onClick={() => setIsSettingsModalOpen(true)}
                title={
                  isBackendOnline
                    ? 'Señal Activa • Ultra HD'
                    : 'Señal Desconectada (Clic para verificar)'
                }
                className="flex items-center gap-1.5 px-2 py-1 rounded bg-black/40 border border-zinc-800 hover:border-zinc-700 transition-colors text-[11px] cursor-pointer"
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    isBackendOnline ? 'bg-emerald-500' : 'bg-red-500'
                  }`}
                />
                <span className="hidden lg:inline text-zinc-400 font-medium">
                  {isBackendOnline ? 'En línea' : 'Reconectar'}
                </span>
              </button>

              {/* Sign In Pill when logged out */}
              {!currentUser && (
                <button
                  type="button"
                  onClick={() => {
                    setAuthModalMode('login');
                    setIsAuthModalOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-red-600 hover:bg-red-700 text-white text-xs font-bold transition-colors cursor-pointer shrink-0 shadow"
                >
                  <LogIn className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Iniciar sesión</span>
                  <span className="sm:hidden">Entrar</span>
                </button>
              )}

              {/* Profile Avatar & Menu */}
              <div className="header-popover profile-control relative">
                <button
                  type="button"
                  className="profile-toggle flex items-center gap-1.5 cursor-pointer"
                  aria-label={`Perfil de ${profileName}`}
                  onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)}
                >
                  <span className="profile-badge" aria-hidden="true">
                    <span className="avatar-face" />
                  </span>
                  <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
                </button>

                {isProfileMenuOpen && (
                  <div className="header-menu profile-menu absolute right-0 top-full mt-2 w-64 bg-[#181818] border border-zinc-700 rounded-md shadow-2xl py-3 z-50 text-xs animate-in fade-in duration-150">
                    <div className="px-4 pb-2.5 border-b border-zinc-800 space-y-1">
                      <p className="text-zinc-400 text-[10px] uppercase font-bold tracking-wider">
                        {currentUser ? 'Cuenta Conectada' : 'Perfil Local'}
                      </p>
                      <p className="text-sm font-bold text-white truncate">{profileName}</p>
                      {currentUser?.email ? (
                        <p className="text-[11px] text-zinc-400 truncate">{currentUser.email}</p>
                      ) : (
                        <p className="text-[11px] text-zinc-500">Inicia sesión para guardar en la nube</p>
                      )}
                      <div className="pt-1 flex items-center gap-1.5 text-[10px]">
                        {currentUser ? (
                          <span className="inline-flex items-center gap-1 text-emerald-400 font-semibold">
                            <Cloud className="w-3 h-3" />
                            <span>Historial sincronizado</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-zinc-400">
                            <CloudOff className="w-3 h-3" />
                            <span>Guardado solo local</span>
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="py-1.5">
                      {!currentUser && (
                        <button
                          type="button"
                          onClick={() => {
                            setAuthModalMode('login');
                            setIsAuthModalOpen(true);
                            setIsProfileMenuOpen(false);
                          }}
                          className="w-full px-4 py-2 text-left text-white font-semibold hover:bg-zinc-800 flex items-center gap-2 cursor-pointer"
                        >
                          <LogIn className="w-4 h-4 text-red-500" />
                          <span>Iniciar sesión / Crear cuenta</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => {
                          navigateTab('favorites');
                          setIsProfileMenuOpen(false);
                        }}
                        className="w-full px-4 py-2 text-left text-zinc-300 hover:text-white hover:bg-zinc-800 flex items-center gap-2 cursor-pointer"
                      >
                        <History className="w-4 h-4 text-amber-400" />
                        <span>Mi lista e Historial ({watchHistory.length})</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setIsSettingsModalOpen(true);
                          setIsProfileMenuOpen(false);
                        }}
                        className="w-full px-4 py-2 text-left text-zinc-300 hover:text-white hover:bg-zinc-800 flex items-center gap-2 cursor-pointer"
                      >
                        <Server className="w-4 h-4 text-red-500" />
                        <span>Configuración del Servidor</span>
                      </button>

                      {currentUser && (
                        <button
                          type="button"
                          onClick={async () => {
                            setIsProfileMenuOpen(false);
                            try {
                              await logoutUser();
                              showToast('Sesión cerrada.');
                            } catch (err) {
                              console.error('Logout error:', err);
                            }
                          }}
                          className="w-full px-4 py-2 text-left text-red-400 hover:text-red-300 hover:bg-zinc-800 flex items-center gap-2 cursor-pointer"
                        >
                          <LogOut className="w-4 h-4" />
                          <span>Cerrar sesión</span>
                        </button>
                      )}
                    </div>

                    <div className="px-4 pt-2 border-t border-zinc-800 text-[11px] text-zinc-500">
                      Streaming Ultra HD • MAICAOFLIX
                    </div>
                  </div>
                )}
              </div>
            </div>
          </header>

          {/* ============================================================ */}
          {/* 3. MAIN CATALOG OR SEARCH VIEW                               */}
          {/* ============================================================ */}
          <main id="browse-main" className="relative">
            {/* GLOBAL SEARCH RESULTS (SHOWN WHEN SEARCH QUERY >= 1) */}
            {isSearchActive ? (
              <div className="catalog-content is-filtered pt-24 px-4 sm:px-8 space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-zinc-800">
                  <div>
                    <h1 className="browse-view-title text-2xl sm:text-3xl font-bold">
                      Buscar: <span className="text-zinc-300">{normalizedSearchQuery}</span>
                    </h1>
                    <p className="text-xs text-zinc-400 mt-1">
                      {!isSearchReady
                        ? 'Escribe al menos 2 caracteres para buscar.'
                        : isSearching
                        ? 'Buscando en el catálogo en vivo...'
                        : `${visibleSearchResultCount} coincidencia${visibleSearchResultCount === 1 ? '' : 's'}`}
                    </p>
                  </div>

                  {/* Filter Pills */}
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant={searchFilterTab === 'all' ? 'default' : 'outline'}
                      onClick={() => setSearchFilterTab('all')}
                      className="text-xs rounded-full h-8"
                    >
                      Todos ({totalSearchResults})
                    </Button>
                    <Button
                      size="sm"
                      variant={searchFilterTab === 'media' ? 'default' : 'outline'}
                      onClick={() => setSearchFilterTab('media')}
                      className="text-xs rounded-full h-8"
                    >
                      Películas & Series ({searchResults.length})
                    </Button>
                    <Button
                      size="sm"
                      variant={searchFilterTab === 'channels' ? 'default' : 'outline'}
                      onClick={() => setSearchFilterTab('channels')}
                      className="text-xs rounded-full h-8"
                    >
                      Canales ({channelSearchResults.length})
                    </Button>
                  </div>
                </div>

                {isSearchReady && isSearching && (
                  <div className="results-grid catalog-skeleton-grid search-skeleton-grid" aria-busy="true" aria-label="Buscando en el catálogo">
                    {Array.from({ length: 12 }, (_, index) => (
                      <div className="catalog-skeleton-card" key={index} aria-hidden="true">
                        <div className="catalog-skeleton-poster" />
                        <div className="catalog-skeleton-line is-title" />
                        <div className="catalog-skeleton-line" />
                      </div>
                    ))}
                  </div>
                )}

                {/* Channels Search Matches */}
                {!isSearching && (searchFilterTab === 'all' || searchFilterTab === 'channels') &&
                  channelSearchResults.length > 0 && (
                    <div className="space-y-3">
                      <h3 className="text-sm font-bold text-zinc-300 uppercase tracking-wider flex items-center gap-2">
                        <Tv className="w-4 h-4 text-red-600" />
                        <span>Canales de TV ({channelSearchResults.length})</span>
                      </h3>
                      <div className="results-grid">
                        {channelSearchResults.map((ch, idx) => (
                          <div
                            key={`${ch.channelCode || ch.id || ch.name}-${idx}`}
                            className="media-card group cursor-pointer"
                            onClick={() => playChannel(ch)}
                          >
                            <div className="media-card-art flex flex-col items-center justify-center p-4 bg-[#1f1f1f] relative overflow-hidden">
                              <span className="card-netflix">M</span>
                              <span className="absolute top-2 right-2 text-[9px] font-bold text-red-500 bg-red-950/70 border border-red-800/60 px-1.5 py-0.5 rounded">
                                ● VIVO
                              </span>

                              {ch.logo ? (
                                <img
                                  src={ch.logo}
                                  alt={ch.name}
                                  className="h-12 w-auto max-w-[80%] object-contain drop-shadow transition-transform group-hover:scale-105"
                                />
                              ) : (
                                <div className="h-12 w-12 rounded-lg bg-zinc-800 flex items-center justify-center text-zinc-400 group-hover:text-white">
                                  <Play className="w-6 h-6 fill-current" />
                                </div>
                              )}

                              <button
                                type="button"
                                onClick={(e) => toggleFavoriteChannel(e, ch)}
                                className={`absolute bottom-2 right-2 p-1.5 rounded-full z-10 transition-colors ${
                                  isChannelFav(ch.channelCode || ch.id || '')
                                    ? 'text-pink-500 bg-pink-950/80'
                                    : 'text-zinc-400 hover:text-white bg-black/60 hover:bg-zinc-800'
                                }`}
                              >
                                <Heart
                                  className={`w-3.5 h-3.5 ${
                                    isChannelFav(ch.channelCode || ch.id || '')
                                      ? 'fill-current'
                                      : ''
                                  }`}
                                />
                              </button>
                            </div>
                            <span className="media-card-title">{ch.name}</span>
                            <span className="media-card-info">
                              {ch.category || 'Televisión en Vivo'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                {/* Media Search Matches */}
                {!isSearching && (searchFilterTab === 'all' || searchFilterTab === 'media') &&
                  searchResults.length > 0 && (
                    <div className="space-y-3">
                      <h3 className="text-sm font-bold text-zinc-300 uppercase tracking-wider flex items-center gap-2">
                        <Film className="w-4 h-4 text-amber-500" />
                        <span>Películas y Series ({searchResults.length})</span>
                      </h3>
                      <div className="results-grid">
                        {searchResults.map((item, idx) => (
                          <div
                            key={`${item.id || item.title || 'media'}-${idx}`}
                            className="media-card group cursor-pointer"
                            onClick={() => openMediaDetail(item)}
                          >
                            <div className="media-card-art is-poster relative">
                              <img
                                src={item.poster || item.landscape || item.backdrop}
                                alt={item.title}
                                loading="lazy"
                                className="w-full h-full object-cover transition-transform group-hover:brightness-105"
                                onError={(e) => {
                                  const img = e.target as HTMLImageElement;
                                  const fallback = item.landscape || item.backdrop;
                                  if (fallback && img.src !== fallback && !img.dataset.retried) {
                                    img.dataset.retried = '1';
                                    img.src = fallback;
                                    return;
                                  }
                                  img.src =
                                    'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="400" height="600"%3E%3Crect width="100%25" height="100%25" fill="%23242424"/%3E%3Ctext x="50%25" y="50%25" text-anchor="middle" dominant-baseline="middle" fill="%23e50914" font-family="Arial" font-size="28" font-weight="bold"%3EMAICAOFLIX%3C/text%3E%3C/svg%3E';
                                }}
                              />
                              <span className="card-netflix">M</span>
                              <button
                                type="button"
                                onClick={(e) => toggleFavoriteMedia(e, item)}
                                className={`absolute top-2 right-2 p-1.5 rounded-full z-10 transition-colors ${
                                  isMediaFav(item.id)
                                    ? 'text-pink-500 bg-black/70'
                                    : 'text-zinc-400 hover:text-white bg-black/60 hover:bg-zinc-800'
                                }`}
                              >
                                <Heart
                                  className={`w-3.5 h-3.5 ${
                                    isMediaFav(item.id) ? 'fill-current' : ''
                                  }`}
                                />
                              </button>
                            </div>
                            <span className="media-card-title">{item.title}</span>
                            <span className="media-card-info">
                              {item.score && (
                                <span className="text-emerald-400 font-bold">{item.score}</span>
                              )}
                              <span>{item.year && item.year !== '—' ? item.year : ''}</span>
                              <span>{item.kind || ''}</span>
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                {/* Empty Search State */}
                {!isSearchReady && (
                  <div className="empty-state py-20 text-center text-zinc-500 space-y-3">
                    <Search className="w-10 h-10 mx-auto opacity-30 text-zinc-500" />
                    <h2 className="empty-title text-lg font-semibold text-white">¿Qué quieres ver?</h2>
                    <p className="empty-copy text-sm max-w-md mx-auto">
                      Busca por título, actor, género o el nombre de un canal.
                    </p>
                  </div>
                )}

                {isSearchReady && !isSearching && visibleSearchResultCount === 0 && (
                  <div className="empty-state py-20 text-center text-zinc-500 space-y-3">
                    <Search className="w-12 h-12 mx-auto opacity-30 text-zinc-500" />
                    <h2 className="empty-title text-xl font-bold text-white">
                      No encontramos resultados para "{normalizedSearchQuery}"
                    </h2>
                    <p className="empty-copy text-sm max-w-md mx-auto">
                      Prueba otro título, actor, género o cambia el filtro de resultados.
                    </p>
                    <button
                      type="button"
                      className="empty-button"
                      onClick={() => setSearchQuery('')}
                    >
                      Limpiar búsqueda
                    </button>
                  </div>
                )}
              </div>
            ) : (
              /* NORMAL BROWSING (HOME, SERIES, MOVIES, ETC.) */
              <>
                {/* VIEW: INICIO (HOME) */}
                {activeTab === 'home' && (
                  <>
                    {!hasHomeContent && isLoading && (
                      <section className="home-loading" aria-busy="true" aria-label="Cargando catálogo">
                        <div className="home-skeleton-hero" aria-hidden="true">
                          <div className="home-skeleton-copy is-badge" />
                          <div className="home-skeleton-copy is-heading" />
                          <div className="home-skeleton-copy" />
                          <div className="home-skeleton-copy is-short" />
                          <div className="home-skeleton-actions">
                            <div className="home-skeleton-btn" />
                            <div className="home-skeleton-btn is-secondary" />
                          </div>
                        </div>
                        <div className="home-skeleton-section" aria-hidden="true">
                          <div className="home-skeleton-row-title" />
                          <div className="results-grid catalog-skeleton-grid">
                            {Array.from({ length: 6 }, (_, index) => (
                              <div className="catalog-skeleton-card" key={index}>
                                <div className="catalog-skeleton-poster" />
                                <div className="catalog-skeleton-line is-title" />
                                <div className="catalog-skeleton-line" />
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="home-skeleton-section" aria-hidden="true">
                          <div className="home-skeleton-row-title" />
                          <div className="results-grid catalog-skeleton-grid">
                            {Array.from({ length: 6 }, (_, index) => (
                              <div className="catalog-skeleton-card" key={index}>
                                <div className="catalog-skeleton-poster" />
                                <div className="catalog-skeleton-line is-title" />
                                <div className="catalog-skeleton-line" />
                              </div>
                            ))}
                          </div>
                        </div>
                      </section>
                    )}
                    {!hasHomeContent && !isLoading && initialLoadFailed && (
                      <section className="home-load-error empty-state" aria-live="polite">
                        <h1 className="empty-title">No pudimos cargar el catálogo</h1>
                        <p className="empty-copy">El servicio tardó demasiado. Puedes reintentar sin recargar la página.</p>
                        <button type="button" className="empty-button" onClick={() => loadInitialData(true)}>
                          Reintentar
                        </button>
                      </section>
                    )}
                    {/* 1. CINEMATIC BILLBOARD HERO */}
                    {heroItem && (
                      <section
                        className="catalog-hero relative isolate w-full"
                        aria-labelledby="featured-heading"
                      >
                        <img
                          src={heroItem.backdrop || heroItem.landscape || heroItem.poster}
                          alt=""
                          className="catalog-hero-image absolute inset-0 -z-20 h-full w-full object-cover"
                        />
                        <div className="catalog-hero-shade absolute inset-0 -z-10" />

                        <div className="featured-copy absolute">
                          <p className="netflix-series-label flex items-center gap-2">
                            <span className="text-red-600 font-black text-2xl">M</span>
                            <span className="tracking-[4px] text-xs font-bold text-zinc-300">
                              {heroItem.type === 'teleplay' || heroItem.type === 'series'
                                ? 'S E R I E'
                                : 'P E L Í C U L A'}
                            </span>
                          </p>

                          <h1
                            id="featured-heading"
                            className="featured-heading text-3xl sm:text-5xl md:text-6xl font-black text-white tracking-tight drop-shadow-lg"
                          >
                            {heroItem.title}
                          </h1>

                          <div className="flex items-center gap-2.5 text-xs text-zinc-300 mb-3">
                            <span className="text-emerald-400 font-bold">98% para ti</span>
                            {heroItem.year && heroItem.year !== '—' && <span>{heroItem.year}</span>}
                            <span className="border border-zinc-600 px-1 py-0.2 rounded text-[11px]">
                              +16
                            </span>
                            {heroItem.duration && <span>{heroItem.duration}</span>}
                            <span className="border border-zinc-700 px-1 py-0.2 rounded text-[10px] font-mono">
                              4K Ultra HD
                            </span>
                          </div>

                          {heroItem.synopsis && (
                            <p className="featured-description text-sm sm:text-base text-zinc-200 line-clamp-3 mb-5 max-w-xl">
                              {heroItem.synopsis}
                            </p>
                          )}

                          <div className="featured-actions flex items-center gap-3">
                            <button
                              type="button"
                              className="featured-play cursor-pointer inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded bg-white text-black font-bold text-base hover:bg-white/80 transition-colors shadow-lg"
                              onClick={() => openMediaDetail(heroItem)}
                            >
                              <Play className="w-5 h-5 fill-current" />
                              <span>Reproducir</span>
                            </button>
                            <button
                              type="button"
                              className="featured-info cursor-pointer inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded bg-zinc-600/70 text-white font-bold text-base hover:bg-zinc-600/40 transition-colors backdrop-blur-md"
                              onClick={() => openMediaDetail(heroItem)}
                            >
                              <Info className="w-5 h-5" />
                              <span>Más información</span>
                            </button>
                          </div>
                        </div>

                        <div className="hero-age-label">+16</div>
                      </section>
                    )}

                    {/* 2. OVERLAPPING HORIZONTAL MEDIA RAILS */}
                    <div className="catalog-content space-y-6">
                      {/* Row 0: Continuar viendo (Watch History & Progress) */}
                      {watchHistoryMediaItems.length > 0 && (
                        <NetflixRow
                          heading={`Continuar viendo${currentUser ? ` • ${profileName}` : ''}`}
                          items={watchHistoryMediaItems}
                          progressMap={watchProgressMap}
                          onResumeItem={handleDirectResume}
                          onRemoveProgress={handleRemoveWatchItem}
                          isFavorite={isMediaFav}
                          onToggleFavorite={toggleFavoriteMedia}
                          onSelectMedia={openMediaDetail}
                          onViewAll={() => navigateTab('favorites')}
                        />
                      )}

                      {/* Row 1: Tendencias ahora (Top 10) */}
                      <NetflixRow
                        heading="Tendencias ahora"
                        items={movies.slice(0, 10)}
                        isTop10={true}
                        progressMap={watchProgressMap}
                        isFavorite={isMediaFav}
                        onToggleFavorite={toggleFavoriteMedia}
                        onSelectMedia={openMediaDetail}
                        onViewAll={() => navigateTab('movies')}
                      />

                      {/* Row 2: Canales en Vivo Populares */}
                      {homeLiveChannels.length > 0 && (
                        <NetflixRow
                          heading="Canales de Televisión en Vivo"
                          items={[]}
                          isChannelRow={true}
                          channels={homeLiveChannels.slice(0, 20)}
                          isFavorite={isChannelFav}
                          onToggleFavoriteChannel={toggleFavoriteChannel}
                          onSelectMedia={() => {}}
                          onSelectChannel={playChannel}
                          onViewAll={() => navigateTab('live')}
                        />
                      )}

                      {/* Row 3: Películas aclamadas */}
                      {movies.length > 0 && (
                        <NetflixRow
                          heading="Películas recomendadas para ti"
                          items={movies.slice(5, 25)}
                          progressMap={watchProgressMap}
                          isFavorite={isMediaFav}
                          onToggleFavorite={toggleFavoriteMedia}
                          onSelectMedia={openMediaDetail}
                          onViewAll={() => navigateTab('movies')}
                        />
                      )}

                      {/* Row 4: Series para un maratón */}
                      {series.length > 0 && (
                        <NetflixRow
                          heading="Series para un maratón"
                          items={series.slice(0, 20)}
                          progressMap={watchProgressMap}
                          isFavorite={isMediaFav}
                          onToggleFavorite={toggleFavoriteMedia}
                          onSelectMedia={openMediaDetail}
                          onViewAll={() => navigateTab('series')}
                        />
                      )}

                      {/* Row 5: Animé y animación */}
                      {anime.length > 0 && (
                        <NetflixRow
                          heading="Animé y Animación"
                          items={anime.slice(0, 20)}
                          progressMap={watchProgressMap}
                          isFavorite={isMediaFav}
                          onToggleFavorite={toggleFavoriteMedia}
                          onSelectMedia={openMediaDetail}
                          onViewAll={() => navigateTab('anime')}
                        />
                      )}

                      {/* Row 6: Infantil & Familia */}
                      {kids.length > 0 && (
                        <NetflixRow
                          heading="Para disfrutar en familia"
                          items={kids.slice(0, 20)}
                          progressMap={watchProgressMap}
                          isFavorite={isMediaFav}
                          onToggleFavorite={toggleFavoriteMedia}
                          onSelectMedia={openMediaDetail}
                          onViewAll={() => navigateTab('kids')}
                        />
                      )}

                      {/* Row 7: Mi lista (if items saved) */}
                      {favMedia.length > 0 && (
                        <NetflixRow
                          heading={`Mi lista de ${profileName}`}
                          items={favMedia}
                          progressMap={watchProgressMap}
                          isFavorite={isMediaFav}
                          onToggleFavorite={toggleFavoriteMedia}
                          onSelectMedia={openMediaDetail}
                          onViewAll={() => navigateTab('favorites')}
                        />
                      )}
                    </div>
                  </>
                )}

                {/* VIEW: CATALOG TABS (PELÍCULAS, SERIES, ANIMÉ, INFANTIL) */}
                {(activeTab === 'movies' ||
                  activeTab === 'series' ||
                  activeTab === 'anime' ||
                  activeTab === 'kids') && (
                  <div className="catalog-content is-filtered pt-24 px-4 sm:px-8 space-y-6">
                    {/* Toolbar */}
                    <div className="catalog-toolbar flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-zinc-900">
                      <div className="flex items-center gap-4">
                        <h1 className="browse-view-title text-2xl sm:text-3xl font-bold">
                          {activeTab === 'movies'
                            ? 'Películas'
                            : activeTab === 'series'
                            ? 'Series'
                            : activeTab === 'anime'
                            ? 'Animé'
                            : 'Zona Infantil'}
                        </h1>

                        {/* Fast horizontal genre filter: avoids rendering a large native menu over the catalog. */}
                        {availableGenres.length > 2 && (
                          <div className="catalog-genre-rail" aria-label="Filtrar por género">
                            {availableGenres.map((genre) => {
                              const isSelected = selectedGenre === genre;
                              return (
                                <button
                                  key={genre}
                                  type="button"
                                  aria-pressed={isSelected}
                                  className={isSelected ? 'is-selected' : ''}
                                  onClick={() => {
                                    if (isSelected) return;
                                    startCatalogFiltering(() => {
                                      setSelectedGenre(genre);
                                      setCatalogVisibleLimit(CATALOG_PAGE_SIZE);
                                    });
                                  }}
                                >
                                  {genre === 'all' ? 'Todos los géneros' : genre}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {/* Sort dropdown */}
                      <div className="flex items-center gap-2">
                        {(selectedGenre !== 'all' || sortOption !== 'recommended') && (
                          <button
                            type="button"
                            onClick={() => {
                              startCatalogFiltering(() => {
                                setSelectedGenre('all');
                                setSortOption('recommended');
                                setCatalogVisibleLimit(CATALOG_PAGE_SIZE);
                              });
                            }}
                            className="h-8 px-2 text-xs font-semibold text-zinc-400 transition-colors hover:text-white"
                          >
                            Restablecer
                          </button>
                        )}
                        <label className="catalog-filter sort-control relative">
                          <span className="sr-only">Ordenar</span>
                            <select
                              value={sortOption}
                              onChange={(e) => {
                                const nextSort = e.target.value;
                                startCatalogFiltering(() => {
                                  setSortOption(nextSort);
                                  setCatalogVisibleLimit(CATALOG_PAGE_SIZE);
                                });
                              }}
                            className="bg-[#242424] text-white text-xs font-semibold border border-zinc-700 rounded px-3 py-1.5 cursor-pointer focus:outline-none"
                          >
                            <option value="recommended">Recomendados</option>
                            <option value="title">Título: A–Z</option>
                            <option value="year">Más recientes</option>
                          </select>
                        </label>
                      </div>
                    </div>

                    <div className="zentix-catalog-status text-xs text-zinc-400">
                      {filteredMediaList.length} títulos disponibles
                      {selectedGenre !== 'all' && ` en género "${selectedGenre}"`}
                      {isCatalogFiltering && <span className="catalog-filtering-note">Actualizando…</span>}
                    </div>

                    {/* Grid of Titles */}
                    {isLoading && currentCatalogList.length === 0 ? (
                      <div className="results-grid catalog-skeleton-grid" aria-busy="true" aria-label="Cargando catálogo">
                        {Array.from({ length: 12 }, (_, index) => (
                          <div className="catalog-skeleton-card" key={index} aria-hidden="true">
                            <div className="catalog-skeleton-poster" />
                            <div className="catalog-skeleton-line is-title" />
                            <div className="catalog-skeleton-line" />
                          </div>
                        ))}
                      </div>
                    ) : (
                    <div className="results-grid" aria-busy={isCatalogFiltering}>
                      {visibleMediaList.map((item, idx) => (
                        <div
                          key={`${item.id || item.title || 'media'}-${idx}`}
                          className="media-card group cursor-pointer"
                          onClick={() => openMediaDetail(item)}
                        >
                          <div className="media-card-art is-poster relative">
                            <img
                              src={item.poster || item.landscape || item.backdrop}
                              alt={item.title}
                              loading="lazy"
                              className="w-full h-full object-cover transition-transform group-hover:brightness-105"
                              onError={(e) => {
                                const img = e.target as HTMLImageElement;
                                const fallback = item.landscape || item.backdrop;
                                if (fallback && img.src !== fallback && !img.dataset.retried) {
                                  img.dataset.retried = '1';
                                  img.src = fallback;
                                  return;
                                }
                                img.src =
                                  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="400" height="600"%3E%3Crect width="100%25" height="100%25" fill="%23242424"/%3E%3Ctext x="50%25" y="50%25" text-anchor="middle" dominant-baseline="middle" fill="%23e50914" font-family="Arial" font-size="28" font-weight="bold"%3EMAICAOFLIX%3C/text%3E%3C/svg%3E';
                              }}
                            />
                            <span className="card-netflix">M</span>
                            <button
                              type="button"
                              onClick={(e) => toggleFavoriteMedia(e, item)}
                              className={`absolute top-2 right-2 p-1.5 rounded-full z-10 transition-colors ${
                                isMediaFav(item.id)
                                  ? 'text-pink-500 bg-black/70'
                                  : 'text-zinc-400 hover:text-white bg-black/60 hover:bg-zinc-800'
                              }`}
                            >
                              <Heart
                                className={`w-3.5 h-3.5 ${
                                  isMediaFav(item.id) ? 'fill-current' : ''
                                }`}
                              />
                            </button>
                          </div>
                          <span className="media-card-title">{item.title}</span>
                          <span className="media-card-info">
                            {item.score && (
                              <span className="text-emerald-400 font-bold">{item.score}</span>
                            )}
                            <span>{item.year && item.year !== '—' ? item.year : ''}</span>
                            <span>
                              {item.genres && item.genres.length > 0
                                ? item.genres.slice(0, 2).join(' · ')
                                : item.kind || ''}
                            </span>
                          </span>
                        </div>
                      ))}
                    </div>
                    )}

                    {/* Load More Button */}
                    {filteredMediaList.length > 0 &&
                      (visibleMediaList.length < filteredMediaList.length || hasMoreMap[activeTab] !== false) && (
                        <div className="zentix-load-more pt-6 pb-12 flex justify-center">
                          <button
                            type="button"
                            onClick={() => {
                              if (visibleMediaList.length < filteredMediaList.length) {
                                setCatalogVisibleLimit((limit) => limit + CATALOG_PAGE_SIZE);
                                return;
                              }
                              handleLoadMore();
                            }}
                            disabled={isLoadingMore}
                            className="empty-button flex items-center gap-2 cursor-pointer font-semibold"
                          >
                            {isLoadingMore ? (
                              <>
                                <Loader2 className="w-4 h-4 animate-spin text-red-600" />
                                <span>Cargando más títulos...</span>
                              </>
                            ) : (
                              <span>
                                {visibleMediaList.length < filteredMediaList.length
                                  ? 'Ver más títulos'
                                  : 'Cargar más títulos'}
                              </span>
                            )}
                          </button>
                        </div>
                      )}

                    {filteredMediaList.length === 0 && !isLoading && (
                      <div className="empty-state py-20 text-center text-zinc-500 space-y-3">
                        <Film className="w-12 h-12 mx-auto opacity-30 text-zinc-500" />
                        <h2 className="empty-title text-xl font-bold text-white">
                          No hay títulos en esta categoría
                        </h2>
                        <button
                          type="button"
                          className="empty-button"
                          onClick={() => {
                            setSelectedGenre('all');
                            loadInitialData(true);
                          }}
                        >
                          Restablecer filtros
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* VIEW: TV EN VIVO (LIVE TV) */}
                {activeTab === 'live' && (
                  <div className="catalog-content is-filtered pt-24 px-4 sm:px-8 space-y-6">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-zinc-900">
                      <div>
                        <h1 className="browse-view-title text-2xl sm:text-3xl font-bold flex items-center gap-2.5">
                          <span>Televisión en Vivo</span>
                          <span className="text-red-500 font-bold text-xs uppercase bg-red-950/60 border border-red-800/60 px-2 py-0.5 rounded">
                            ● DIRECTO
                          </span>
                        </h1>
                        <p className="text-xs text-zinc-400 mt-1">
                          {filteredLiveChannels.length.toLocaleString('es-CO')} canales disponibles en alta definición
                        </p>
                      </div>
                      {isAdultUnlocked && (
                        <button
                          type="button"
                          onClick={handleLockAdultSection}
                          className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-amber-950/70 hover:bg-amber-900/80 border border-amber-700/70 text-amber-300 text-xs font-bold transition-colors cursor-pointer self-start sm:self-auto"
                        >
                          <Lock className="w-3.5 h-3.5" />
                          <span>Bloquear sección +18</span>
                        </button>
                      )}
                    </div>

                    {/* Category Scrolling Pills */}
                    {visibleCategories.length > 0 && (
                      <div className="live-category-rail flex items-center gap-2 overflow-x-auto pb-2 no-scrollbar">
                        <button
                          type="button"
                          onClick={() => handleCategorySelect('all')}
                          className={`text-xs px-3.5 py-1.5 rounded-full font-semibold transition-all cursor-pointer whitespace-nowrap ${
                            selectedCategory === 'all'
                              ? 'bg-white text-black font-bold shadow'
                              : 'bg-[#242424] text-zinc-300 hover:text-white border border-zinc-800'
                          }`}
                        >
                          Todos
                        </button>
                        {visibleCategories.map((cat) => {
                          const adultCat = isAdultCategory(cat);
                          return (
                            <button
                              key={cat.id}
                              type="button"
                              onClick={() => handleCategorySelect(cat.id)}
                              className={`text-xs px-3.5 py-1.5 rounded-full font-semibold transition-all cursor-pointer whitespace-nowrap inline-flex items-center gap-1.5 ${
                                selectedCategory === cat.id
                                  ? 'bg-white text-black font-bold shadow'
                                  : adultCat && !isAdultUnlocked
                                  ? 'bg-zinc-900/90 text-amber-400 hover:text-amber-300 border border-amber-800/60'
                                  : 'bg-[#242424] text-zinc-300 hover:text-white border border-zinc-800'
                              }`}
                            >
                              {adultCat && !isAdultUnlocked && <Lock className="w-3 h-3" />}
                              <span>{cat.name}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                      <label className="relative flex-1 max-w-md">
                        <span className="sr-only">Buscar canal en vivo</span>
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                        <input
                          type="search"
                          value={liveQuery}
                          onChange={(event) => {
                            setLiveQuery(event.target.value);
                            setLiveVisibleLimit(LIVE_CHANNEL_PAGE_SIZE);
                          }}
                          placeholder="Buscar canal o categoría"
                          className="w-full h-9 rounded-md border border-zinc-800 bg-[#171717] pl-9 pr-3 text-sm text-white placeholder:text-zinc-500 outline-none transition-colors focus:border-zinc-500"
                        />
                      </label>
                      <label className="flex items-center gap-2 self-start sm:self-auto">
                        <span className="text-xs text-zinc-500">Ordenar</span>
                        <select
                          value={liveSort}
                          onChange={(event) => {
                            setLiveSort(event.target.value as 'recommended' | 'title');
                            setLiveVisibleLimit(LIVE_CHANNEL_PAGE_SIZE);
                          }}
                          className="h-9 rounded-md border border-zinc-800 bg-[#171717] px-3 text-xs font-semibold text-zinc-200 outline-none focus:border-zinc-500"
                        >
                          <option value="recommended">Recomendados</option>
                          <option value="title">Nombre: A–Z</option>
                        </select>
                      </label>
                      {liveQuery && (
                        <button
                          type="button"
                          onClick={() => {
                            setLiveQuery('');
                            setLiveVisibleLimit(LIVE_CHANNEL_PAGE_SIZE);
                          }}
                          className="h-9 px-3 text-xs font-semibold text-zinc-300 hover:text-white transition-colors"
                        >
                          Limpiar
                        </button>
                      )}
                    </div>

                    {/* Channels Grid */}
                    {isLoading ? (
                      <div className="results-grid catalog-skeleton-grid" aria-busy="true" aria-label="Cargando canales en vivo">
                        {Array.from({ length: 12 }, (_, index) => (
                          <div className="catalog-skeleton-card" key={index} aria-hidden="true">
                            <div className="catalog-skeleton-poster is-landscape" />
                            <div className="catalog-skeleton-line is-title" />
                            <div className="catalog-skeleton-line" />
                          </div>
                        ))}
                      </div>
                    ) : (
                    <div className="results-grid">
                      {visibleLiveChannels.map((ch, idx) => (
                        <div
                          key={ch.channelCode || ch.id || idx}
                          className="media-card group cursor-pointer"
                          onClick={() => playChannel(ch)}
                        >
                          <div className="media-card-art flex flex-col items-center justify-center p-4 bg-[#1f1f1f] relative overflow-hidden">
                            <span className="card-netflix">M</span>
                            <span className="absolute top-2 right-2 text-[9px] font-bold text-red-500 bg-red-950/70 border border-red-800/60 px-1.5 py-0.5 rounded">
                              ● VIVO
                            </span>

                            {ch.logo ? (
                              <img
                                src={ch.logo}
                                alt={ch.name}
                                className="h-12 w-auto max-w-[80%] object-contain drop-shadow transition-transform group-hover:scale-105"
                                onError={(e) => {
                                  (e.target as HTMLElement).style.display = 'none';
                                }}
                              />
                            ) : (
                              <div className="h-12 w-12 rounded-lg bg-zinc-800 flex items-center justify-center text-zinc-400 group-hover:text-white">
                                <Play className="w-6 h-6 fill-current" />
                              </div>
                            )}

                            <button
                              type="button"
                              onClick={(e) => toggleFavoriteChannel(e, ch)}
                              className={`absolute bottom-2 right-2 p-1.5 rounded-full z-10 transition-colors ${
                                isChannelFav(ch.channelCode || ch.id || '')
                                  ? 'text-pink-500 bg-pink-950/80'
                                  : 'text-zinc-400 hover:text-white bg-black/60 hover:bg-zinc-800'
                              }`}
                            >
                              <Heart
                                className={`w-3.5 h-3.5 ${
                                  isChannelFav(ch.channelCode || ch.id || '')
                                    ? 'fill-current'
                                    : ''
                                }`}
                              />
                            </button>
                          </div>
                          <span className="media-card-title">{ch.name}</span>
                          <span className="media-card-info">
                            {ch.category || 'Televisión en Vivo'}
                          </span>
                        </div>
                      ))}
                    </div>
                    )}

                    {!isLoading && visibleLiveChannels.length < filteredLiveChannels.length && (
                      <div className="zentix-load-more pt-2 pb-8 flex justify-center">
                        <button
                          type="button"
                          onClick={() => setLiveVisibleLimit((limit) => limit + LIVE_CHANNEL_PAGE_SIZE)}
                          className="empty-button flex items-center gap-2 cursor-pointer font-semibold"
                        >
                          Mostrar más canales ({(filteredLiveChannels.length - visibleLiveChannels.length).toLocaleString('es-CO')} restantes)
                        </button>
                      </div>
                    )}

                    {visibleLiveChannels.length === 0 && !isLoading && (
                      <div className="empty-state py-20 text-center text-zinc-500 space-y-3">
                        <Tv className="w-12 h-12 mx-auto opacity-30 text-zinc-500" />
                        <h2 className="empty-title text-xl font-bold text-white">
                          No se encontraron canales en esta categoría
                        </h2>
                        <button
                          type="button"
                          className="empty-button"
                          onClick={() => handleCategorySelect('all')}
                        >
                          Mostrar todos los canales
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* VIEW: FAVORITOS (MI LISTA E HISTORIAL) */}
                {activeTab === 'favorites' && (
                  <div className="catalog-content is-filtered pt-24 px-4 sm:px-8 space-y-8">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3 border-b border-zinc-900">
                      <div>
                        <h1 className="browse-view-title text-2xl sm:text-3xl font-bold">
                          Mi Lista e Historial ({visibleFavChannels.length + favMedia.length + watchHistory.length})
                        </h1>
                        <p className="text-xs text-zinc-400 mt-1">
                          {currentUser
                            ? `Sincronizado con tu cuenta (${currentUser.email || profileName}). Retoma cualquier título exactamente donde lo dejaste.`
                            : 'Guardado localmente en este navegador. Inicia sesión con tu correo para sincronizar tu historial en la nube.'}
                        </p>
                      </div>

                      {!currentUser && (
                        <Button
                          size="sm"
                          onClick={() => {
                            setAuthModalMode('login');
                            setIsAuthModalOpen(true);
                          }}
                          className="bg-red-600 hover:bg-red-700 text-white font-bold text-xs gap-1.5 self-start sm:self-auto cursor-pointer"
                        >
                          <LogIn className="w-3.5 h-3.5" />
                          <span>Iniciar sesión para guardar en la nube</span>
                        </Button>
                      )}
                    </div>

                    {/* Watch History / Continuar viendo Section */}
                    {watchHistory.length > 0 && (
                      <div className="space-y-4">
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="text-sm font-bold text-zinc-200 uppercase tracking-wider flex items-center gap-2">
                            <History className="w-4 h-4 text-red-500" />
                            <span>Continuar viendo • Historial de reproducción ({watchHistory.length})</span>
                          </h3>
                          <button
                            type="button"
                            onClick={() => {
                              clearAllWatchHistory(currentUser?.uid || null);
                              showToast('Historial de reproducción eliminado.');
                            }}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-semibold text-zinc-400 hover:text-red-400 transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Limpiar historial</span>
                          </button>
                        </div>

                        <div className="results-grid">
                          {watchHistory.map((entry, idx) => {
                            const mediaObj = watchHistoryMediaItems[idx];
                            const pct = Math.min(100, Math.max(4, entry.progressPercent || 0));
                            const label = entry.episodeNumber
                              ? `T${entry.seasonNumber || 1}:E${entry.episodeNumber} • ${formatPlaybackTime(entry.currentTime)}`
                              : `${formatPlaybackTime(entry.currentTime)}${
                                  entry.duration > 0 ? ` / ${formatPlaybackTime(entry.duration)}` : ''
                                }`;

                            return (
                              <div
                                key={`${entry.id}-${idx}`}
                                className="media-card group cursor-pointer"
                                onClick={() => handleDirectResume(mediaObj, entry)}
                              >
                                <div className="media-card-art is-poster relative">
                                  <img
                                    src={entry.poster || entry.landscape || entry.backdrop}
                                    alt={entry.title}
                                    loading="lazy"
                                    className="w-full h-full object-cover transition-transform group-hover:brightness-105"
                                    onError={(e) => {
                                      const img = e.target as HTMLImageElement;
                                      const fallback = entry.landscape || entry.backdrop;
                                      if (fallback && img.src !== fallback && !img.dataset.retried) {
                                        img.dataset.retried = '1';
                                        img.src = fallback;
                                        return;
                                      }
                                      img.src =
                                        'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="400" height="600"%3E%3Crect width="100%25" height="100%25" fill="%23242424"/%3E%3Ctext x="50%25" y="50%25" text-anchor="middle" dominant-baseline="middle" fill="%23e50914" font-family="Arial" font-size="28" font-weight="bold"%3EMAICAOFLIX%3C/text%3E%3C/svg%3E';
                                    }}
                                  />
                                  <span className="card-netflix">M</span>
                                  <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        openMediaDetail(mediaObj);
                                      }}
                                      className="p-1.5 rounded-full bg-black/70 text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
                                      title="Ver detalles"
                                    >
                                      <Info className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={(e) => handleRemoveWatchItem(e, mediaObj)}
                                      className="p-1.5 rounded-full bg-black/70 text-zinc-300 hover:text-white hover:bg-red-600/90 transition-colors cursor-pointer"
                                      title="Quitar del historial"
                                    >
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                  <span className="absolute bottom-2.5 left-1.5 z-10 px-1.5 py-0.5 rounded bg-black/85 border border-white/10 text-[10px] font-bold text-white shadow">
                                    {label}
                                  </span>
                                  <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-zinc-800/95 z-10 overflow-hidden">
                                    <div
                                      className="h-full bg-red-600"
                                      style={{ width: `${pct}%` }}
                                    />
                                  </div>
                                </div>
                                <span className="media-card-title">{entry.title}</span>
                                <span className="media-card-info">
                                  <span className="text-red-400 font-semibold">
                                    Lo dejaste en {formatPlaybackTime(entry.currentTime)}
                                  </span>
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Saved Channels Section */}
                    {visibleFavChannels.length > 0 && (
                      <div className="space-y-3">
                        <h3 className="text-sm font-bold text-zinc-300 uppercase tracking-wider flex items-center gap-2">
                          <Tv className="w-4 h-4 text-red-600" />
                          <span>Canales Guardados ({visibleFavChannels.length})</span>
                        </h3>
                        <div className="results-grid">
                          {visibleFavChannels.map((ch, idx) => (
                            <div
                              key={ch.channelCode || ch.id || idx}
                              className="media-card group cursor-pointer"
                              onClick={() => playChannel(ch)}
                            >
                              <div className="media-card-art flex flex-col items-center justify-center p-4 bg-[#1f1f1f] relative overflow-hidden">
                                <span className="card-netflix">M</span>
                                <span className="absolute top-2 right-2 text-[9px] font-bold text-red-500 bg-red-950/70 border border-red-800/60 px-1.5 py-0.5 rounded">
                                  ● VIVO
                                </span>

                                {ch.logo ? (
                                  <img
                                    src={ch.logo}
                                    alt={ch.name}
                                    className="h-12 w-auto max-w-[80%] object-contain drop-shadow transition-transform group-hover:scale-105"
                                  />
                                ) : (
                                  <div className="h-12 w-12 rounded-lg bg-zinc-800 flex items-center justify-center text-zinc-400 group-hover:text-white">
                                    <Play className="w-6 h-6 fill-current" />
                                  </div>
                                )}

                                <button
                                  type="button"
                                  onClick={(e) => toggleFavoriteChannel(e, ch)}
                                  className="absolute bottom-2 right-2 p-1.5 rounded-full z-10 text-pink-500 bg-pink-950/80 hover:bg-zinc-800"
                                >
                                  <Heart className="w-3.5 h-3.5 fill-current" />
                                </button>
                              </div>
                              <span className="media-card-title">{ch.name}</span>
                              <span className="media-card-info">
                                {ch.category || 'Televisión en Vivo'}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Saved Media Section */}
                    {favMedia.length > 0 && (
                      <div className="space-y-3">
                        <h3 className="text-sm font-bold text-zinc-300 uppercase tracking-wider flex items-center gap-2">
                          <Film className="w-4 h-4 text-amber-500" />
                          <span>Películas & Series Guardadas ({favMedia.length})</span>
                        </h3>
                        <div className="results-grid">
                          {favMedia.map((item, idx) => (
                            <div
                              key={item.id || idx}
                              className="media-card group cursor-pointer"
                              onClick={() => openMediaDetail(item)}
                            >
                              <div className="media-card-art is-poster relative">
                                <img
                                  src={item.poster || item.landscape || item.backdrop}
                                  alt={item.title}
                                  loading="lazy"
                                  className="w-full h-full object-cover transition-transform group-hover:brightness-105"
                                  onError={(e) => {
                                    const img = e.target as HTMLImageElement;
                                    const fallback = item.landscape || item.backdrop;
                                    if (fallback && img.src !== fallback && !img.dataset.retried) {
                                      img.dataset.retried = '1';
                                      img.src = fallback;
                                      return;
                                    }
                                    img.src =
                                      'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="400" height="600"%3E%3Crect width="100%25" height="100%25" fill="%23242424"/%3E%3Ctext x="50%25" y="50%25" text-anchor="middle" dominant-baseline="middle" fill="%23e50914" font-family="Arial" font-size="28" font-weight="bold"%3EMAICAOFLIX%3C/text%3E%3C/svg%3E';
                                  }}
                                />
                                <span className="card-netflix">M</span>
                                <button
                                  type="button"
                                  onClick={(e) => toggleFavoriteMedia(e, item)}
                                  className="absolute top-2 right-2 p-1.5 rounded-full z-10 text-pink-500 bg-black/70 hover:bg-zinc-800"
                                >
                                  <Heart className="w-3.5 h-3.5 fill-current" />
                                </button>
                              </div>
                              <span className="media-card-title">{item.title}</span>
                              <span className="media-card-info">
                                {item.score && (
                                  <span className="text-emerald-400 font-bold">{item.score}</span>
                                )}
                                <span>{item.year && item.year !== '—' ? item.year : ''}</span>
                                <span>{item.kind || ''}</span>
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {visibleFavChannels.length === 0 && favMedia.length === 0 && watchHistory.length === 0 && (
                      <div className="empty-state py-24 text-center text-zinc-500 space-y-4">
                        <Heart className="w-12 h-12 mx-auto text-zinc-600" />
                        <h2 className="empty-title text-xl font-bold text-white">
                          Tu lista e historial están vacíos
                        </h2>
                        <p className="empty-copy text-sm max-w-md mx-auto">
                          Explora el catálogo, reproduce un título o pulsa el icono de corazón para guardar tus favoritos y retomar donde lo dejaste.
                        </p>
                        <button
                          type="button"
                          className="empty-button"
                          onClick={() => navigateTab('home')}
                        >
                          Explorar títulos
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </main>

          {/* ============================================================ */}
          {/* 4. AUTHENTIC MAICAOFLIX FOOTER                               */}
          {/* ============================================================ */}
          <footer className="browse-footer mt-16 border-t border-zinc-900">
            <div className="zentix-footer-top flex items-center gap-4 mb-6">
              <MaicaoflixLogo width={110} height={24} />
              <span className="text-xs text-zinc-500">
                Streaming de Películas, Series y TV en Vivo en Alta Definición.
              </span>
            </div>
            <nav aria-label="Enlaces del catálogo">
              <ul className="browse-footer-links grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs text-zinc-500 mb-8 list-none p-0">
                <li>
                  <button
                    type="button"
                    onClick={() => navigateTab('home')}
                    className="hover:underline cursor-pointer"
                  >
                    Inicio
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => navigateTab('series')}
                    className="hover:underline cursor-pointer"
                  >
                    Series
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => navigateTab('movies')}
                    className="hover:underline cursor-pointer"
                  >
                    Películas
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => navigateTab('live')}
                    className="hover:underline cursor-pointer"
                  >
                    TV en Vivo
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => navigateTab('anime')}
                    className="hover:underline cursor-pointer"
                  >
                    Animé
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => navigateTab('kids')}
                    className="hover:underline cursor-pointer"
                  >
                    Infantil
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => navigateTab('favorites')}
                    className="hover:underline cursor-pointer"
                  >
                    Mi Lista
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => setIsSettingsModalOpen(true)}
                    className="hover:underline cursor-pointer"
                  >
                    Configuración
                  </button>
                </li>
              </ul>
            </nav>
            <p className="browse-copyright text-[11px] text-zinc-600">
              © {new Date().getFullYear()} MAICAOFLIX • Todos los derechos reservados.
            </p>
          </footer>
        </>
      )}

      {/* ============================================================ */}
      {/* 5. PLAYER & SETTINGS MODALS                                  */}
      {/* ============================================================ */}
      {activePlayback && (
        <Player
          url={activePlayback.url}
          title={activePlayback.title}
          subtitle={activePlayback.subtitle}
          isLive={activePlayback.isLive}
          initialTime={activePlayback.initialTime}
          subtitles={activePlayback.subtitles}
          audioLanguages={activePlayback.audioLanguages}
          channels={visibleLiveChannels}
          contentId={activePlayback.contentId}
          seriesId={activePlayback.seriesId}
          rootSeriesId={activePlayback.mediaItem?.id}
          episodeMeta={activePlayback.episodeMeta}
          episodeProgressMap={
            activePlayback.mediaItem?.id
              ? episodeProgressMap[activePlayback.mediaItem.id]
              : undefined
          }
          onSelectChannel={(ch) => playChannel(ch)}
          onSelectEpisode={handleSwitchEpisodeInPlayer}
          onSwitchAudioTrack={handleSwitchAudioTrack}
          onProgressUpdate={handlePlaybackProgress}
          onClose={() => setActivePlayback(null)}
        />
      )}

      <AuthModal
        isOpen={isAuthModalOpen}
        initialMode={authModalMode}
        onClose={() => setIsAuthModalOpen(false)}
        onSuccess={(msg) => showToast(msg)}
      />

      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        apiUrl={apiUrl}
        onSaveApiUrl={saveApiUrl}
        isBackendOnline={isBackendOnline}
        onCheckBackend={checkBackend}
        adultPin={adultPin}
        onUpdateAdultPin={(newPin) => {
          setAdultPin(newPin);
          localStorage.setItem('maicaoflix_adult_pin', newPin);
          showToast('PIN de Control Parental actualizado.');
        }}
        hideAdultCategory={hideAdultCategory}
        onToggleHideAdultCategory={(hide) => {
          setHideAdultCategory(hide);
          localStorage.setItem('maicaoflix_hide_adult', hide ? '1' : '0');
          if (hide) {
            setIsAdultUnlocked(false);
            const currentCatObj = categories.find((c) => c.id === selectedCategory);
            if (isAdultCategory(currentCatObj || { id: selectedCategory })) {
              loadCategoryChannels('all');
            }
          }
          showToast(hide ? 'Sección +18 ocultada del catálogo.' : 'Sección +18 visible con PIN.');
        }}
      />

      {/* Parental Control (+18) PIN Modal */}
      {pinModal.open && (
        <div
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setPinModal({ open: false })}
        >
          <div
            className="w-full max-w-sm bg-[#181818] border border-zinc-800 rounded-xl overflow-hidden shadow-2xl p-6 space-y-4 animate-in fade-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-amber-950/80 border border-amber-700/70 flex items-center justify-center text-amber-400">
                  <Lock className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Control Parental (+18)</h3>
                  <p className="text-[11px] text-zinc-400">Contenido restringido para mayores de edad</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPinModal({ open: false })}
                className="w-7 h-7 rounded-full bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center text-zinc-300 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleVerifyAdultPin} className="space-y-4">
              <p className="text-xs text-zinc-300 leading-relaxed">
                Ingresa el código PIN de 4 dígitos para desbloquear la sección <strong className="text-amber-400">18+</strong> de TV en Vivo:
              </p>

              <Input
                type="password"
                inputMode="numeric"
                maxLength={4}
                autoFocus
                placeholder="••••"
                value={pinInput}
                onChange={(e) => {
                  setPinInput(e.target.value.replace(/\D/g, '').slice(0, 4));
                  setPinError('');
                }}
                className="bg-black/70 border-zinc-700 text-white text-center text-xl tracking-[0.6em] font-mono h-12"
              />

              {pinError && (
                <p className="text-xs text-red-400 font-semibold text-center">{pinError}</p>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setPinModal({ open: false })}
                  className="text-zinc-400 hover:text-white text-xs cursor-pointer"
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={pinInput.length < 4}
                  className="bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs px-5 cursor-pointer"
                >
                  Desbloquear +18
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Global Alert Dialog (Shadcn) */}
      {alertModal && (
        <AlertDialog open={alertModal.open} onOpenChange={(open) => !open && setAlertModal(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{alertModal.title}</AlertDialogTitle>
              <AlertDialogDescription>{alertModal.description}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogAction onClick={() => setAlertModal(null)}>Aceptar</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {/* Toast Notification */}
      <div
        className={`browse-toast ${toastMessage ? 'is-visible' : ''}`}
        role="status"
        aria-live="polite"
      >
        {toastMessage}
      </div>
    </div>
  );
};

export default App;
