import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
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
  Loader2,
} from 'lucide-react';
import { NetflixLogo } from './components/NetflixLogo';
import { NetflixRow } from './components/NetflixRow';
import { MediaDetailPage } from './components/MediaDetailPage';
import { Player } from './components/Player';
import { SettingsModal } from './components/SettingsModal';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Badge } from './components/ui/badge';
import {
  api,
  Channel,
  MediaItem,
  SubtitleTrack,
  AudioLanguage,
  getApiBaseUrl,
  setApiBaseUrl,
} from './services/api';

type TabView = 'home' | 'series' | 'movies' | 'live' | 'anime' | 'kids' | 'favorites';

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
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedGenre, setSelectedGenre] = useState<string>('all');
  const [sortOption, setSortOption] = useState<string>('recommended');

  // Search states
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<MediaItem[]>([]);
  const [channelSearchResults, setChannelSearchResults] = useState<Channel[]>([]);
  const [searchFilterTab, setSearchFilterTab] = useState<'all' | 'media' | 'channels'>('all');
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Pagination & Loading
  const [isLoading, setIsLoading] = useState(false);
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
    return localStorage.getItem('netflix_profile_name') || 'Invitado';
  });
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState('');

  // Modals & Playback
  const [selectedMedia, setSelectedMedia] = useState<MediaItem | null>(null);
  const [activePlayback, setActivePlayback] = useState<{
    url: string;
    title: string;
    subtitle?: string;
    isLive?: boolean;
    subtitles?: SubtitleTrack[];
    audioLanguages?: AudioLanguage[];
    contentId?: string;
    seriesId?: string;
  } | null>(null);

  const headerRef = useRef<HTMLElement>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => {
      setToastMessage('');
    }, 3200);
  }, []);

  // Listen to window scroll to trigger solid Netflix header
  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

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
        setMobileNavOpen(false);
      }
    };
    document.addEventListener('click', handleOutsideClick);
    return () => document.removeEventListener('click', handleOutsideClick);
  }, []);

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
      if (cats.length > 0) setCategories(cats);
      if (chs.length > 0) setChannels(chs);
    } catch (err) {
      console.error('Error loading initial data:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  // Category change for Live TV
  const handleCategorySelect = async (catId: string) => {
    setSelectedCategory(catId);
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
  const playChannel = async (channel: Channel) => {
    try {
      const code = channel.channelCode || channel.id || '';
      const res = await api.resolveLive(code, channel.streamUrl);
      if (res && res.url) {
        setActivePlayback({
          url: res.url,
          title: channel.name,
          subtitle: `En Vivo • ${channel.category || 'Televisión'}`,
          isLive: true,
          contentId: code,
        });
      } else {
        alert('No se pudo sintonizar el canal en este momento.');
      }
    } catch (e) {
      console.error('Error playing channel:', e);
      alert('Error de conexión al cargar la señal en vivo.');
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

  // Global search effect
  useEffect(() => {
    if (searchQuery.trim().length < 2) {
      setSearchResults([]);
      setChannelSearchResults([]);
      setIsSearching(false);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const q = searchQuery.trim().toLowerCase();
        const mediaRes = await api.search(q);
        setSearchResults(mediaRes);

        const chMatches = channels.filter(
          (c) =>
            c.name.toLowerCase().includes(q) ||
            (c.category && c.category.toLowerCase().includes(q))
        );
        setChannelSearchResults(chMatches);
      } catch (err) {
        console.error('Error searching:', err);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery, channels]);

  const isSearchActive = searchQuery.trim().length >= 2;
  const totalSearchResults = searchResults.length + channelSearchResults.length;

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
    const set = new Set<string>();
    currentCatalogList.forEach((item) => {
      if (item.genres && Array.isArray(item.genres)) {
        item.genres.forEach((g) => {
          if (g && typeof g === 'string') set.add(g.trim());
        });
      }
    });
    return ['all', ...Array.from(set).sort((a, b) => a.localeCompare(b, 'es'))];
  }, [currentCatalogList]);

  const filteredMediaList = useMemo(() => {
    let list = currentCatalogList;
    if (selectedGenre !== 'all') {
      list = list.filter((item) =>
        item.genres?.some((g) => g.toLowerCase() === selectedGenre.toLowerCase())
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

  // Billboard Hero Item
  const heroItem = useMemo(() => {
    if (homeFeatured.length > 0) return homeFeatured[0];
    if (movies.length > 0) return movies[0];
    if (series.length > 0) return series[0];
    return null;
  }, [homeFeatured, movies, series]);

  const navigateTab = (tab: TabView) => {
    setActiveTab(tab);
    setSelectedGenre('all');
    setSortOption('recommended');
    setSearchQuery('');
    setIsSearchOpen(false);
    setMobileNavOpen(false);
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
      {/* 1. AUTHENTIC NETFLIX TOP HEADER BAR                          */}
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
          className="browse-brand cursor-pointer shrink-0 transition-opacity hover:opacity-90"
          aria-label="Netflix, ir a inicio"
        >
          <NetflixLogo width={102} height={28} />
        </button>

        {/* Mobile Nav Toggle */}
        <button
          className="mobile-nav-toggle flex items-center gap-1.5 md:hidden text-xs text-white font-semibold cursor-pointer"
          type="button"
          aria-expanded={mobileNavOpen}
          onClick={() => setMobileNavOpen(!mobileNavOpen)}
        >
          <span>Explorar</span>
          <ChevronDown className="w-3.5 h-3.5" />
        </button>

        {/* Primary Desktop & Mobile Navigation Links */}
        <nav
          className={`primary-navigation flex items-center gap-5 text-sm ${
            mobileNavOpen ? 'is-open' : ''
          }`}
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
        <div className="browse-header-actions ml-auto flex items-center gap-4">
          {/* Expandable Search Input */}
          <div className={`browse-search ${isSearchOpen || searchQuery ? 'is-open' : ''}`}>
            <button
              className="header-icon cursor-pointer"
              type="button"
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
              placeholder="Títulos, personas, géneros..."
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
                ? 'Servidor Backend Activo • Ultra HD'
                : 'Servidor Backend Desconectado (Clic para configurar)'
            }
            className="flex items-center gap-1.5 px-2 py-1 rounded bg-black/40 border border-zinc-800 hover:border-zinc-700 transition-colors text-[11px] cursor-pointer"
          >
            <span
              className={`w-2 h-2 rounded-full ${
                isBackendOnline ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'
              }`}
            />
            <span className="hidden lg:inline text-zinc-400 font-medium">
              {isBackendOnline ? 'En línea' : 'Reconectar'}
            </span>
          </button>

          {/* Netflix Profile Avatar & Menu */}
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
              <div className="header-menu profile-menu absolute right-0 top-full mt-2 w-60 bg-[#181818] border border-zinc-700 rounded-md shadow-2xl py-3 z-50 text-xs animate-in fade-in duration-150">
                <div className="px-4 pb-2 border-b border-zinc-800">
                  <p className="text-zinc-400 text-[10px] uppercase font-bold tracking-wider">
                    Perfil Activo
                  </p>
                  <p className="text-sm font-bold text-white mt-0.5">{profileName}</p>
                </div>

                <div className="py-2">
                  <button
                    type="button"
                    onClick={() => {
                      navigateTab('favorites');
                      setIsProfileMenuOpen(false);
                    }}
                    className="w-full px-4 py-2 text-left text-zinc-300 hover:text-white hover:bg-zinc-800 flex items-center gap-2"
                  >
                    <Heart className="w-4 h-4 text-pink-500" />
                    <span>Mi lista de guardados</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsSettingsModalOpen(true);
                      setIsProfileMenuOpen(false);
                    }}
                    className="w-full px-4 py-2 text-left text-zinc-300 hover:text-white hover:bg-zinc-800 flex items-center gap-2"
                  >
                    <Server className="w-4 h-4 text-red-500" />
                    <span>Configuración del Servidor</span>
                  </button>
                </div>

                <div className="px-4 pt-2 border-t border-zinc-800 text-[11px] text-zinc-500">
                  Streaming Ultra HD • Netflix Clone
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ============================================================ */}
      {/* 2. MAIN VIEW AREA                                            */}
      {/* ============================================================ */}
      <main id="browse-main" className="relative">
        {/* ============================================================ */}
        {/* GLOBAL SEARCH RESULTS (SHOWN WHEN SEARCH QUERY >= 2)        */}
        {/* ============================================================ */}
        {isSearchActive ? (
          <div className="catalog-content is-filtered pt-24 px-4 sm:px-8 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-zinc-800">
              <div>
                <h1 className="browse-view-title text-2xl sm:text-3xl font-bold">
                  Resultados para "{searchQuery}"
                </h1>
                <p className="text-xs text-zinc-400 mt-1">
                  {isSearching
                    ? 'Buscando en el catálogo en vivo...'
                    : `Se encontraron ${totalSearchResults} resultado(s)`}
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

            {/* Channels Search Matches */}
            {(searchFilterTab === 'all' || searchFilterTab === 'channels') &&
              channelSearchResults.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-sm font-bold text-zinc-300 uppercase tracking-wider flex items-center gap-2">
                    <Tv className="w-4 h-4 text-red-600" />
                    <span>Canales de TV ({channelSearchResults.length})</span>
                  </h3>
                  <div className="results-grid">
                    {channelSearchResults.map((ch, idx) => (
                      <div
                        key={ch.channelCode || idx}
                        className="media-card group cursor-pointer"
                        onClick={() => playChannel(ch)}
                      >
                        <div className="media-card-art flex flex-col items-center justify-center p-4 bg-[#1f1f1f] relative overflow-hidden">
                          <span className="card-netflix">N</span>
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
                                isChannelFav(ch.channelCode || ch.id || '') ? 'fill-current' : ''
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
            {(searchFilterTab === 'all' || searchFilterTab === 'media') &&
              searchResults.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-sm font-bold text-zinc-300 uppercase tracking-wider flex items-center gap-2">
                    <Film className="w-4 h-4 text-amber-500" />
                    <span>Películas y Series ({searchResults.length})</span>
                  </h3>
                  <div className="results-grid">
                    {searchResults.map((item, idx) => (
                      <div
                        key={item.id || idx}
                        className="media-card group cursor-pointer"
                        onClick={() => setSelectedMedia(item)}
                      >
                        <div className="media-card-art relative">
                          <img
                            src={item.backdrop || item.landscape || item.poster}
                            alt={item.title}
                            className="w-full h-full object-cover transition-transform group-hover:brightness-105"
                          />
                          <span className="card-netflix">N</span>
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
            {!isSearching && totalSearchResults === 0 && (
              <div className="empty-state py-20 text-center text-zinc-500 space-y-3">
                <Search className="w-12 h-12 mx-auto opacity-30 text-zinc-500" />
                <h2 className="empty-title text-xl font-bold text-white">
                  No encontramos resultados para "{searchQuery}"
                </h2>
                <p className="empty-copy text-sm max-w-md mx-auto">
                  Prueba a buscar con otra palabra clave, nombre de película, serie, o canal.
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
          /* ============================================================ */
          /* NORMAL NAVIGATION BROWSING (HOME, SERIES, MOVIES, ETC.)     */
          /* ============================================================ */
          <>
            {/* ========================================================== */}
            {/* VIEW: INICIO (HOME)                                         */}
            {/* ========================================================== */}
            {activeTab === 'home' && (
              <>
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
                        <span className="text-red-600 font-black text-2xl">N</span>
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
                          onClick={() => setSelectedMedia(heroItem)}
                        >
                          <Play className="w-5 h-5 fill-current" />
                          <span>Reproducir</span>
                        </button>
                        <button
                          type="button"
                          className="featured-info cursor-pointer inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded bg-zinc-600/70 text-white font-bold text-base hover:bg-zinc-600/40 transition-colors backdrop-blur-md"
                          onClick={() => setSelectedMedia(heroItem)}
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
                  {/* Row 1: Tendencias ahora (Top 10) */}
                  <NetflixRow
                    heading="Tendencias ahora"
                    items={movies.slice(0, 10)}
                    isTop10={true}
                    isFavorite={isMediaFav}
                    onToggleFavorite={toggleFavoriteMedia}
                    onSelectMedia={setSelectedMedia}
                    onViewAll={() => navigateTab('movies')}
                  />

                  {/* Row 2: Canales en Vivo Populares */}
                  {channels.length > 0 && (
                    <NetflixRow
                      heading="Canales de Televisión en Vivo"
                      items={[]}
                      isChannelRow={true}
                      channels={channels.slice(0, 20)}
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
                      isFavorite={isMediaFav}
                      onToggleFavorite={toggleFavoriteMedia}
                      onSelectMedia={setSelectedMedia}
                      onViewAll={() => navigateTab('movies')}
                    />
                  )}

                  {/* Row 4: Series para un maratón */}
                  {series.length > 0 && (
                    <NetflixRow
                      heading="Series para un maratón"
                      items={series.slice(0, 20)}
                      isFavorite={isMediaFav}
                      onToggleFavorite={toggleFavoriteMedia}
                      onSelectMedia={setSelectedMedia}
                      onViewAll={() => navigateTab('series')}
                    />
                  )}

                  {/* Row 5: Animé y animación */}
                  {anime.length > 0 && (
                    <NetflixRow
                      heading="Animé y Animación"
                      items={anime.slice(0, 20)}
                      isFavorite={isMediaFav}
                      onToggleFavorite={toggleFavoriteMedia}
                      onSelectMedia={setSelectedMedia}
                      onViewAll={() => navigateTab('anime')}
                    />
                  )}

                  {/* Row 6: Infantil & Familia */}
                  {kids.length > 0 && (
                    <NetflixRow
                      heading="Para disfrutar en familia"
                      items={kids.slice(0, 20)}
                      isFavorite={isMediaFav}
                      onToggleFavorite={toggleFavoriteMedia}
                      onSelectMedia={setSelectedMedia}
                      onViewAll={() => navigateTab('kids')}
                    />
                  )}

                  {/* Row 7: Mi lista (if items saved) */}
                  {favMedia.length > 0 && (
                    <NetflixRow
                      heading={`Mi lista de ${profileName}`}
                      items={favMedia}
                      isFavorite={isMediaFav}
                      onToggleFavorite={toggleFavoriteMedia}
                      onSelectMedia={setSelectedMedia}
                      onViewAll={() => navigateTab('favorites')}
                    />
                  )}
                </div>
              </>
            )}

            {/* ========================================================== */}
            {/* VIEW: CATALOG TABS (PELÍCULAS, SERIES, ANIMÉ, INFANTIL)    */}
            {/* ========================================================== */}
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

                    {/* Genre Dropdown / Filter */}
                    {availableGenres.length > 2 && (
                      <label className="catalog-filter relative">
                        <span className="sr-only">Filtrar por género</span>
                        <select
                          value={selectedGenre}
                          onChange={(e) => setSelectedGenre(e.target.value)}
                          className="bg-[#242424] text-white text-xs font-semibold border border-zinc-700 rounded px-3 py-1.5 cursor-pointer focus:outline-none"
                        >
                          <option value="all">Todos los géneros</option>
                          {availableGenres
                            .filter((g) => g !== 'all')
                            .map((g) => (
                              <option key={g} value={g}>
                                {g}
                              </option>
                            ))}
                        </select>
                      </label>
                    )}
                  </div>

                  {/* Sort dropdown */}
                  <label className="catalog-filter sort-control relative">
                    <span className="sr-only">Ordenar</span>
                    <select
                      value={sortOption}
                      onChange={(e) => setSortOption(e.target.value)}
                      className="bg-[#242424] text-white text-xs font-semibold border border-zinc-700 rounded px-3 py-1.5 cursor-pointer focus:outline-none"
                    >
                      <option value="recommended">Recomendados</option>
                      <option value="title">Título: A–Z</option>
                      <option value="year">Más recientes</option>
                    </select>
                  </label>
                </div>

                <div className="zentix-catalog-status text-xs text-zinc-400">
                  {filteredMediaList.length} títulos disponibles
                  {selectedGenre !== 'all' && ` en género "${selectedGenre}"`}
                </div>

                {/* Grid of Titles */}
                <div className="results-grid">
                  {filteredMediaList.map((item, idx) => (
                    <div
                      key={item.id || idx}
                      className="media-card group cursor-pointer"
                      onClick={() => setSelectedMedia(item)}
                    >
                      <div className="media-card-art relative">
                        <img
                          src={item.backdrop || item.landscape || item.poster}
                          alt={item.title}
                          loading="lazy"
                          className="w-full h-full object-cover transition-transform group-hover:brightness-105"
                          onError={(e) => {
                            (e.target as HTMLImageElement).src =
                              'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="600" height="338"%3E%3Crect width="100%25" height="100%25" fill="%23242424"/%3E%3Ctext x="50%25" y="50%25" text-anchor="middle" dominant-baseline="middle" fill="%23e50914" font-family="Arial" font-size="36" font-weight="bold"%3ENETFLIX%3C/text%3E%3C/svg%3E';
                          }}
                        />
                        <span className="card-netflix">N</span>
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

                {/* Load More Button */}
                {filteredMediaList.length > 0 &&
                  selectedGenre === 'all' &&
                  hasMoreMap[activeTab] !== false && (
                    <div className="zentix-load-more pt-6 pb-12 flex justify-center">
                      <button
                        type="button"
                        onClick={handleLoadMore}
                        disabled={isLoadingMore}
                        className="empty-button flex items-center gap-2 cursor-pointer font-semibold"
                      >
                        {isLoadingMore ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin text-red-600" />
                            <span>Cargando más títulos...</span>
                          </>
                        ) : (
                          <span>Cargar más títulos</span>
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

            {/* ========================================================== */}
            {/* VIEW: TV EN VIVO (LIVE TV)                                 */}
            {/* ========================================================== */}
            {activeTab === 'live' && (
              <div className="catalog-content is-filtered pt-24 px-4 sm:px-8 space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-zinc-900">
                  <div>
                    <h1 className="browse-view-title text-2xl sm:text-3xl font-bold flex items-center gap-2.5">
                      <span>Televisión en Vivo</span>
                      <span className="text-red-500 font-bold text-xs uppercase bg-red-950/60 border border-red-800/60 px-2 py-0.5 rounded animate-pulse">
                        ● DIRECTO
                      </span>
                    </h1>
                    <p className="text-xs text-zinc-400 mt-1">
                      {channels.length} canales disponibles en alta definición
                    </p>
                  </div>
                </div>

                {/* Category Scrolling Pills */}
                {categories.length > 0 && (
                  <div className="flex items-center gap-2 overflow-x-auto pb-2 no-scrollbar">
                    <button
                      type="button"
                      onClick={() => handleCategorySelect('all')}
                      className={`text-xs px-3.5 py-1.5 rounded-full font-semibold transition-all cursor-pointer whitespace-nowrap ${
                        selectedCategory === 'all'
                          ? 'bg-white text-black font-bold shadow'
                          : 'bg-[#242424] text-zinc-300 hover:text-white border border-zinc-800'
                      }`}
                    >
                      Todos ({categories.length})
                    </button>
                    {categories.map((cat) => (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => handleCategorySelect(cat.id)}
                        className={`text-xs px-3.5 py-1.5 rounded-full font-semibold transition-all cursor-pointer whitespace-nowrap ${
                          selectedCategory === cat.id
                            ? 'bg-white text-black font-bold shadow'
                            : 'bg-[#242424] text-zinc-300 hover:text-white border border-zinc-800'
                        }`}
                      >
                        {cat.name}
                      </button>
                    ))}
                  </div>
                )}

                {/* Channels Grid */}
                <div className="results-grid">
                  {channels.map((ch, idx) => (
                    <div
                      key={ch.channelCode || ch.id || idx}
                      className="media-card group cursor-pointer"
                      onClick={() => playChannel(ch)}
                    >
                      <div className="media-card-art flex flex-col items-center justify-center p-4 bg-[#1f1f1f] relative overflow-hidden">
                        <span className="card-netflix">N</span>
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
                              isChannelFav(ch.channelCode || ch.id || '') ? 'fill-current' : ''
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

                {channels.length === 0 && !isLoading && (
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

            {/* ========================================================== */}
            {/* VIEW: FAVORITOS (MI LISTA)                                 */}
            {/* ========================================================== */}
            {activeTab === 'favorites' && (
              <div className="catalog-content is-filtered pt-24 px-4 sm:px-8 space-y-8">
                <div className="pb-2 border-b border-zinc-900">
                  <h1 className="browse-view-title text-2xl sm:text-3xl font-bold">
                    Mi Lista ({favChannels.length + favMedia.length})
                  </h1>
                  <p className="text-xs text-zinc-400 mt-1">
                    Tus canales, películas y series favoritas guardados en este navegador.
                  </p>
                </div>

                {/* Saved Channels Section */}
                {favChannels.length > 0 && (
                  <div className="space-y-3">
                    <h3 className="text-sm font-bold text-zinc-300 uppercase tracking-wider flex items-center gap-2">
                      <Tv className="w-4 h-4 text-red-600" />
                      <span>Canales Guardados ({favChannels.length})</span>
                    </h3>
                    <div className="results-grid">
                      {favChannels.map((ch, idx) => (
                        <div
                          key={ch.channelCode || ch.id || idx}
                          className="media-card group cursor-pointer"
                          onClick={() => playChannel(ch)}
                        >
                          <div className="media-card-art flex flex-col items-center justify-center p-4 bg-[#1f1f1f] relative overflow-hidden">
                            <span className="card-netflix">N</span>
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
                          onClick={() => setSelectedMedia(item)}
                        >
                          <div className="media-card-art relative">
                            <img
                              src={item.backdrop || item.landscape || item.poster}
                              alt={item.title}
                              className="w-full h-full object-cover transition-transform group-hover:brightness-105"
                            />
                            <span className="card-netflix">N</span>
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

                {favChannels.length === 0 && favMedia.length === 0 && (
                  <div className="empty-state py-24 text-center text-zinc-500 space-y-4">
                    <Heart className="w-12 h-12 mx-auto text-zinc-600" />
                    <h2 className="empty-title text-xl font-bold text-white">
                      Tu lista está vacía
                    </h2>
                    <p className="empty-copy text-sm max-w-md mx-auto">
                      Explora el catálogo y pulsa el icono de corazón o "Mi lista" para guardar tus
                      títulos y canales preferidos aquí.
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
      {/* 3. AUTHENTIC NETFLIX FOOTER                                  */}
      {/* ============================================================ */}
      <footer className="browse-footer mt-16 border-t border-zinc-900">
        <div className="zentix-footer-top flex items-center gap-4 mb-6">
          <NetflixLogo width={85} height={24} />
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
          © {new Date().getFullYear()} Netflix Clone • Todos los derechos reservados.
        </p>
      </footer>

      {/* ============================================================ */}
      {/* 4. MODALS (DETAIL DIALOG, PLAYER, SETTINGS, TOAST)           */}
      {/* ============================================================ */}
      {selectedMedia && (
        <MediaDetailPage
          media={selectedMedia}
          onBack={() => setSelectedMedia(null)}
          onPlayMovie={(url, title, subtitle, subtitles, audioLanguages, contentId) => {
            setActivePlayback({
              url,
              title,
              subtitle,
              isLive: false,
              subtitles,
              audioLanguages,
              contentId,
            });
          }}
          onPlayEpisode={(
            url,
            title,
            subtitle,
            subtitles,
            audioLanguages,
            contentId,
            seriesId
          ) => {
            setActivePlayback({
              url,
              title,
              subtitle,
              isLive: false,
              subtitles,
              audioLanguages,
              contentId,
              seriesId,
            });
          }}
          isFavorite={isMediaFav(selectedMedia.id)}
          onToggleFavorite={(item) => toggleFavoriteMedia(undefined, item)}
        />
      )}

      {activePlayback && (
        <Player
          url={activePlayback.url}
          title={activePlayback.title}
          subtitle={activePlayback.subtitle}
          isLive={activePlayback.isLive}
          subtitles={activePlayback.subtitles}
          audioLanguages={activePlayback.audioLanguages}
          channels={channels}
          onSelectChannel={(ch) => playChannel(ch)}
          onSwitchAudioTrack={handleSwitchAudioTrack}
          onClose={() => setActivePlayback(null)}
        />
      )}

      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        apiUrl={apiUrl}
        onSaveApiUrl={saveApiUrl}
        isBackendOnline={isBackendOnline}
        onCheckBackend={checkBackend}
      />

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
