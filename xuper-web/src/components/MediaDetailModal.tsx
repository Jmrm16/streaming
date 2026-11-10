import React, { useEffect, useState } from 'react';
import {
  X,
  Play,
  Star,
  Calendar,
  Clock,
  Tv,
  Loader2,
  Layers,
  Sparkles,
  Info,
} from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { api, MediaItem, MediaDetailResponse, Episode, Season } from '../services/api';

interface MediaDetailModalProps {
  media: MediaItem;
  onClose: () => void;
  onPlayEpisode: (url: string, title: string, subtitle?: string) => void;
  onPlayMovie: (url: string, title: string, subtitle?: string) => void;
}

export const MediaDetailModal: React.FC<MediaDetailModalProps> = ({
  media,
  onClose,
  onPlayEpisode,
  onPlayMovie,
}) => {
  const [initialLoading, setInitialLoading] = useState(true);
  const [seasonLoading, setSeasonLoading] = useState(false);
  const [detail, setDetail] = useState<MediaDetailResponse | null>(null);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [selectedSeasonNumber, setSelectedSeasonNumber] = useState<number>(1);
  const [selectedSeasonId, setSelectedSeasonId] = useState<string>(media.id);
  const [seasonEpisodes, setSeasonEpisodes] = useState<Episode[]>([]);
  const [seasonCache, setSeasonCache] = useState<Record<string, { item: MediaItem; episodes: Episode[] }>>({});
  const [isResolving, setIsResolving] = useState(false);
  const [resolvingEpId, setResolvingEpId] = useState<string | null>(null);

  // Initial load: fetch series/movie details
  useEffect(() => {
    let isMounted = true;
    const fetchDetail = async () => {
      setInitialLoading(true);
      try {
        const res = await api.getDetail(media.id);
        if (!isMounted) return;

        if (res) {
          setDetail(res);
          const rawSeasons = res.seasons || [];
          setSeasons(rawSeasons);

          // Initial season
          const firstSeason = rawSeasons.length > 0 ? rawSeasons[0] : null;
          const firstSeasonId = firstSeason?.id || media.id;
          const firstSeasonNumber = firstSeason?.number || 1;

          setSelectedSeasonNumber(firstSeasonNumber);
          setSelectedSeasonId(firstSeasonId);

          const initialEps = res.episodes || [];
          setSeasonEpisodes(initialEps);

          // Cache initial season detail
          setSeasonCache({
            [firstSeasonId]: {
              item: res.item,
              episodes: initialEps,
            },
          });
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
  const handleSelectSeason = async (season: Season) => {
    const sId = season.id || media.id;
    if (sId === selectedSeasonId && seasonEpisodes.length > 0) return;

    setSelectedSeasonNumber(season.number);
    setSelectedSeasonId(sId);

    // If cached, display immediately
    if (seasonCache[sId]) {
      setSeasonEpisodes(seasonCache[sId].episodes);
      return;
    }

    // Otherwise fetch from API
    setSeasonLoading(true);
    try {
      const res = await api.getDetail(sId);
      if (res) {
        const newEps = res.episodes || [];
        setSeasonEpisodes(newEps);
        setSeasonCache((prev) => ({
          ...prev,
          [sId]: {
            item: res.item,
            episodes: newEps,
          },
        }));
      }
    } catch (err) {
      console.error('Error fetching season detail:', err);
    } finally {
      setSeasonLoading(false);
    }
  };

  const handlePlayMovie = async () => {
    setIsResolving(true);
    try {
      const res = await api.resolveMedia(media.id);
      if (res.url) {
        onPlayMovie(res.url, media.title, media.year || 'Película');
      } else {
        alert('No se pudo obtener el enlace de reproducción.');
      }
    } catch {
      alert('Error al resolver la película.');
    } finally {
      setIsResolving(false);
    }
  };

  const handlePlayEpisodeClick = async (ep: Episode) => {
    setIsResolving(true);
    setResolvingEpId(ep.id);
    try {
      const res = await api.resolveMedia(ep.id, selectedSeasonId);
      if (res.url) {
        const cleanEpTitle = cleanEpisodeTitle(ep.name || ep.title || `Capítulo ${ep.number}`);
        onPlayEpisode(
          res.url,
          media.title,
          `Temporada ${selectedSeasonNumber} • Episodio ${ep.number} - ${cleanEpTitle}`
        );
      } else {
        alert('No se pudo obtener el enlace del episodio.');
      }
    } catch {
      alert('Error al resolver el episodio.');
    } finally {
      setIsResolving(false);
      setResolvingEpId(null);
    }
  };

  // Clean redundant title patterns like "Serie T1 T1_Serie-01" -> "Episodio 1" or real title
  const cleanEpisodeTitle = (raw: string): string => {
    if (!raw) return '';
    return raw
      .replace(/^.*?T\d+[-_ ]*E?\d*[:\-_ ]*/i, '')
      .replace(/^Capítulo\s*\d+[:\-_ ]*/i, '')
      .trim() || raw;
  };

  const currentItem = seasonCache[selectedSeasonId]?.item || detail?.item || media;
  const isSeries =
    currentItem.type === 'teleplay' ||
    currentItem.type === 'series' ||
    currentItem.category === 'serie' ||
    seasons.length > 0 ||
    seasonEpisodes.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 md:p-8 bg-black/85 backdrop-blur-md overflow-y-auto animate-in fade-in duration-200">
      <div className="relative w-full max-w-4xl bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden my-auto max-h-[92vh] flex flex-col">
        {/* Close Button */}
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="absolute top-4 right-4 z-30 rounded-full bg-black/60 hover:bg-zinc-800 text-zinc-300 hover:text-white border border-white/10 backdrop-blur-sm cursor-pointer"
        >
          <X className="h-5 w-5" />
        </Button>

        {/* Hero Backdrop Header */}
        <div className="relative h-60 sm:h-72 w-full overflow-hidden shrink-0 bg-zinc-900">
          <img
            src={currentItem.backdrop || currentItem.landscape || currentItem.poster}
            alt={currentItem.title}
            className="w-full h-full object-cover opacity-60"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/70 to-transparent" />

          {/* Info Overlay */}
          <div className="absolute bottom-5 left-5 right-5 sm:left-6 sm:right-6 flex items-end gap-5">
            <img
              src={currentItem.poster}
              alt={currentItem.title}
              className="hidden sm:block w-28 h-40 md:w-32 md:h-48 object-cover rounded-xl shadow-2xl border border-zinc-800 shrink-0"
            />
            <div className="space-y-2 flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant={isSeries ? 'secondary' : 'default'}
                  className={`uppercase font-bold tracking-wider text-[10px] ${
                    isSeries
                      ? 'bg-rose-950/60 text-rose-400 border border-rose-800/60'
                      : 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/60'
                  }`}
                >
                  {isSeries ? 'Serie' : 'Película'}
                </Badge>

                {currentItem.score && currentItem.score !== '—' && (
                  <Badge variant="outline" className="gap-1 border-amber-500/40 text-amber-400 bg-amber-950/30">
                    <Star className="h-3 w-3 fill-amber-400" />
                    <span>{currentItem.score}</span>
                  </Badge>
                )}

                {currentItem.year && currentItem.year !== '—' && (
                  <span className="text-xs text-zinc-400 flex items-center gap-1">
                    <Calendar className="h-3 w-3" /> {currentItem.year}
                  </span>
                )}

                {currentItem.duration && (
                  <span className="text-xs text-zinc-400 flex items-center gap-1">
                    <Clock className="h-3 w-3" /> {currentItem.duration}
                  </span>
                )}

                {isSeries && seasons.length > 0 && (
                  <Badge variant="outline" className="border-zinc-700 text-zinc-300 text-[10px]">
                    {seasons.length} {seasons.length === 1 ? 'Temporada' : 'Temporadas'}
                  </Badge>
                )}
              </div>

              <h1 className="text-xl sm:text-2xl md:text-3xl font-black text-white tracking-tight leading-tight line-clamp-2">
                {currentItem.title}
              </h1>

              {/* Genres */}
              {currentItem.genres && currentItem.genres.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {currentItem.genres.map((g, idx) => (
                    <Badge key={idx} variant="outline" className="text-[10px] py-0 border-zinc-800 text-zinc-400">
                      {g}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Scrollable Content Body */}
        <div className="p-5 sm:p-6 space-y-6 overflow-y-auto flex-1">
          {/* Action Button for Movies */}
          {!isSeries && (
            <div className="flex items-center gap-4">
              <Button
                size="lg"
                onClick={handlePlayMovie}
                disabled={isResolving}
                className="gap-2.5 rounded-xl font-bold bg-white text-zinc-950 hover:bg-zinc-200 px-8 shadow-lg shadow-white/10 cursor-pointer"
              >
                {isResolving ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Play className="h-5 w-5 fill-current" />
                )}
                <span>Reproducir Película</span>
              </Button>
            </div>
          )}

          {/* Synopsis */}
          {currentItem.synopsis && (
            <div className="space-y-1.5">
              <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                <Info className="h-3.5 w-3.5 text-zinc-500" />
                <span>Sinopsis</span>
              </h3>
              <p className="text-sm text-zinc-300 leading-relaxed font-normal">
                {currentItem.synopsis}
              </p>
            </div>
          )}

          {/* Cast & Director */}
          {(currentItem.director || currentItem.actors) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-zinc-900 text-xs">
              {currentItem.director && (
                <div>
                  <span className="text-zinc-500 font-medium">Director: </span>
                  <span className="text-zinc-300">{currentItem.director}</span>
                </div>
              )}
              {currentItem.actors && (
                <div>
                  <span className="text-zinc-500 font-medium">Reparto: </span>
                  <span className="text-zinc-300">{currentItem.actors}</span>
                </div>
              )}
            </div>
          )}

          {/* Series Episodes & Seasons Section */}
          {isSeries && (
            <div className="space-y-4 pt-4 border-t border-zinc-800/80">
              {/* Season Selector Bar */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Tv className="h-4 w-4 text-rose-500" />
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                    Episodios
                  </h3>
                  <Badge variant="outline" className="text-[10px] text-zinc-400 border-zinc-800">
                    {seasonEpisodes.length} disponibles
                  </Badge>
                </div>

                {/* Season Buttons */}
                {seasons.length > 0 && (
                  <div className="flex items-center gap-1.5 overflow-x-auto pb-1 max-w-full">
                    <span className="text-xs text-zinc-400 font-medium flex items-center gap-1 mr-1 shrink-0">
                      <Layers className="h-3.5 w-3.5" /> Temporada:
                    </span>
                    {seasons.map((s) => {
                      const isActive = selectedSeasonNumber === s.number;
                      return (
                        <Button
                          key={s.number}
                          variant={isActive ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => handleSelectSeason(s)}
                          className={`text-xs rounded-lg px-3 h-8 cursor-pointer transition-all ${
                            isActive
                              ? 'bg-rose-600 hover:bg-rose-500 text-white font-bold shadow-md shadow-rose-950'
                              : 'border-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-900'
                          }`}
                        >
                          {s.name || `T${s.number}`}
                        </Button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Episodes Grid with Loading State */}
              {initialLoading || seasonLoading ? (
                <div className="py-14 flex flex-col items-center justify-center text-zinc-400 gap-3 bg-zinc-900/20 rounded-xl border border-zinc-900">
                  <Loader2 className="h-7 w-7 animate-spin text-rose-500" />
                  <span className="text-xs text-zinc-400">
                    Cargando episodios de la Temporada {selectedSeasonNumber}...
                  </span>
                </div>
              ) : seasonEpisodes.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-80 overflow-y-auto pr-1">
                  {seasonEpisodes.map((ep) => {
                    const isCurrentResolving = isResolving && resolvingEpId === ep.id;
                    const displayTitle = cleanEpisodeTitle(ep.name || ep.title || `Capítulo ${ep.number}`);

                    return (
                      <div
                        key={ep.id}
                        onClick={() => !isResolving && handlePlayEpisodeClick(ep)}
                        className={`group flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer ${
                          isCurrentResolving
                            ? 'border-rose-500 bg-rose-950/20'
                            : 'border-zinc-800/80 bg-zinc-900/40 hover:bg-zinc-900 hover:border-zinc-700'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0 pr-2">
                          <div className="h-9 w-9 rounded-lg bg-zinc-800 group-hover:bg-rose-600 flex items-center justify-center font-bold text-xs text-white shrink-0 transition-colors shadow-sm">
                            {ep.number}
                          </div>
                          <div className="space-y-0.5 min-w-0">
                            <p className="text-xs font-semibold text-zinc-200 group-hover:text-white truncate">
                              {displayTitle || `Episodio ${ep.number}`}
                            </p>
                            <div className="flex items-center gap-2">
                              {ep.duration && (
                                <span className="text-[10px] text-zinc-400">
                                  {ep.duration}
                                </span>
                              )}
                              {ep.quality && (
                                <Badge variant="outline" className="text-[9px] py-0 px-1 border-zinc-800 text-zinc-400 font-mono">
                                  {ep.quality.split(',')[0]}
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>

                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={isResolving}
                          className="h-8 w-8 rounded-full text-zinc-400 group-hover:text-white group-hover:bg-zinc-800 shrink-0"
                        >
                          {isCurrentResolving ? (
                            <Loader2 className="h-4 w-4 animate-spin text-rose-500" />
                          ) : (
                            <Play className="h-4 w-4 fill-current ml-0.5" />
                          )}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-10 bg-zinc-900/20 rounded-xl border border-zinc-900">
                  <p className="text-xs text-zinc-400">
                    No se encontraron episodios para la Temporada {selectedSeasonNumber}.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
