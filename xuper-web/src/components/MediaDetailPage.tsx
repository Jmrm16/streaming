import React, { useEffect, useState } from 'react';
import {
  X,
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
} from 'lucide-react';
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
  onBack: () => void;
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
  onBack,
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

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onBack();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onBack]);

  // Prevent background scrolling while modal is open
  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, []);

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

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/80 flex items-start justify-center p-0 sm:py-8 sm:px-4 backdrop-blur-xs animate-in fade-in duration-200"
      onClick={onBack}
    >
      <div
        className="title-dialog relative w-full max-w-4xl bg-[#181818] rounded-none sm:rounded-xl overflow-hidden shadow-2xl text-white my-auto sm:my-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button Top Right */}
        <button
          type="button"
          className="detail-close cursor-pointer"
          aria-label="Cerrar información"
          onClick={onBack}
        >
          <X className="w-5 h-5 text-white" />
        </button>

        {/* Hero Section */}
        <div className="detail-hero relative aspect-video sm:aspect-[16/9] w-full bg-[#242424] overflow-hidden">
          <img
            src={artworkUrl}
            alt={currentItem.title}
            className="w-full h-full object-cover select-none"
            onError={(e) => {
              (e.target as HTMLImageElement).src =
                'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="600" height="338"%3E%3Crect width="100%25" height="100%25" fill="%23242424"/%3E%3Ctext x="50%25" y="50%25" text-anchor="middle" dominant-baseline="middle" fill="%23e50914" font-family="Arial" font-size="36" font-weight="bold"%3ENETFLIX%3C/text%3E%3C/svg%3E';
            }}
          />
          <div className="detail-overlay" />

          {/* Title & Play/Add Buttons positioned over hero */}
          <div className="absolute left-6 sm:left-10 bottom-6 sm:bottom-10 right-6 sm:right-10 z-10 space-y-3 sm:space-y-4">
            <p className="netflix-series-label flex items-center gap-2">
              <span className="text-red-600 font-black text-2xl">N</span>
              <span className="tracking-[3px] text-xs font-bold text-zinc-300">
                {isSeries ? 'S E R I E' : 'P E L Í C U L A'}
              </span>
            </p>

            <h1 className="text-2xl sm:text-4xl md:text-5xl font-black text-white tracking-tight drop-shadow-md">
              {currentItem.title}
            </h1>

            <div className="detail-actions flex items-center gap-3 pt-1">
              {isSeries ? (
                <button
                  type="button"
                  disabled={isResolving || initialLoading || seasonEpisodes.length === 0}
                  onClick={() => seasonEpisodes[0] && handlePlayEpisode(seasonEpisodes[0])}
                  className="detail-primary cursor-pointer disabled:opacity-50"
                >
                  {isResolving && !resolvingEpId ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span>Cargando...</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-5 h-5 fill-current" />
                      <span>Reproducir</span>
                    </>
                  )}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={isResolving || initialLoading}
                  onClick={handlePlayMovie}
                  className="detail-primary cursor-pointer disabled:opacity-50"
                >
                  {isResolving ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span>Cargando...</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-5 h-5 fill-current" />
                      <span>Reproducir</span>
                    </>
                  )}
                </button>
              )}

              {onToggleFavorite && (
                <button
                  type="button"
                  className={`detail-list cursor-pointer ${isFavorite ? 'is-saved' : ''}`}
                  onClick={() => onToggleFavorite(media)}
                  title={isFavorite ? 'En Mi lista' : 'Añadir a Mi lista'}
                >
                  {isFavorite ? (
                    <Check className="w-5 h-5 text-emerald-400" />
                  ) : (
                    <Plus className="w-5 h-5 text-white" />
                  )}
                  <span className="text-xs font-semibold">
                    {isFavorite ? 'En Mi lista' : 'Mi lista'}
                  </span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Modal Body */}
        <div className="detail-body px-6 sm:px-10 pb-10 pt-4 space-y-6">
          {/* Metadata Bar */}
          <div className="detail-metadata flex flex-wrap items-center gap-3 text-sm text-zinc-300">
            <span className="match-score text-emerald-400 font-bold">
              {currentItem.score ? `${currentItem.score} ★ Calificación` : '98% para ti'}
            </span>
            {currentItem.year && currentItem.year !== '—' && (
              <span className="text-zinc-300 font-medium">{currentItem.year}</span>
            )}
            <span className="maturity-badge">+16</span>
            {currentItem.duration && <span>{currentItem.duration}</span>}
            <span className="border border-zinc-600 px-1 py-0.5 text-[10px] font-mono rounded text-zinc-300">
              4K Ultra HD
            </span>
            <span className="border border-zinc-600 px-1 py-0.5 text-[10px] font-mono rounded text-zinc-300">
              5.1 Estéreo
            </span>
          </div>

          {/* Synopsis & Cast Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-2 space-y-4">
              <p className="detail-description text-base text-zinc-200 leading-relaxed">
                {currentItem.synopsis ||
                  'No hay sinopsis disponible actualmente para este título.'}
              </p>
            </div>

            <div className="space-y-2.5 text-xs text-zinc-400">
              {currentItem.director && (
                <p>
                  <strong className="text-zinc-200 font-semibold">Dirección:</strong>{' '}
                  {currentItem.director}
                </p>
              )}
              {currentItem.actors && (
                <p>
                  <strong className="text-zinc-200 font-semibold">Elenco:</strong>{' '}
                  {currentItem.actors}
                </p>
              )}
              {currentItem.genres && currentItem.genres.length > 0 && (
                <p className="detail-genres">
                  <strong className="text-zinc-200 font-semibold">Géneros:</strong>{' '}
                  <span className="text-zinc-300">{currentItem.genres.join(', ')}</span>
                </p>
              )}
            </div>
          </div>

          {/* Series Episodes Section */}
          {isSeries && (
            <section className="zentix-episodes pt-4 border-t border-zinc-800 space-y-4">
              <div className="zentix-episodes-heading flex items-center justify-between gap-4">
                <h3 className="text-xl font-bold text-white">Episodios</h3>

                {seasons.length > 1 && (
                  <div className="relative">
                    <select
                      value={selectedSeasonId}
                      onChange={(e) => handleSeasonSelect(e.target.value)}
                      disabled={seasonLoading}
                      className="bg-[#242424] text-white text-xs font-semibold border border-zinc-700 rounded-md px-3 py-2 pr-8 cursor-pointer focus:outline-none focus:border-white"
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

              {seasonLoading || initialLoading ? (
                <div className="py-12 flex flex-col items-center justify-center text-zinc-400 space-y-2">
                  <Loader2 className="w-8 h-8 text-red-600 animate-spin" />
                  <span className="text-xs">Cargando episodios de la temporada...</span>
                </div>
              ) : seasonEpisodes.length === 0 ? (
                <p className="text-sm text-zinc-400 py-6 text-center">
                  No hay episodios disponibles para esta temporada.
                </p>
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                  {seasonEpisodes.map((ep, idx) => {
                    const isResolvingThis = isResolving && resolvingEpId === ep.id;
                    return (
                      <button
                        type="button"
                        key={ep.id || idx}
                        disabled={isResolving}
                        onClick={() => handlePlayEpisode(ep)}
                        className="zentix-episode flex items-center gap-4 w-full p-3 sm:p-4 rounded-lg bg-zinc-900/40 hover:bg-zinc-800/80 border border-zinc-800/50 transition-colors text-left group cursor-pointer"
                      >
                        <span className="zentix-episode-number text-lg font-bold text-zinc-400 group-hover:text-white w-6 text-center">
                          {ep.number || idx + 1}
                        </span>

                        <div className="relative w-24 sm:w-32 aspect-video rounded overflow-hidden bg-zinc-800 shrink-0">
                          {ep.picture ? (
                            <img
                              src={ep.picture}
                              alt=""
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <img
                              src={artworkUrl}
                              alt=""
                              className="w-full h-full object-cover opacity-70"
                            />
                          )}
                          <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                            {isResolvingThis ? (
                              <Loader2 className="w-6 h-6 text-white animate-spin" />
                            ) : (
                              <Play className="w-6 h-6 text-white fill-current" />
                            )}
                          </div>
                        </div>

                        <div className="flex-1 min-w-0 space-y-1">
                          <p className="zentix-episode-title text-sm font-semibold text-zinc-100 group-hover:text-white truncate">
                            {cleanEpisodeTitle(ep.name || ep.title || `Episodio ${ep.number}`)}
                          </p>
                          {ep.description && (
                            <p className="text-xs text-zinc-400 line-clamp-2">
                              {ep.description}
                            </p>
                          )}
                        </div>

                        {ep.duration && (
                          <span className="text-xs text-zinc-400 shrink-0 font-medium">
                            {ep.duration}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
};

export default MediaDetailPage;
