import React, { useEffect, useState, useMemo } from 'react';
import {
  ArrowLeft,
  Play,
  Star,
  Calendar,
  Clock,
  Loader2,
  Heart,
  Plus,
  Check,
  ChevronDown,
  Film,
  Sparkles,
  Info,
  Tv,
  Share2,
} from 'lucide-react';
import { MaicaoflixLogo } from './MaicaoflixLogo';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import {
  api,
  MediaItem,
  MediaDetailResponse,
  Episode,
  Season,
  SubtitleTrack,
  AudioLanguage,
} from '../services/api';

interface MediaDetailPageProps {
  media: MediaItem;
  relatedItems?: MediaItem[];
  onBack: () => void;
  onSelectMedia?: (item: MediaItem) => void;
  onPlayEpisode: (
    url: string,
    title: string,
    subtitle?: string,
    subtitles?: SubtitleTrack[],
    audioLanguages?: AudioLanguage[],
    contentId?: string,
    seriesId?: string
  ) => void;
  onPlayMovie: (
    url: string,
    title: string,
    subtitle?: string,
    subtitles?: SubtitleTrack[],
    audioLanguages?: AudioLanguage[],
    contentId?: string
  ) => void;
  isFavorite?: boolean;
  onToggleFavorite?: (item: MediaItem) => void;
}

export const MediaDetailPage: React.FC<MediaDetailPageProps> = ({
  media,
  relatedItems = [],
  onBack,
  onSelectMedia,
  onPlayEpisode,
  onPlayMovie,
  isFavorite = false,
  onToggleFavorite,
}) => {
  const [initialLoading, setInitialLoading] = useState(true);
  const [seasonLoading, setSeasonLoading] = useState(false);
  const [detail, setDetail] = useState<MediaDetailResponse | null>(null);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [selectedSeasonNumber, setSelectedSeasonNumber] = useState<number>(1);
  const [selectedSeasonId, setSelectedSeasonId] = useState<string>(media.id);
  const [seasonEpisodes, setSeasonEpisodes] = useState<Episode[]>([]);
  const [seasonCache, setSeasonCache] = useState<
    Record<string, { item: MediaItem; episodes: Episode[] }>
  >({});
  const [isResolving, setIsResolving] = useState(false);
  const [resolvingEpId, setResolvingEpId] = useState<string | null>(null);

  // Scroll to top on page load
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [media.id]);

  // Support Escape key to go back
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onBack();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onBack]);

  // Fetch initial detail
  useEffect(() => {
    let isMounted = true;
    const fetchDetail = async () => {
      setInitialLoading(true);
      try {
        const res = await api.getDetail(media.id);
        if (!isMounted) return;

        if (res) {
          setDetail(res);

          let rawSeasons = (res.seasons || []).slice();
          rawSeasons.sort((a, b) => a.number - b.number);

          const isSeriesType =
            res.item?.type === 'teleplay' ||
            res.item?.type === 'series' ||
            res.item?.category === 'serie' ||
            (res.episodes && res.episodes.length > 0);

          if (rawSeasons.length === 0 && isSeriesType) {
            rawSeasons = [{ id: media.id, number: 1, name: 'Temporada 1' }];
          }

          setSeasons(rawSeasons);

          let activeSeason = rawSeasons.find((s) => s.id === media.id);
          if (!activeSeason && rawSeasons.length > 0) {
            const match = media.title.match(/T(\d+)/i);
            if (match) {
              const num = parseInt(match[1], 10);
              activeSeason = rawSeasons.find((s) => s.number === num);
            }
          }
          if (!activeSeason && rawSeasons.length > 0) {
            activeSeason = rawSeasons[0];
          }

          const targetSeasonId = activeSeason?.id || media.id;
          const targetSeasonNumber = activeSeason?.number || 1;

          setSelectedSeasonId(targetSeasonId);
          setSelectedSeasonNumber(targetSeasonNumber);

          const initialEps = res.episodes || [];
          setSeasonEpisodes(initialEps);
          setSeasonCache((prev) => ({
            ...prev,
            [targetSeasonId]: { item: res.item, episodes: initialEps },
          }));
        }
      } catch (err) {
        console.error('Error fetching detail:', err);
      } finally {
        if (isMounted) setInitialLoading(false);
      }
    };

    fetchDetail();
    return () => {
      isMounted = false;
    };
  }, [media.id]);

  // Handle season switch
  const handleSeasonSelect = async (seasonId: string) => {
    setSelectedSeasonId(seasonId);
    const chosenSeason = seasons.find((s) => s.id === seasonId);
    if (chosenSeason) {
      setSelectedSeasonNumber(chosenSeason.number);
    }

    if (seasonCache[seasonId]) {
      setSeasonEpisodes(seasonCache[seasonId].episodes);
      return;
    }

    setSeasonLoading(true);
    try {
      const res = await api.getDetail(seasonId);
      if (res && res.episodes) {
        setSeasonEpisodes(res.episodes);
        setSeasonCache((prev) => ({
          ...prev,
          [seasonId]: { item: res.item, episodes: res.episodes },
        }));
      }
    } catch (err) {
      console.error('Error fetching season detail:', err);
    } finally {
      setSeasonLoading(false);
    }
  };

  // Play a movie
  const handlePlayMovie = async () => {
    setIsResolving(true);
    try {
      const targetId = detail?.item?.id || media.id;
      const res = await api.resolveVod(targetId);
      if (res && res.url) {
        onPlayMovie(
          res.url,
          detail?.item?.title || media.title,
          detail?.item?.year ? `Película • ${detail.item.year}` : 'Película',
          res.subtitles,
          res.audioLanguages,
          targetId
        );
      } else {
        alert('No se pudo obtener el enlace de reproducción.');
      }
    } catch (err) {
      console.error('Error resolving movie:', err);
      alert('Error de conexión al obtener el streaming.');
    } finally {
      setIsResolving(false);
    }
  };

  // Play an episode
  const handlePlayEpisode = async (ep: Episode) => {
    setIsResolving(true);
    setResolvingEpId(ep.id);
    try {
      const parentId = selectedSeasonId || media.id;
      const res = await api.resolveVod(parentId, ep.id);
      if (res && res.url) {
        const epLabel = `T${selectedSeasonNumber} : E${ep.number} — ${ep.name || ep.title}`;
        onPlayEpisode(
          res.url,
          detail?.item?.title || media.title,
          epLabel,
          res.subtitles,
          res.audioLanguages,
          ep.id,
          parentId
        );
      } else {
        alert('No se pudo reproducir este episodio.');
      }
    } catch (err) {
      console.error('Error resolving episode:', err);
      alert('Error al conectar con la transmisión del episodio.');
    } finally {
      setIsResolving(false);
      setResolvingEpId(null);
    }
  };

  const cleanEpisodeTitle = (raw: string): string => {
    if (!raw) return '';
    return (
      raw
        .replace(/^.*?T\d+[-_ ]*E?\d*[:\-_ ]*/i, '')
        .replace(/^Capítulo\s*\d+[:\-_ ]*/i, '')
        .trim() || raw
    );
  };

  const currentItem = seasonCache[selectedSeasonId]?.item || detail?.item || media;
  const isSeries =
    currentItem.type === 'teleplay' ||
    currentItem.type === 'series' ||
    currentItem.category === 'serie' ||
    seasons.length > 0 ||
    seasonEpisodes.length > 0;

  const artworkUrl = currentItem.backdrop || currentItem.landscape || currentItem.poster;

  // Filter similar titles (excluding current)
  const similarTitles = useMemo(() => {
    return relatedItems.filter((item) => item.id !== media.id).slice(0, 12);
  }, [relatedItems, media.id]);

  return (
    <div className="min-h-screen bg-[#141414] text-white animate-in fade-in duration-300">
      {/* ============================================================ */}
      {/* 1. TOP DEDICATED NAVIGATION BAR                              */}
      {/* ============================================================ */}
      <nav className="sticky top-0 z-40 h-16 bg-[#141414]/95 backdrop-blur-md border-b border-zinc-800/80 px-4 sm:px-8 flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-zinc-900/90 hover:bg-zinc-800 text-zinc-300 hover:text-white border border-zinc-700/60 transition-colors text-xs font-semibold cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4 text-red-500" />
            <span>Volver al catálogo</span>
          </button>

          <div className="hidden sm:block">
            <MaicaoflixLogo width={120} height={26} />
          </div>
        </div>

        <div className="flex items-center gap-3">
          {onToggleFavorite && (
            <button
              type="button"
              onClick={() => onToggleFavorite(media)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs font-semibold transition-colors cursor-pointer ${
                isFavorite
                  ? 'border-pink-800/60 bg-pink-950/40 text-pink-400'
                  : 'border-zinc-700 bg-zinc-900/80 text-zinc-300 hover:text-white hover:bg-zinc-800'
              }`}
            >
              {isFavorite ? (
                <>
                  <Check className="w-3.5 h-3.5 text-pink-500" />
                  <span>En Mi lista</span>
                </>
              ) : (
                <>
                  <Plus className="w-3.5 h-3.5" />
                  <span>Añadir a Mi lista</span>
                </>
              )}
            </button>
          )}
        </div>
      </nav>

      {/* ============================================================ */}
      {/* 2. FULL-BLEED CINEMATIC BACKDROP HERO SECTION                */}
      {/* ============================================================ */}
      <section className="relative w-full min-h-[460px] md:min-h-[580px] lg:min-h-[640px] flex items-end overflow-hidden">
        {/* Backdrop Image */}
        <img
          src={artworkUrl}
          alt={currentItem.title}
          className="absolute inset-0 w-full h-full object-cover object-top select-none"
          onError={(e) => {
            (e.target as HTMLImageElement).src =
              'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="600" height="338"%3E%3Crect width="100%25" height="100%25" fill="%23242424"/%3E%3Ctext x="50%25" y="50%25" text-anchor="middle" dominant-baseline="middle" fill="%23e50914" font-family="Arial" font-size="34" font-weight="bold"%3EMAICAOFLIX%3C/text%3E%3C/svg%3E';
          }}
        />

        {/* Gradient Overlays */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#141414] via-[#141414]/75 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#141414]/95 via-[#141414]/50 to-transparent" />

        {/* Hero Info Overlay */}
        <div className="relative z-10 w-full max-w-7xl mx-auto px-4 sm:px-8 py-12 space-y-4">
          <p className="netflix-series-label flex items-center gap-2">
            <span className="text-red-600 font-black text-2xl">M</span>
            <span className="tracking-[4px] text-xs font-bold text-zinc-300">
              {isSeries ? 'S E R I E' : 'P E L Í C U L A'}
            </span>
          </p>

          <h1 className="text-3xl sm:text-5xl md:text-6xl font-black text-white tracking-tight leading-tight max-w-4xl drop-shadow-xl">
            {currentItem.title}
          </h1>

          {/* Badges line */}
          <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-300 pt-1">
            <span className="match-score text-emerald-400 font-bold">
              {currentItem.score ? `${currentItem.score} ★ Calificación` : '98% para ti'}
            </span>
            {currentItem.year && currentItem.year !== '—' && (
              <span className="text-zinc-200 font-semibold">{currentItem.year}</span>
            )}
            <span className="maturity-badge border border-zinc-600 px-1.5 py-0.5 text-xs text-zinc-300 rounded">
              +16
            </span>
            {currentItem.duration && <span>{currentItem.duration}</span>}
            <span className="border border-zinc-700 px-1.5 py-0.5 rounded text-[11px] font-mono text-zinc-300">
              4K Ultra HD
            </span>
            <span className="border border-zinc-700 px-1.5 py-0.5 rounded text-[11px] font-mono text-zinc-300">
              5.1 Estéreo
            </span>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-4 pt-3">
            {isSeries ? (
              <button
                type="button"
                disabled={isResolving || initialLoading || seasonEpisodes.length === 0}
                onClick={() => seasonEpisodes[0] && handlePlayEpisode(seasonEpisodes[0])}
                className="featured-play cursor-pointer inline-flex items-center justify-center gap-2.5 px-8 py-3 rounded-md bg-white text-black font-bold text-lg hover:bg-white/85 transition-colors shadow-2xl disabled:opacity-50"
              >
                {isResolving && !resolvingEpId ? (
                  <>
                    <Loader2 className="w-6 h-6 animate-spin text-black" />
                    <span>Cargando...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-6 h-6 fill-current" />
                    <span>Reproducir</span>
                  </>
                )}
              </button>
            ) : (
              <button
                type="button"
                disabled={isResolving || initialLoading}
                onClick={handlePlayMovie}
                className="featured-play cursor-pointer inline-flex items-center justify-center gap-2.5 px-8 py-3 rounded-md bg-white text-black font-bold text-lg hover:bg-white/85 transition-colors shadow-2xl disabled:opacity-50"
              >
                {isResolving ? (
                  <>
                    <Loader2 className="w-6 h-6 animate-spin text-black" />
                    <span>Cargando...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-6 h-6 fill-current" />
                    <span>Reproducir</span>
                  </>
                )}
              </button>
            )}

            {onToggleFavorite && (
              <button
                type="button"
                className={`featured-info cursor-pointer inline-flex items-center justify-center gap-2 px-6 py-3 rounded-md border text-base font-bold transition-colors backdrop-blur-md ${
                  isFavorite
                    ? 'border-pink-800/80 bg-pink-950/60 text-pink-300 hover:bg-pink-900/60'
                    : 'border-zinc-600 bg-zinc-800/70 text-white hover:bg-zinc-700/80'
                }`}
                onClick={() => onToggleFavorite(media)}
              >
                {isFavorite ? (
                  <>
                    <Check className="w-5 h-5 text-pink-400" />
                    <span>En Mi lista</span>
                  </>
                ) : (
                  <>
                    <Plus className="w-5 h-5 text-white" />
                    <span>Mi lista</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </section>

      {/* ============================================================ */}
      {/* 3. DEDICATED BODY CONTENT (SYNOPSIS, SEASONS, EPISODES)      */}
      {/* ============================================================ */}
      <div className="w-full max-w-7xl mx-auto px-4 sm:px-8 py-8 space-y-12">
        {/* Main Grid: Synopsis (left) + Metadata & Cast (right) */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-4">
            <h2 className="text-xl font-bold text-white">Sinopsis</h2>
            <p className="text-base sm:text-lg text-zinc-300 leading-relaxed">
              {currentItem.synopsis ||
                'No hay sinopsis disponible actualmente para este título.'}
            </p>
          </div>

          {/* Credits & Metadata Card */}
          <div className="p-6 rounded-xl bg-zinc-900/60 border border-zinc-800 space-y-3.5 text-xs text-zinc-400">
            {currentItem.director && (
              <div>
                <span className="text-zinc-500 font-semibold uppercase tracking-wider block text-[10px]">
                  DIRECCIÓN
                </span>
                <span className="text-sm font-medium text-zinc-200">
                  {currentItem.director}
                </span>
              </div>
            )}

            {currentItem.actors && (
              <div>
                <span className="text-zinc-500 font-semibold uppercase tracking-wider block text-[10px]">
                  ELENCO PRINCIPAL
                </span>
                <span className="text-sm font-medium text-zinc-200">
                  {currentItem.actors}
                </span>
              </div>
            )}

            {currentItem.genres && currentItem.genres.length > 0 && (
              <div>
                <span className="text-zinc-500 font-semibold uppercase tracking-wider block text-[10px]">
                  GÉNEROS
                </span>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {currentItem.genres.map((g, idx) => (
                    <Badge
                      key={idx}
                      variant="outline"
                      className="border-zinc-700 bg-zinc-800/80 text-zinc-300 text-xs"
                    >
                      {g}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            <div>
              <span className="text-zinc-500 font-semibold uppercase tracking-wider block text-[10px]">
                CALIDAD DE STREAMING
              </span>
              <span className="text-xs font-semibold text-emerald-400">
                Ultra HD 1080p • Dolby Digital Audio
              </span>
            </div>
          </div>
        </div>

        {/* Series Episodes Section */}
        {isSeries && (
          <section className="space-y-6 pt-6 border-t border-zinc-800">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                  <span>Episodios</span>
                  <span className="text-xs font-normal text-zinc-400">
                    ({seasonEpisodes.length} disponibles)
                  </span>
                </h2>
                <p className="text-xs text-zinc-400 mt-1">
                  Selecciona cualquier capítulo para iniciar la reproducción inmediatamente.
                </p>
              </div>

              {/* Season Selector */}
              {seasons.length > 1 && (
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-zinc-400">Temporada:</span>
                  <select
                    value={selectedSeasonId}
                    onChange={(e) => handleSeasonSelect(e.target.value)}
                    disabled={seasonLoading}
                    className="bg-zinc-900 text-white text-sm font-bold border border-zinc-700 rounded-lg px-4 py-2 cursor-pointer focus:outline-none focus:border-red-500"
                  >
                    {seasons.map((s) => (
                      <option key={s.id || s.number} value={s.id || String(s.number)}>
                        {s.name || `Temporada ${s.number}`}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Episodes List */}
            {seasonLoading || initialLoading ? (
              <div className="py-16 flex flex-col items-center justify-center text-zinc-400 space-y-3">
                <Loader2 className="w-8 h-8 text-red-600 animate-spin" />
                <span className="text-sm">Cargando episodios de la temporada...</span>
              </div>
            ) : seasonEpisodes.length === 0 ? (
              <p className="text-sm text-zinc-400 py-8 text-center bg-zinc-900/40 rounded-xl">
                No hay episodios registrados para esta temporada.
              </p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {seasonEpisodes.map((ep, idx) => {
                  const isResolvingThis = isResolving && resolvingEpId === ep.id;
                  return (
                    <div
                      key={ep.id || idx}
                      onClick={() => !isResolving && handlePlayEpisode(ep)}
                      className="group flex gap-4 p-3.5 rounded-xl bg-zinc-900/40 hover:bg-zinc-800/80 border border-zinc-800/60 hover:border-zinc-700 transition-all cursor-pointer"
                    >
                      {/* Thumbnail with hover play overlay */}
                      <div className="relative w-36 sm:w-44 aspect-video rounded-lg overflow-hidden bg-zinc-800 shrink-0">
                        <img
                          src={ep.picture || artworkUrl}
                          alt=""
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          loading="lazy"
                        />
                        <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          {isResolvingThis ? (
                            <Loader2 className="w-8 h-8 text-white animate-spin" />
                          ) : (
                            <div className="w-10 h-10 rounded-full bg-white/90 text-black flex items-center justify-center shadow-lg">
                              <Play className="w-5 h-5 fill-current ml-0.5" />
                            </div>
                          )}
                        </div>
                        <span className="absolute bottom-1.5 left-1.5 text-[10px] font-bold bg-black/80 px-1.5 py-0.5 rounded text-zinc-300">
                          E{ep.number || idx + 1}
                        </span>
                      </div>

                      {/* Episode Details */}
                      <div className="flex-1 min-w-0 flex flex-col justify-center space-y-1">
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="text-sm font-bold text-zinc-100 group-hover:text-white line-clamp-1">
                            {cleanEpisodeTitle(ep.name || ep.title || `Episodio ${ep.number}`)}
                          </h4>
                          {ep.duration && (
                            <span className="text-[11px] text-zinc-400 font-mono shrink-0">
                              {ep.duration}
                            </span>
                          )}
                        </div>
                        {ep.description ? (
                          <p className="text-xs text-zinc-400 line-clamp-2 leading-relaxed">
                            {ep.description}
                          </p>
                        ) : (
                          <p className="text-xs text-zinc-500 italic">
                            Ver episodio completo en HD
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* ============================================================ */}
        {/* 4. MÁS TÍTULOS SIMILARES (RELATED RECOMMENDATIONS)           */}
        {/* ============================================================ */}
        {similarTitles.length > 0 && (
          <section className="space-y-4 pt-8 border-t border-zinc-800">
            <h2 className="text-xl font-bold text-white">Más títulos similares</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {similarTitles.map((item, idx) => (
                <div
                  key={item.id || idx}
                  className="media-card group cursor-pointer"
                  onClick={() => onSelectMedia && onSelectMedia(item)}
                >
                  <div className="media-card-art relative">
                    <img
                      src={item.backdrop || item.landscape || item.poster}
                      alt={item.title}
                      className="w-full h-full object-cover transition-transform group-hover:brightness-105"
                      loading="lazy"
                    />
                    <span className="card-netflix">M</span>
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
          </section>
        )}
      </div>
    </div>
  );
};

export default MediaDetailPage;
