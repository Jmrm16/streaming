import React, { useEffect, useState } from 'react';
import {
  Home,
  Tv,
  Film,
  Clapperboard,
  Search,
  Settings,
  RefreshCw,
  Play,
  Server,
  Sparkles,
  Star,
  Info,
  Heart,
  Baby,
  Smile,
  ChevronRight,
  X,
  Loader2,
  User,
  PanelLeftClose,
  PanelLeft,
  Menu,
  Activity,
  Eye,
  EyeOff,
} from 'lucide-react';
import { Button } from './components/ui/button';
import { Card, CardContent } from './components/ui/card';
import { Input } from './components/ui/input';
import { Badge } from './components/ui/badge';
import { Player } from './components/Player';
import { MediaDetailPage } from './components/MediaDetailPage';
import { api, Channel, MediaItem, SubtitleTrack, AudioLanguage, getApiBaseUrl, setApiBaseUrl } from './services/api';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<
    'home' | 'live' | 'movies' | 'series' | 'anime' | 'kids' | 'favorites' | 'settings'
  >('home');

  const [isBackendOnline, setIsBackendOnline] = useState<boolean | null>(null);

  // Data states
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [channels, setChannels] = useState<Channel[]>([]);
  const [allChannelsCache, setAllChannelsCache] = useState<Channel[]>([]);
  const [homeFeatured, setHomeFeatured] = useState<MediaItem[]>([]);
  const [movies, setMovies] = useState<MediaItem[]>([]);
  const [series, setSeries] = useState<MediaItem[]>([]);
  const [anime, setAnime] = useState<MediaItem[]>([]);
  const [kids, setKids] = useState<MediaItem[]>([]);

  // Search states
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<MediaItem[]>([]);
  const [channelSearchResults, setChannelSearchResults] = useState<Channel[]>([]);
  const [searchFilterTab, setSearchFilterTab] = useState<'all' | 'media' | 'channels'>('all');

  const [isLoading, setIsLoading] = useState(false);
  const [apiUrl, setApiUrlState] = useState(getApiBaseUrl());

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

  // Sidebar states
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => {
    return localStorage.getItem('xuper_sidebar_collapsed') === 'true';
  });
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [showApiUrl, setShowApiUrl] = useState(false);
  const searchInputRef = React.useRef<HTMLInputElement>(null);

  const toggleSidebar = () => {
    setIsSidebarCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem('xuper_sidebar_collapsed', String(next));
      return next;
    });
  };

  // Modal Detail state
  const [selectedMedia, setSelectedMedia] = useState<MediaItem | null>(null);

  // Player state
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

  const handleSwitchAudioTrack = async (trackIndex: number) => {
    if (!activePlayback || !activePlayback.contentId) return;
    try {
      const res = await api.resolveMedia(
        activePlayback.contentId,
        activePlayback.seriesId,
        trackIndex
      );
      if (res.url) {
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

  // Check backend status
  const checkBackend = async () => {
    const online = await api.ping();
    setIsBackendOnline(online);
    return online;
  };

  useEffect(() => {
    checkBackend();
    const interval = setInterval(checkBackend, 10000);
    return () => clearInterval(interval);
  }, []);

  // Pre-fetch live channels for instant channel searching
  useEffect(() => {
    const fetchAllChannels = async () => {
      const chans = await api.getLiveChannels(undefined, 1, 250);
      if (chans && chans.length > 0) {
        setAllChannelsCache(chans);
      }
    };
    fetchAllChannels();
  }, []);

  // Initial load when tab changes
  useEffect(() => {
    loadTabData();
  }, [activeTab]);

  const loadTabData = async () => {
    setIsLoading(true);
    if (activeTab === 'home') {
      const [feat, chans, movs, sers] = await Promise.all([
        api.getHome('featured'),
        api.getLiveChannels(undefined, 1, 30),
        api.getHome('movies'),
        api.getHome('series'),
      ]);
      setHomeFeatured(feat);
      setChannels(chans);
      setMovies(movs);
      setSeries(sers);
    } else if (activeTab === 'live') {
      const [cats, chans] = await Promise.all([
        api.getLiveCategories(),
        api.getLiveChannels(selectedCategory === 'all' ? undefined : selectedCategory, 1, 250),
      ]);
      setCategories([{ id: 'all', name: 'Todos los Canales' }, ...cats]);
      setChannels(chans);
      if (chans.length > allChannelsCache.length) {
        setAllChannelsCache(chans);
      }
    } else if (activeTab === 'movies') {
      const items = await api.getHome('movies');
      setMovies(items);
    } else if (activeTab === 'series') {
      const items = await api.getHome('series');
      setSeries(items);
    } else if (activeTab === 'anime') {
      const items = await api.getHome('anime');
      setAnime(items);
    } else if (activeTab === 'kids') {
      const items = await api.getHome('kids');
      setKids(items);
    }
    setIsLoading(false);
  };

  // Real Global Search Handler with Debounce
  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (trimmed.length < 2) {
      setSearchResults([]);
      setChannelSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    const timeout = setTimeout(async () => {
      try {
        const queryLower = trimmed.toLowerCase();

        // 1. Search backend API across thousands of movies and series
        const mediaItems = await api.search(trimmed);
        setSearchResults(mediaItems);

        // 2. Search across channels (cache + current channels)
        const combinedChannels = [...channels, ...allChannelsCache];
        const uniqueChannelsMap = new Map<string, Channel>();
        combinedChannels.forEach((c) => {
          const key = c.channelCode || c.name;
          if (!uniqueChannelsMap.has(key)) {
            uniqueChannelsMap.set(key, c);
          }
        });

        const matchedChans = Array.from(uniqueChannelsMap.values()).filter(
          (c) =>
            c.name.toLowerCase().includes(queryLower) ||
            (c.category && c.category.toLowerCase().includes(queryLower))
        );
        setChannelSearchResults(matchedChans);
      } catch (err) {
        console.error('Error during search:', err);
      } finally {
        setIsSearching(false);
      }
    }, 350);

    return () => clearTimeout(timeout);
  }, [searchQuery, channels, allChannelsCache]);

  const handleCategorySelect = async (catId: string) => {
    setSelectedCategory(catId);
    setIsLoading(true);
    const chans = await api.getLiveChannels(catId === 'all' ? undefined : catId, 1, 250);
    setChannels(chans);
    setIsLoading(false);
  };

  const playChannel = async (channel: Channel) => {
    try {
      const res = await api.resolveLive(channel.channelCode || '', channel.streamUrl);
      if (res.url) {
        setActivePlayback({
          url: res.url,
          title: channel.name,
          subtitle: channel.category || 'Transmisión en Vivo',
          isLive: true,
        });
      } else {
        alert('No se pudo obtener el enlace de transmisión para este canal.');
      }
    } catch {
      alert('Error al resolver la señal en vivo.');
    }
  };

  // Favorites helpers
  const toggleFavoriteChannel = (e: React.MouseEvent, channel: Channel) => {
    e.stopPropagation();
    let updated: Channel[];
    const exists = favChannels.some(
      (c) => (c.channelCode && c.channelCode === channel.channelCode) || c.name === channel.name
    );
    if (exists) {
      updated = favChannels.filter(
        (c) => (c.channelCode && c.channelCode !== channel.channelCode) || c.name !== channel.name
      );
    } else {
      updated = [...favChannels, channel];
    }
    setFavChannels(updated);
    localStorage.setItem('xuper_fav_channels', JSON.stringify(updated));
  };

  const isChannelFav = (channel: Channel) => {
    return favChannels.some(
      (c) => (c.channelCode && c.channelCode === channel.channelCode) || c.name === channel.name
    );
  };

  const toggleFavoriteMedia = (e: React.MouseEvent | undefined, item: MediaItem) => {
    if (e) e.stopPropagation();
    let updated: MediaItem[];
    const exists = favMedia.some((m) => m.id === item.id);
    if (exists) {
      updated = favMedia.filter((m) => m.id !== item.id);
    } else {
      updated = [...favMedia, item];
    }
    setFavMedia(updated);
    localStorage.setItem('xuper_fav_media', JSON.stringify(updated));
  };

  const isMediaFav = (item: MediaItem) => {
    return favMedia.some((m) => m.id === item.id);
  };

  const handleSaveApiUrl = () => {
    setApiBaseUrl(apiUrl);
    checkBackend().then(() => loadTabData());
  };

  const heroItem = homeFeatured.length > 0 ? homeFeatured[0] : null;

  const currentMediaList =
    activeTab === 'movies'
      ? movies
      : activeTab === 'series'
      ? series
      : activeTab === 'anime'
      ? anime
      : activeTab === 'kids'
      ? kids
      : activeTab === 'favorites'
      ? favMedia
      : [];

  const isSearchActive = searchQuery.trim().length >= 2;
  const totalSearchResults = searchResults.length + channelSearchResults.length;

  const navSections = [
    {
      title: 'Descubrir',
      items: [
        {
          id: 'home' as const,
          label: 'Inicio',
          icon: Home,
          color: 'text-rose-400',
        },
        {
          id: 'live' as const,
          label: 'TV en Vivo',
          icon: Tv,
          color: 'text-rose-500',
          badge: categories.length > 0 ? `${categories.length} cat.` : 'Live',
          badgeColor: 'bg-rose-950/70 text-rose-400 border border-rose-800/40',
        },
      ],
    },
    {
      title: 'Catálogo VOD',
      items: [
        {
          id: 'movies' as const,
          label: 'Películas',
          icon: Film,
          color: 'text-amber-400',
        },
        {
          id: 'series' as const,
          label: 'Series',
          icon: Clapperboard,
          color: 'text-sky-400',
        },
        {
          id: 'anime' as const,
          label: 'Animé',
          icon: Smile,
          color: 'text-purple-400',
        },
        {
          id: 'kids' as const,
          label: 'Infantil / Kids',
          icon: Baby,
          color: 'text-emerald-400',
        },
      ],
    },
    {
      title: 'Biblioteca',
      items: [
        {
          id: 'favorites' as const,
          label: 'Mis Favoritos',
          icon: Heart,
          color: 'text-pink-500',
          badge:
            favChannels.length + favMedia.length > 0
              ? String(favChannels.length + favMedia.length)
              : undefined,
          badgeColor: 'bg-pink-950/70 text-pink-400 border border-pink-800/40',
        },
      ],
    },
    {
      title: 'Sistema',
      items: [
        {
          id: 'settings' as const,
          label: 'Configuración',
          icon: Settings,
          color: 'text-zinc-400',
        },
      ],
    },
  ];

  const renderNavItems = (isCollapsed: boolean, onNavClick?: () => void) => (
    <div className="space-y-4">
      {navSections.map((sec, idx) => (
        <div key={idx} className="space-y-1">
          {!isCollapsed && (
            <p className="px-3 text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-1.5 select-none">
              {sec.title}
            </p>
          )}
          {sec.items.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id && !isSearchActive;
            return (
              <Button
                key={item.id}
                variant={isActive ? 'secondary' : 'ghost'}
                size="sm"
                title={isCollapsed ? item.label : undefined}
                onClick={() => {
                  setSelectedMedia(null);
                  setSearchQuery('');
                  setActiveTab(item.id);
                  if (onNavClick) onNavClick();
                }}
                className={`w-full h-10 px-3 text-xs font-medium cursor-pointer transition-all ${
                  isCollapsed ? 'justify-center' : 'justify-start gap-3'
                } ${
                  isActive
                    ? 'bg-zinc-800/90 text-white font-semibold border-l-2 border-rose-500 shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900/80'
                }`}
              >
                <Icon className={`h-4 w-4 shrink-0 ${item.color}`} />
                {!isCollapsed && <span className="truncate">{item.label}</span>}
                {!isCollapsed && item.badge && (
                  <Badge
                    variant="outline"
                    className={`ml-auto text-[10px] py-0 px-1.5 font-semibold ${item.badgeColor}`}
                  >
                    {item.badge}
                  </Badge>
                )}
              </Button>
            );
          })}
        </div>
      ))}
    </div>
  );

  return (
    <div className="flex h-screen w-screen bg-zinc-950 text-zinc-100 overflow-hidden font-sans">
      {/* Mobile Drawer Overlay */}
      {isMobileSidebarOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex animate-in fade-in duration-200">
          <div
            className="fixed inset-0 bg-black/80 backdrop-blur-sm"
            onClick={() => setIsMobileSidebarOpen(false)}
          />
          <aside className="relative w-72 max-w-[80vw] h-full bg-zinc-950 border-r border-zinc-800/80 p-4 flex flex-col justify-between z-10 shadow-2xl">
            <div className="space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-zinc-800/60">
                <div className="flex items-center gap-2.5">
                  <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-rose-600 to-red-500 flex items-center justify-center shadow-lg shadow-rose-950/40">
                    <Tv className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-extrabold text-base tracking-wider text-white">
                        STREAM
                      </span>
                      <span className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-pulse" />
                    </div>
                    <p className="text-[10px] text-zinc-500 font-medium">Ultra HD</p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsMobileSidebarOpen(false)}
                  className="h-8 w-8 text-zinc-400 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="overflow-y-auto max-h-[calc(100vh-180px)] pr-1">
                {renderNavItems(false, () => setIsMobileSidebarOpen(false))}
              </div>
            </div>

            {/* Mobile Backend status */}
            <div
              onClick={() => {
                setActiveTab('settings');
                setIsMobileSidebarOpen(false);
              }}
              className="border border-zinc-800/80 rounded-xl p-3 bg-zinc-900/60 cursor-pointer hover:border-zinc-700 transition-colors"
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <Server className="h-3.5 w-3.5 text-zinc-400" />
                  <span className="text-xs font-semibold text-zinc-300">Servidor Backend</span>
                </div>
                <span
                  className={`flex h-2 w-2 rounded-full ${
                    isBackendOnline
                      ? 'bg-emerald-500 ring-4 ring-emerald-950 animate-pulse'
                      : 'bg-rose-500 ring-4 ring-rose-950'
                  }`}
                />
              </div>
              <p className="text-[11px] text-zinc-400 font-medium">
                {isBackendOnline ? 'Servicio Activo • Ultra HD' : 'Conectando con el servidor...'}
              </p>
            </div>
          </aside>
        </div>
      )}

      {/* Desktop Collapsible Sidebar */}
      <aside
        className={`hidden md:flex flex-col justify-between border-r border-zinc-800/80 bg-zinc-950/90 backdrop-blur-xl z-20 shrink-0 transition-all duration-300 ease-in-out ${
          isSidebarCollapsed ? 'w-20 p-2.5' : 'w-64 p-4'
        }`}
      >
        <div className="space-y-4">
          {/* Logo & Toggle Header */}
          <div
            className={`flex items-center ${
              isSidebarCollapsed ? 'flex-col gap-2' : 'justify-between'
            } pb-3 border-b border-zinc-800/60`}
          >
            <div className="flex items-center gap-2.5 overflow-hidden">
              <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-rose-600 to-red-500 flex items-center justify-center shadow-lg shadow-rose-950/40 shrink-0">
                <Tv className="h-5 w-5 text-white" />
              </div>
              {!isSidebarCollapsed && (
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-extrabold text-base tracking-wider text-white">
                      STREAM
                    </span>
                    <span className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-pulse" />
                  </div>
                  <p className="text-[10px] text-zinc-500 font-medium truncate">Ultra HD</p>
                </div>
              )}
            </div>

            <Button
              variant="ghost"
              size="icon"
              onClick={toggleSidebar}
              title={isSidebarCollapsed ? 'Expandir menú (Ctrl+B)' : 'Colapsar menú (Ctrl+B)'}
              className="h-8 w-8 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-900 shrink-0 cursor-pointer"
            >
              {isSidebarCollapsed ? (
                <PanelLeft className="h-4 w-4" />
              ) : (
                <PanelLeftClose className="h-4 w-4" />
              )}
            </Button>
          </div>

          {/* Navigation Links */}
          <div className="overflow-y-auto max-h-[calc(100vh-210px)] pr-0.5 space-y-2">
            {renderNavItems(isSidebarCollapsed)}
          </div>
        </div>

        {/* Desktop Backend Status Footer */}
        {isSidebarCollapsed ? (
          <div
            onClick={() => setActiveTab('settings')}
            title={isBackendOnline ? 'Servidor Conectado • Ultra HD' : 'Servidor Desconectado'}
            className="flex flex-col items-center justify-center py-3 border border-zinc-800/80 rounded-xl bg-zinc-900/40 hover:bg-zinc-900/80 cursor-pointer transition-colors"
          >
            <span
              className={`flex h-2.5 w-2.5 rounded-full ${
                isBackendOnline
                  ? 'bg-emerald-500 ring-4 ring-emerald-950 animate-pulse'
                  : 'bg-rose-500 ring-4 ring-rose-950'
              }`}
            />
          </div>
        ) : (
          <div className="border border-zinc-800/80 rounded-xl p-3 bg-zinc-900/40 hover:bg-zinc-900/80 transition-colors">
            <div className="flex items-center justify-between mb-1">
              <div
                onClick={() => setActiveTab('settings')}
                className="flex items-center gap-2 cursor-pointer"
              >
                <Server className="h-3.5 w-3.5 text-zinc-400" />
                <span className="text-xs font-semibold text-zinc-300">Servidor de Streaming</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={(e) => {
                    e.stopPropagation();
                    checkBackend();
                  }}
                  title="Comprobar estado"
                  className="h-5 w-5 p-0 text-zinc-500 hover:text-white"
                >
                  <Activity className="h-3 w-3" />
                </Button>
                <span
                  className={`flex h-2 w-2 rounded-full ${
                    isBackendOnline
                      ? 'bg-emerald-500 ring-4 ring-emerald-950 animate-pulse'
                      : 'bg-rose-500 ring-4 ring-rose-950'
                  }`}
                />
              </div>
            </div>
            <p
              onClick={() => setActiveTab('settings')}
              className="text-[10px] text-zinc-400 cursor-pointer hover:text-zinc-200"
            >
              {isBackendOnline ? 'En línea • Ultra HD 1080p' : 'Reconectando con el servidor...'}
            </p>
          </div>
        )}
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col h-full overflow-hidden bg-zinc-950">
        {selectedMedia ? (
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
            onPlayEpisode={(url, title, subtitle, subtitles, audioLanguages, contentId, seriesId) => {
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
            isFavorite={isMediaFav(selectedMedia)}
            onToggleFavorite={(item) => toggleFavoriteMedia(undefined, item)}
          />
        ) : (
          <>
            {/* Header Bar */}
        <header className="h-16 border-b border-zinc-800/80 bg-zinc-950/70 backdrop-blur-md px-4 sm:px-6 flex items-center justify-between gap-3 z-10 shrink-0">
          <div className="flex items-center gap-3 flex-1 max-w-xl">
            {/* Mobile Hamburger Menu */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsMobileSidebarOpen(true)}
              className="md:hidden h-9 w-9 text-zinc-400 hover:text-white shrink-0"
            >
              <Menu className="h-5 w-5" />
            </Button>

            {/* Search Bar with Keyboard Shortcut */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
              <Input
                ref={searchInputRef}
                type="text"
                placeholder="Buscar películas, series, anime o canales..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 pr-14 bg-zinc-900/80 border-zinc-800 text-xs focus-visible:ring-rose-500"
              />
              <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                {isSearching ? (
                  <Loader2 className="h-4 w-4 text-rose-500 animate-spin" />
                ) : searchQuery.length > 0 ? (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="text-zinc-400 hover:text-white p-0.5 rounded-full"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                ) : (
                  <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded bg-zinc-800/80 px-1.5 py-0.5 text-[10px] font-mono text-zinc-400 border border-zinc-700/50">
                    /
                  </kbd>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={loadTabData}
              className="gap-2 text-xs border-zinc-800 bg-zinc-900/50 hover:bg-zinc-800 text-zinc-300 hover:text-white cursor-pointer"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Actualizar</span>
            </Button>
            <div className="flex items-center gap-2 pl-3 border-l border-zinc-800">
              <div className="h-7 w-7 rounded-full bg-zinc-800 border border-zinc-700/60 flex items-center justify-center text-zinc-300">
                <User className="h-3.5 w-3.5" />
              </div>
            </div>
          </div>
        </header>

        {/* View Container */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-6 space-y-6 sm:space-y-8 pb-24 md:pb-8">
          {/* ============================================================ */}
          {/* SEARCH RESULTS VIEW (ACTIVATED GLOBALLY WHEN QUERY >= 2)      */}
          {/* ============================================================ */}
          {isSearchActive ? (
            <div className="space-y-6 animate-in fade-in duration-200">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-zinc-800">
                <div>
                  <div className="flex items-center gap-2">
                    <Search className="h-5 w-5 text-rose-500" />
                    <h2 className="text-xl font-bold text-white">
                      Resultados para "{searchQuery}"
                    </h2>
                  </div>
                  <p className="text-xs text-zinc-400 mt-1">
                    {isSearching
                      ? 'Consultando catálogo en vivo...'
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
                    Canales de TV ({channelSearchResults.length})
                  </Button>
                </div>
              </div>

              {/* SEARCH: CANALES ENCONTRADOS */}
              {(searchFilterTab === 'all' || searchFilterTab === 'channels') &&
                channelSearchResults.length > 0 && (
                  <div className="space-y-3">
                    <h3 className="text-sm font-bold text-zinc-300 uppercase tracking-wider flex items-center gap-2">
                      <Tv className="h-4 w-4 text-rose-500" />
                      <span>Canales de Televisión ({channelSearchResults.length})</span>
                    </h3>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                      {channelSearchResults.map((channel, idx) => (
                        <Card
                          key={channel.channelCode || idx}
                          className="group border border-zinc-800/80 bg-zinc-900/30 hover:bg-zinc-900 hover:border-zinc-700 transition-all cursor-pointer flex flex-col justify-between overflow-hidden relative"
                          onClick={() => playChannel(channel)}
                        >
                          <button
                            onClick={(e) => toggleFavoriteChannel(e, channel)}
                            className={`absolute top-2 right-2 p-1.5 rounded-full z-10 transition-colors ${
                              isChannelFav(channel)
                                ? 'text-pink-500 bg-pink-950/60'
                                : 'text-zinc-500 hover:text-white bg-black/40 hover:bg-zinc-800'
                            }`}
                          >
                            <Heart className={`h-3.5 w-3.5 ${isChannelFav(channel) ? 'fill-current' : ''}`} />
                          </button>
                          <CardContent className="p-4 flex flex-col items-center justify-center min-h-[130px] text-center">
                            {channel.logo ? (
                              <img src={channel.logo} alt={channel.name} className="h-12 w-auto object-contain mb-2 drop-shadow" />
                            ) : (
                              <div className="h-10 w-10 rounded-lg bg-zinc-800 flex items-center justify-center mb-2">
                                <Tv className="h-5 w-5 text-zinc-400" />
                              </div>
                            )}
                            <h4 className="text-xs font-semibold text-zinc-200 line-clamp-2 group-hover:text-white">
                              {channel.name}
                            </h4>
                          </CardContent>
                          <div className="bg-zinc-900/80 border-t border-zinc-800/60 px-3 py-2 flex items-center justify-between">
                            <span className="text-[10px] text-rose-500 font-mono font-bold">● EN VIVO</span>
                            <Button variant="ghost" size="icon" className="h-6 w-6 rounded-full group-hover:bg-rose-600 group-hover:text-white text-zinc-400">
                              <Play className="h-3 w-3 fill-current ml-0.5" />
                            </Button>
                          </div>
                        </Card>
                      ))}
                    </div>
                  </div>
                )}

              {/* SEARCH: PELICULAS Y SERIES ENCONTRADAS */}
              {(searchFilterTab === 'all' || searchFilterTab === 'media') &&
                searchResults.length > 0 && (
                  <div className="space-y-3">
                    <h3 className="text-sm font-bold text-zinc-300 uppercase tracking-wider flex items-center gap-2">
                      <Film className="h-4 w-4 text-amber-500" />
                      <span>Películas y Series ({searchResults.length})</span>
                    </h3>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                      {searchResults.map((item, idx) => (
                        <Card
                          key={item.id || idx}
                          className="group border border-zinc-800/80 bg-zinc-900/40 hover:border-zinc-700 transition-all duration-300 overflow-hidden cursor-pointer relative"
                          onClick={() => setSelectedMedia(item)}
                        >
                          <button
                            onClick={(e) => toggleFavoriteMedia(e, item)}
                            className={`absolute top-2 right-2 p-1.5 rounded-full z-10 transition-colors ${
                              isMediaFav(item)
                                ? 'text-pink-500 bg-pink-950/70'
                                : 'text-zinc-400 hover:text-white bg-black/60 hover:bg-zinc-800'
                            }`}
                          >
                            <Heart className={`h-3.5 w-3.5 ${isMediaFav(item) ? 'fill-current' : ''}`} />
                          </button>
                          <div className="aspect-[2/3] relative overflow-hidden bg-zinc-900">
                            {item.poster ? (
                              <img
                                src={item.poster}
                                alt={item.title}
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-zinc-600">
                                <Film className="h-10 w-10 opacity-30" />
                              </div>
                            )}
                            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-3">
                              <Button size="sm" className="w-full gap-2 rounded-lg text-xs font-semibold bg-white text-black shadow-lg">
                                <Info className="h-3.5 w-3.5" /> Ver Detalle
                              </Button>
                            </div>
                          </div>
                          <CardContent className="p-3">
                            <h4 className="text-xs font-semibold text-zinc-200 line-clamp-1 group-hover:text-white">
                              {item.title}
                            </h4>
                            <div className="flex items-center justify-between text-[11px] text-zinc-500 mt-1">
                              <span>{item.year && item.year !== '—' ? item.year : item.kind || ''}</span>
                              {item.score && (
                                <span className="flex items-center gap-1 text-amber-400 font-semibold text-[11px]">
                                  <Star className="h-2.5 w-2.5 fill-amber-400" />
                                  {item.score}
                                </span>
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                )}

              {/* EMPTY SEARCH STATE */}
              {!isSearching && totalSearchResults === 0 && (
                <div className="py-24 text-center text-zinc-500 space-y-3">
                  <Search className="h-12 w-12 mx-auto opacity-30" />
                  <p className="text-sm font-medium">
                    No encontramos ningún canal, película o serie que coincida con "{searchQuery}".
                  </p>
                  <Button variant="outline" size="sm" onClick={() => setSearchQuery('')} className="text-xs">
                    Limpiar Búsqueda
                  </Button>
                </div>
              )}
            </div>
          ) : (
            /* ============================================================ */
            /* NORMAL TABS BROWSING (HOME, LIVE, MOVIES, SERIES, ETC.)       */
            /* ============================================================ */
            <>
              {/* TAB: INICIO (HOME) */}
              {activeTab === 'home' && (
                <div className="space-y-8">
                  {/* Hero Banner */}
                  {heroItem && (
                    <div className="relative h-80 sm:h-96 rounded-2xl overflow-hidden border border-zinc-800 shadow-2xl bg-zinc-900 group">
                      <img
                        src={heroItem.backdrop || heroItem.landscape || heroItem.poster}
                        alt={heroItem.title}
                        className="w-full h-full object-cover object-top opacity-50 group-hover:scale-105 transition-transform duration-700"
                      />
                      <div className="absolute inset-0 bg-gradient-to-r from-zinc-950 via-zinc-950/80 to-transparent" />
                      <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-transparent to-transparent" />

                      <div className="absolute bottom-8 left-8 max-w-xl space-y-3">
                        <Badge variant="outline" className="text-[10px] font-bold tracking-wider text-rose-400 border-rose-500/50 bg-rose-950/40 uppercase">
                          ★ DESTACADO EN XUPER
                        </Badge>
                        <h1 className="text-3xl sm:text-4xl font-black text-white tracking-tight leading-tight">
                          {heroItem.title}
                        </h1>
                        {heroItem.synopsis && (
                          <p className="text-xs sm:text-sm text-zinc-300 line-clamp-3 leading-relaxed font-normal">
                            {heroItem.synopsis}
                          </p>
                        )}
                        <div className="flex items-center gap-3 pt-2">
                          <Button
                            size="lg"
                            onClick={() => setSelectedMedia(heroItem)}
                            className="gap-2.5 rounded-xl font-bold bg-white text-zinc-950 hover:bg-zinc-200 px-6 shadow-xl"
                          >
                            <Play className="h-4 w-4 fill-current" />
                            <span>Ver Ahora</span>
                          </Button>
                          <Button
                            variant="outline"
                            size="lg"
                            onClick={() => setSelectedMedia(heroItem)}
                            className="gap-2 rounded-xl text-xs border-zinc-700 bg-zinc-900/60 hover:bg-zinc-800"
                          >
                            <Info className="h-4 w-4" />
                            <span>Más Información</span>
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Fila: Canales en Vivo Populares */}
                  {channels.length > 0 && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-base font-bold text-white tracking-wide flex items-center gap-2">
                          <Tv className="h-4 w-4 text-rose-500" />
                          <span>Canales en Vivo Populares</span>
                        </h3>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setActiveTab('live')}
                          className="text-xs text-zinc-400 hover:text-white gap-1"
                        >
                          <span>Ver todos</span>
                          <ChevronRight className="h-3.5 w-3.5" />
                        </Button>
                      </div>

                      <div className="flex gap-4 overflow-x-auto pb-4 no-scrollbar">
                        {channels.slice(0, 15).map((channel, idx) => (
                          <Card
                            key={channel.channelCode || idx}
                            className="w-44 shrink-0 border border-zinc-800/80 bg-zinc-900/40 hover:bg-zinc-900 hover:border-zinc-700 transition-all cursor-pointer group"
                            onClick={() => playChannel(channel)}
                          >
                            <CardContent className="p-3 flex flex-col items-center justify-center h-28 text-center">
                              {channel.logo ? (
                                <img src={channel.logo} alt={channel.name} className="h-10 w-auto object-contain mb-2 drop-shadow" />
                              ) : (
                                <div className="h-10 w-10 rounded-lg bg-zinc-800 flex items-center justify-center mb-2">
                                  <Tv className="h-5 w-5 text-zinc-400" />
                                </div>
                              )}
                              <p className="text-xs font-semibold text-zinc-200 group-hover:text-white truncate w-full">
                                {channel.name}
                              </p>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Fila: Películas en Tendencia */}
                  {movies.length > 0 && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-base font-bold text-white tracking-wide flex items-center gap-2">
                          <Film className="h-4 w-4 text-amber-500" />
                          <span>Películas en Tendencia</span>
                        </h3>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setActiveTab('movies')}
                          className="text-xs text-zinc-400 hover:text-white gap-1"
                        >
                          <span>Ver catálogo</span>
                          <ChevronRight className="h-3.5 w-3.5" />
                        </Button>
                      </div>

                      <div className="flex gap-4 overflow-x-auto pb-4 no-scrollbar">
                        {movies.slice(0, 15).map((item, idx) => (
                          <div
                            key={item.id || idx}
                            className="w-36 sm:w-44 shrink-0 space-y-2 cursor-pointer group"
                            onClick={() => setSelectedMedia(item)}
                          >
                            <div className="aspect-[2/3] rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800/80 relative shadow-md">
                              <img
                                src={item.poster}
                                alt={item.title}
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                              />
                              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                <Play className="h-8 w-8 text-white fill-current" />
                              </div>
                            </div>
                            <p className="text-xs font-semibold text-zinc-200 group-hover:text-white truncate">
                              {item.title}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Fila: Series Populares */}
                  {series.length > 0 && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-base font-bold text-white tracking-wide flex items-center gap-2">
                          <Clapperboard className="h-4 w-4 text-sky-500" />
                          <span>Series Populares</span>
                        </h3>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setActiveTab('series')}
                          className="text-xs text-zinc-400 hover:text-white gap-1"
                        >
                          <span>Ver todas</span>
                          <ChevronRight className="h-3.5 w-3.5" />
                        </Button>
                      </div>

                      <div className="flex gap-4 overflow-x-auto pb-4 no-scrollbar">
                        {series.slice(0, 15).map((item, idx) => (
                          <div
                            key={item.id || idx}
                            className="w-36 sm:w-44 shrink-0 space-y-2 cursor-pointer group"
                            onClick={() => setSelectedMedia(item)}
                          >
                            <div className="aspect-[2/3] rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800/80 relative shadow-md">
                              <img
                                src={item.poster}
                                alt={item.title}
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                              />
                              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                <Play className="h-8 w-8 text-white fill-current" />
                              </div>
                            </div>
                            <p className="text-xs font-semibold text-zinc-200 group-hover:text-white truncate">
                              {item.title}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* TAB: TV EN VIVO */}
              {activeTab === 'live' && (
                <div className="space-y-4">
                  {/* Category Pills (38 Categories from the Portal) */}
                  {categories.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs text-zinc-400">
                        <span className="font-semibold text-zinc-300">
                          Categorías ({categories.length}):
                        </span>
                        <span>Mostrando {channels.length} canales</span>
                      </div>

                      <div className="flex items-center gap-2 overflow-x-auto pb-2 no-scrollbar">
                        {categories.map((cat) => (
                          <Button
                            key={cat.id}
                            variant={selectedCategory === cat.id ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => handleCategorySelect(cat.id)}
                            className={`text-xs whitespace-nowrap rounded-full transition-all ${
                              selectedCategory === cat.id
                                ? 'bg-zinc-100 text-zinc-950 font-bold shadow-md'
                                : 'border-zinc-800 text-zinc-400 hover:text-zinc-200'
                            }`}
                          >
                            {cat.name}
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Channels Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                    {channels.map((channel, idx) => (
                      <Card
                        key={channel.id || channel.channelCode || idx}
                        className="group border border-zinc-800/80 bg-zinc-900/30 hover:bg-zinc-900 hover:border-zinc-700 transition-all duration-300 hover:scale-[1.02] cursor-pointer flex flex-col justify-between overflow-hidden relative"
                        onClick={() => playChannel(channel)}
                      >
                        <button
                          onClick={(e) => toggleFavoriteChannel(e, channel)}
                          className={`absolute top-2 right-2 p-1.5 rounded-full z-10 transition-colors ${
                            isChannelFav(channel)
                              ? 'text-pink-500 bg-pink-950/60'
                              : 'text-zinc-500 hover:text-white bg-black/40 hover:bg-zinc-800'
                          }`}
                        >
                          <Heart className={`h-3.5 w-3.5 ${isChannelFav(channel) ? 'fill-current' : ''}`} />
                        </button>

                        <CardContent className="p-4 flex flex-col items-center justify-center min-h-[140px] text-center">
                          {channel.logo ? (
                            <img
                              src={channel.logo}
                              alt={channel.name}
                              className="h-14 w-auto object-contain mb-3 drop-shadow"
                              onError={(e) => {
                                (e.target as HTMLElement).style.display = 'none';
                              }}
                            />
                          ) : (
                            <div className="h-12 w-12 rounded-xl bg-zinc-800/80 flex items-center justify-center mb-3 group-hover:bg-rose-600 transition-colors">
                              <Tv className="h-6 w-6 text-zinc-400 group-hover:text-white" />
                            </div>
                          )}
                          <h4 className="text-xs font-semibold text-zinc-200 line-clamp-2 group-hover:text-white">
                            {channel.name}
                          </h4>
                          {channel.category && (
                            <span className="text-[10px] text-zinc-500 mt-1 line-clamp-1">
                              {channel.category}
                            </span>
                          )}
                        </CardContent>
                        <div className="bg-zinc-900/80 border-t border-zinc-800/60 px-3 py-2 flex items-center justify-between">
                          <span className="text-[10px] text-rose-500 font-mono font-bold">● EN VIVO</span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 rounded-full group-hover:bg-rose-600 group-hover:text-white text-zinc-400 transition-colors"
                          >
                            <Play className="h-3 w-3 fill-current ml-0.5" />
                          </Button>
                        </div>
                      </Card>
                    ))}
                  </div>

                  {channels.length === 0 && !isLoading && (
                    <div className="py-20 text-center text-zinc-500">
                      <Tv className="h-12 w-12 mx-auto mb-3 opacity-40" />
                      <p className="text-sm">No se encontraron canales en esta categoría o el servidor está apagado.</p>
                    </div>
                  )}
                </div>
              )}

              {/* TAB: CATALOGOS (MOVIES, SERIES, ANIME, KIDS, FAVORITES) */}
              {activeTab !== 'home' && activeTab !== 'live' && activeTab !== 'settings' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-bold text-white capitalize">
                      {activeTab === 'movies'
                        ? 'Catálogo de Películas'
                        : activeTab === 'series'
                        ? 'Catálogo de Series'
                        : activeTab === 'anime'
                        ? 'Catálogo de Anime'
                        : activeTab === 'kids'
                        ? 'Zona Infantil'
                        : 'Mis Favoritos'}
                    </h2>
                    <span className="text-xs text-zinc-400">
                      {activeTab === 'favorites'
                        ? `${favChannels.length} canales / ${favMedia.length} títulos`
                        : `${currentMediaList.length} títulos disponibles`}
                    </span>
                  </div>

                  {/* FAVORITES VIEW HAS BOTH CHANNELS AND MEDIA */}
                  {activeTab === 'favorites' && favChannels.length > 0 && (
                    <div className="space-y-3 mb-6">
                      <h3 className="text-sm font-bold text-zinc-300 uppercase tracking-wider flex items-center gap-2">
                        <Tv className="h-4 w-4 text-rose-500" />
                        <span>Canales Favoritos ({favChannels.length})</span>
                      </h3>
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                        {favChannels.map((channel, idx) => (
                          <Card
                            key={channel.channelCode || idx}
                            className="group border border-zinc-800/80 bg-zinc-900/30 hover:bg-zinc-900 hover:border-zinc-700 transition-all cursor-pointer flex flex-col justify-between overflow-hidden relative"
                            onClick={() => playChannel(channel)}
                          >
                            <button
                              onClick={(e) => toggleFavoriteChannel(e, channel)}
                              className="absolute top-2 right-2 p-1.5 rounded-full z-10 text-pink-500 bg-pink-950/60"
                            >
                              <Heart className="h-3.5 w-3.5 fill-current" />
                            </button>
                            <CardContent className="p-4 flex flex-col items-center justify-center min-h-[130px] text-center">
                              {channel.logo ? (
                                <img src={channel.logo} alt={channel.name} className="h-12 w-auto object-contain mb-2 drop-shadow" />
                              ) : (
                                <div className="h-10 w-10 rounded-lg bg-zinc-800 flex items-center justify-center mb-2">
                                  <Tv className="h-5 w-5 text-zinc-400" />
                                </div>
                              )}
                              <h4 className="text-xs font-semibold text-zinc-200 line-clamp-2 group-hover:text-white">
                                {channel.name}
                              </h4>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Grid de Contenido */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                    {currentMediaList.map((item, idx) => (
                      <Card
                        key={item.id || idx}
                        className="group border border-zinc-800/80 bg-zinc-900/40 hover:border-zinc-700 transition-all duration-300 overflow-hidden cursor-pointer relative"
                        onClick={() => setSelectedMedia(item)}
                      >
                        <button
                          onClick={(e) => toggleFavoriteMedia(e, item)}
                          className={`absolute top-2 right-2 p-1.5 rounded-full z-10 transition-colors ${
                            isMediaFav(item)
                              ? 'text-pink-500 bg-pink-950/70'
                              : 'text-zinc-400 hover:text-white bg-black/60 hover:bg-zinc-800'
                          }`}
                        >
                          <Heart className={`h-3.5 w-3.5 ${isMediaFav(item) ? 'fill-current' : ''}`} />
                        </button>

                        <div className="aspect-[2/3] relative overflow-hidden bg-zinc-900">
                          {item.poster ? (
                            <img
                              src={item.poster}
                              alt={item.title}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-zinc-600">
                              <Film className="h-10 w-10 opacity-30" />
                            </div>
                          )}
                          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-3">
                            <Button size="sm" className="w-full gap-2 rounded-lg text-xs font-semibold bg-white text-black shadow-lg">
                              <Info className="h-3.5 w-3.5" /> Ver Detalle
                            </Button>
                          </div>
                        </div>
                        <CardContent className="p-3">
                          <h4 className="text-xs font-semibold text-zinc-200 line-clamp-1 group-hover:text-white">
                            {item.title}
                          </h4>
                          <div className="flex items-center justify-between text-[11px] text-zinc-500 mt-1">
                            <span>{item.year && item.year !== '—' ? item.year : ''}</span>
                            {item.score && (
                              <span className="flex items-center gap-1 text-amber-400 font-semibold text-[11px]">
                                <Star className="h-2.5 w-2.5 fill-amber-400" />
                                {item.score}
                              </span>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>

                  {currentMediaList.length === 0 && !isLoading && (
                    <div className="py-20 text-center text-zinc-500">
                      <Film className="h-12 w-12 mx-auto mb-3 opacity-40" />
                      <p className="text-sm">No se encontraron títulos disponibles en esta sección.</p>
                    </div>
                  )}
                </div>
              )}

              {/* TAB: CONFIGURACION */}
              {activeTab === 'settings' && (
                <div className="max-w-2xl mx-auto space-y-6">
                  <Card className="border-zinc-800 bg-zinc-900/40">
                    <CardContent className="p-6 space-y-4">
                      <div className="flex items-center gap-3">
                        <Sparkles className="h-5 w-5 text-rose-500" />
                        <div>
                          <h3 className="text-base font-bold text-white">Configuración del Backend API</h3>
                          <p className="text-xs text-zinc-400">
                            Dirección del servicio Node que procesa el protocolo de streaming.
                          </p>
                        </div>
                      </div>

                      <div className="space-y-2 pt-2">
                        <label className="text-xs text-zinc-300 font-medium">URL del Servidor Privado</label>
                        <div className="flex gap-2">
                          <div className="relative flex-1">
                            <Input
                              type={showApiUrl ? 'text' : 'password'}
                              value={apiUrl}
                              onChange={(e) => setApiUrlState(e.target.value)}
                              placeholder="https://..."
                              className="text-xs pr-10 font-mono"
                            />
                            <button
                              type="button"
                              onClick={() => setShowApiUrl(!showApiUrl)}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white"
                            >
                              {showApiUrl ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </button>
                          </div>
                          <Button onClick={handleSaveApiUrl} size="sm" className="cursor-pointer">
                            Guardar
                          </Button>
                        </div>
                      </div>

                      <div className="pt-4 border-t border-zinc-800/80 space-y-2">
                        <h4 className="text-xs font-semibold text-white flex items-center gap-1.5">
                          <Sparkles className="h-3.5 w-3.5 text-rose-500" />
                          <span>¿Desplegaste tu backend en Render?</span>
                        </h4>
                        <p className="text-xs text-zinc-400 leading-relaxed">
                          Cuando crees tu Web Service en Render, copia la URL que te asigne (ej: <span className="text-rose-400 font-mono">https://tu-backend.onrender.com</span>), pégala arriba y dale a <strong>Guardar</strong>.
                        </p>
                      </div>

                      <div className="pt-3 border-t border-zinc-800/80">
                        <h4 className="text-xs font-semibold text-zinc-300 mb-1">Para probar en tu PC localmente:</h4>
                        <p className="text-xs text-zinc-400 leading-relaxed">
                          Abre la terminal en la carpeta principal del proyecto y ejecuta:
                        </p>
                        <pre className="mt-1 p-3 bg-zinc-950 rounded-lg text-emerald-400 font-mono text-xs overflow-x-auto">
                          node server.mjs
                        </pre>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}
            </>
          )}
        </div>

        {/* Mobile Phone Native Bottom Bar */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-zinc-950/95 backdrop-blur-xl border-t border-zinc-800/80 px-2 py-1.5 flex items-center justify-around shadow-2xl">
          <button
            onClick={() => {
              setSelectedMedia(null);
              setSearchQuery('');
              setActiveTab('home');
            }}
            className={`flex flex-col items-center justify-center py-1 px-3 rounded-xl transition-all cursor-pointer ${
              activeTab === 'home' && !isSearchActive
                ? 'text-rose-500 font-bold scale-105'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Home className="h-5 w-5" />
            <span className="text-[10px] mt-0.5">Inicio</span>
          </button>

          <button
            onClick={() => {
              setSelectedMedia(null);
              setSearchQuery('');
              setActiveTab('live');
            }}
            className={`flex flex-col items-center justify-center py-1 px-3 rounded-xl transition-all cursor-pointer relative ${
              activeTab === 'live' && !isSearchActive
                ? 'text-rose-500 font-bold scale-105'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Tv className="h-5 w-5" />
            <span className="text-[10px] mt-0.5">En Vivo</span>
            <span className="absolute top-1 right-2.5 h-1.5 w-1.5 rounded-full bg-rose-500 animate-pulse" />
          </button>

          <button
            onClick={() => {
              setSelectedMedia(null);
              setSearchQuery('');
              setActiveTab('movies');
            }}
            className={`flex flex-col items-center justify-center py-1 px-3 rounded-xl transition-all cursor-pointer ${
              activeTab === 'movies' && !isSearchActive
                ? 'text-rose-500 font-bold scale-105'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Film className="h-5 w-5" />
            <span className="text-[10px] mt-0.5">Películas</span>
          </button>

          <button
            onClick={() => {
              setSelectedMedia(null);
              setSearchQuery('');
              setActiveTab('series');
            }}
            className={`flex flex-col items-center justify-center py-1 px-3 rounded-xl transition-all cursor-pointer ${
              activeTab === 'series' && !isSearchActive
                ? 'text-rose-500 font-bold scale-105'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Clapperboard className="h-5 w-5" />
            <span className="text-[10px] mt-0.5">Series</span>
          </button>

          <button
            onClick={() => {
              setSelectedMedia(null);
              setSearchQuery('');
              setActiveTab('favorites');
            }}
            className={`flex flex-col items-center justify-center py-1 px-3 rounded-xl transition-all cursor-pointer relative ${
              activeTab === 'favorites' && !isSearchActive
                ? 'text-rose-500 font-bold scale-105'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Heart className={`h-5 w-5 ${favChannels.length + favMedia.length > 0 ? 'fill-pink-500/20 text-pink-500' : ''}`} />
            <span className="text-[10px] mt-0.5">Favoritos</span>
            {favChannels.length + favMedia.length > 0 && (
              <span className="absolute top-0 right-1.5 min-w-4 h-4 px-1 rounded-full bg-rose-600 text-white text-[9px] font-bold flex items-center justify-center">
                {favChannels.length + favMedia.length}
              </span>
            )}
          </button>
        </nav>
      </>
    )}
  </main>

      {/* Advanced Floating Active Player */}
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
    </div>
  );
};

export default App;
