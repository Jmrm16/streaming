import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Play,
  Star,
  Calendar,
  Clock,
  Tv,
  Loader2,
  Heart,
  Share2,
  Sparkles,
  Info,
  Film,
  Layers,
  ChevronDown,
} from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { BannerAd } from './Ads/BannerAd';
import { adManager } from '../services/adConfig';
import { api, MediaItem, MediaDetailResponse, Episode, Season, SubtitleTrack, AudioLanguage } from '../services/api';

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
  const [seasonCache, setSeasonCache] = useState<Record<string, { item: MediaItem; episodes: Episode[] }>>({});
  const [isResolving, setIsResolving] = useState(false);
  const [resolvingEpId, setResolvingEpId] = useState<string | null>(null);

  // Load initial detail
  useEffect(() => {
    let isMounted = true;
    const fetchDetail = async () => {
      setInitialLoading(true);
      try {
        const res = await api.getDetail(media.id);
        if (!isMounted) return;

        if (res) {
          setDetail(res);

          // Extract and sort seasons
          let rawSeasons = (res.seasons || []).slice();
          rawSeasons.sort((a, b) => a.number - b.number);

          // If no seasons returned from API but it's a series or has episodes, create a default Season 1
          const isSeriesType =
            res.item?.type === 'teleplay' ||
            res.item?.type === 'series' ||
            res.item?.category === 'serie' ||
            (res.episodes && res.episodes.length > 0);

          if (rawSeasons.length === 0 && isSeriesType) {
            rawSeasons = [{ id: media.id, number: 1, name: 'Temporada 1' }];
          }

          setSeasons(rawSeasons);

          // Determine current season matching this media.id or title
          let activeSeason = rawSeasons.find((s) => s.id === media.id);
          if (!activeSeason && rawSeasons.length > 0) {
            // Check if media.title contains T1, T2, etc.
            const match = media.title.match(/T(\d+)/i);
            if (match) {
              const num = parseInt(match[1], 10);
              activeSeason = rawSeasons.find((s) => s.number === num);
            }
          }
          if (!activeSeason && rawSeasons.length > 0) {
            activeSeason = rawSeasons[0];
          }

          const currentSId = activeSeason?.id || media.id;
          const currentSNum = activeSeason?.number || 1;

          setSelectedSeasonNumber(currentSNum);
          setSelectedSeasonId(currentSId);

          const initialEps = res.episodes || [];
          setSeasonEpisodes(initialEps);

          // Cache current season detail
          setSeasonCache({
            [currentSId]: {
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

  // Handle season tab click
  const handleSelectSeason = async (season: Season) => {
    const sId = season.id || media.id;
    if (sId === selectedSeasonId && seasonEpisodes.length > 0) return;

    setSelectedSeasonNumber(season.number);
    setSelectedSeasonId(sId);

    // If cached, show immediately
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
        onPlayMovie(
          res.url,
          media.title,
          media.year || 'Película',
          res.subtitles,
          res.audioLanguages,
          media.id
        );
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
          `Temporada ${selectedSeasonNumber} • Episodio ${ep.number} - ${cleanEpTitle}`,
          res.subtitles,
          res.audioLanguages,
          ep.id,
          selectedSeasonId
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
    <div className="flex-1 overflow-y-auto bg-zinc-950 animate-in fade-in duration-200">
      {/* Top Floating Navigation Bar */}
      <div className="sticky top-0 z-30 flex items-center justify-between px-6 py-4 bg-zinc-950/80 backdrop-blur-md border-b border-zinc-900">
        <Button
          variant="outline"
          size="sm"
          onClick={onBack}
          className="gap-2 rounded-xl bg-zinc-900/90 border-zinc-800 hover:bg-zinc-800 text-zinc-200 hover:text-white cursor-pointer transition-all shadow-sm"
        >
          <ArrowLeft className="h-4 w-4" />
          <span className="font-semibold text-xs">Volver al catálogo</span>
        </Button>

        <div className="flex items-center gap-2">
          {onToggleFavorite && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onToggleFavorite(media)}
              className={`gap-2 rounded-xl border-zinc-800 text-xs transition-colors ${
                isFavorite
                  ? 'bg-rose-950/40 text-rose-400 border-rose-800/60'
                  : 'bg-zinc-900/60 text-zinc-300 hover:text-white'
              }`}
            >
              <Heart className={`h-4 w-4 ${isFavorite ? 'fill-rose-500 text-rose-500' : ''}`} />
              <span className="hidden sm:inline">{isFavorite ? 'Favorito' : 'Guardar'}</span>
            </Button>
          )}
        </div>
      </div>

      {/* Cinematic Hero Backdrop */}
      <div className="relative min-h-[380px] md:min-h-[460px] w-full overflow-hidden bg-zinc-900 flex items-end">
        <img
          src={currentItem.backdrop || currentItem.landscape || currentItem.poster}
          alt={currentItem.title}
          className="absolute inset-0 w-full h-full object-cover opacity-50 select-none"
        />
        {/* Gradients */}
        <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/70 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-zinc-950/90 via-zinc-950/40 to-transparent" />

        {/* Hero Content Container */}
        <div className="relative z-10 w-full max-w-7xl mx-auto px-6 py-10 flex flex-col md:flex-row items-start md:items-end gap-6 md:gap-8">
          {/* Big Poster */}
          <div className="relative group shrink-0 hidden sm:block">
            <img
              src={currentItem.poster}
              alt={currentItem.title}
              className="w-44 h-64 md:w-56 md:h-80 object-cover rounded-2xl shadow-2xl border border-zinc-800/80 transition-transform duration-300 group-hover:scale-[1.02]"
            />
            {isSeries && seasons.length > 0 && (
              <Badge className="absolute top-3 left-3 bg-black/75 backdrop-blur-md text-white border border-white/10 text-[10px] uppercase font-bold">
                {seasons.length} {seasons.length === 1 ? 'Temporada' : 'Temporadas'}
              </Badge>
            )}
          </div>

          {/* Title & Metadata */}
          <div className="space-y-4 max-w-3xl">
            <div className="flex flex-wrap items-center gap-2.5">
              <Badge
                variant="secondary"
                className={`uppercase font-black tracking-wider text-xs px-2.5 py-0.5 ${
                  isSeries
                    ? 'bg-rose-950/70 text-rose-400 border border-rose-800/50'
                    : 'bg-emerald-950/70 text-emerald-400 border border-emerald-800/50'
                }`}
              >
                {isSeries ? 'Serie de TV' : 'Película'}
              </Badge>

              {currentItem.score && currentItem.score !== '—' && (
                <Badge variant="outline" className="gap-1 border-amber-500/40 text-amber-400 bg-amber-950/30 px-2 py-0.5">
                  <Star className="h-3.5 w-3.5 fill-amber-400" />
                  <span className="font-bold text-xs">{currentItem.score}</span>
                </Badge>
              )}

              {currentItem.year && currentItem.year !== '—' && (
                <span className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5 bg-zinc-900/60 px-2.5 py-1 rounded-lg border border-zinc-800">
                  <Calendar className="h-3.5 w-3.5 text-zinc-400" /> {currentItem.year}
                </span>
              )}

              {currentItem.duration && (
                <span className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5 bg-zinc-900/60 px-2.5 py-1 rounded-lg border border-zinc-800">
                  <Clock className="h-3.5 w-3.5 text-zinc-400" /> {currentItem.duration}
                </span>
              )}

              <Badge variant="outline" className="text-[10px] text-zinc-400 border-zinc-800 bg-zinc-900/50">
                Ultra HD • Estéreo
              </Badge>
            </div>

            <h1 className="text-3xl sm:text-4xl md:text-5xl font-black text-white tracking-tight leading-tight">
              {currentItem.title}
            </h1>

            {/* Genres */}
            {currentItem.genres && currentItem.genres.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {currentItem.genres.map((g, idx) => (
                  <Badge key={idx} variant="outline" className="text-xs py-0.5 px-2.5 border-zinc-800 bg-zinc-900/40 text-zinc-300">
                    {g}
                  </Badge>
                ))}
              </div>
            )}

            {/* Action Buttons for Movies */}
            {!isSeries && (
              <div className="pt-2 flex items-center gap-3">
                <Button
                  size="lg"
                  onClick={handlePlayMovie}
                  disabled={isResolving}
                  className="gap-3 rounded-xl font-bold bg-white text-zinc-950 hover:bg-zinc-200 px-8 h-12 shadow-xl shadow-white/10 cursor-pointer transition-all hover:scale-105"
                >
                  {isResolving ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <Play className="h-5 w-5 fill-current" />
                  )}
                  <span className="text-sm font-black">Reproducir Película</span>
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main Details and Episodes Section */}
      <div className="w-full max-w-7xl mx-auto px-6 py-8 space-y-8">
        {/* Sponsored Official Banner */}
        {adManager.isAdsEnabled() && <BannerAd placement="detail" />}

        {/* Synopsis & Cast */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-3">
            <h3 className="text-sm font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-2">
              <Info className="h-4 w-4 text-zinc-500" />
              <span>Sinopsis</span>
            </h3>
            <p className="text-zinc-300 text-sm md:text-base leading-relaxed font-normal">
              {currentItem.synopsis || 'Sin descripción disponible para este título.'}
            </p>
          </div>

          <div className="space-y-4 p-5 rounded-2xl bg-zinc-900/40 border border-zinc-850">
            <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Ficha Técnica</h4>
            {currentItem.director && (
              <div className="text-xs space-y-1">
                <span className="text-zinc-500 font-semibold block">Dirección</span>
                <span className="text-zinc-200">{currentItem.director}</span>
              </div>
            )}
            {currentItem.actors && (
              <div className="text-xs space-y-1 pt-2 border-t border-zinc-800/60">
                <span className="text-zinc-500 font-semibold block">Elenco Principal</span>
                <span className="text-zinc-200 leading-relaxed">{currentItem.actors}</span>
              </div>
            )}
            <div className="text-xs space-y-1 pt-2 border-t border-zinc-800/60">
              <span className="text-zinc-500 font-semibold block">Formato de Video</span>
              <span className="text-zinc-300 font-mono">H.264 / AAC 1080p Stream</span>
            </div>
          </div>
        </div>

        {/* Series Episodes & Seasons Section */}
        {isSeries && (
          <div className="space-y-6 pt-6 border-t border-zinc-800">
            {/* Header: Title and Season Selector Tabs */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-zinc-850">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-xl bg-rose-600/20 border border-rose-500/30 flex items-center justify-center text-rose-500">
                  <Tv className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-xl font-black text-white tracking-tight">
                    Episodios y Temporadas
                  </h2>
                  <p className="text-xs text-zinc-400">
                    {seasonEpisodes.length} capítulos disponibles en la Temporada {selectedSeasonNumber}
                  </p>
                </div>
              </div>

              {/* Season Selection Tabs (Prominent & Clickable) */}
              {seasons.length > 0 && (
                <div className="flex items-center gap-2 overflow-x-auto pb-2 sm:pb-0">
                  <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider mr-1 shrink-0 flex items-center gap-1.5">
                    <Layers className="h-3.5 w-3.5 text-zinc-500" />
                    Temporada:
                  </span>
                  <div className="flex items-center gap-2 bg-zinc-900/80 p-1.5 rounded-xl border border-zinc-800 shrink-0">
                    {seasons.map((s) => {
                      const isActive = selectedSeasonNumber === s.number;
                      return (
                        <button
                          key={s.number}
                          onClick={() => handleSelectSeason(s)}
                          className={`px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                            isActive
                              ? 'bg-rose-600 text-white shadow-md shadow-rose-950 scale-105'
                              : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
                          }`}
                        >
                          {s.name || `Temporada ${s.number}`}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Episode Grid with Loading State */}
            {initialLoading || seasonLoading ? (
              <div className="py-24 flex flex-col items-center justify-center text-zinc-400 gap-3 bg-zinc-900/30 rounded-2xl border border-zinc-850">
                <Loader2 className="h-8 w-8 animate-spin text-rose-500" />
                <span className="text-sm font-medium text-zinc-300">
                  Cargando episodios de la Temporada {selectedSeasonNumber}...
                </span>
              </div>
            ) : seasonEpisodes.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {seasonEpisodes.map((ep) => {
                  const isCurrentResolving = isResolving && resolvingEpId === ep.id;
                  const displayTitle = cleanEpisodeTitle(ep.name || ep.title || `Capítulo ${ep.number}`);

                  return (
                    <div
                      key={ep.id}
                      onClick={() => !isResolving && handlePlayEpisodeClick(ep)}
                      className={`group relative flex flex-col justify-between p-4 rounded-2xl border transition-all duration-200 cursor-pointer ${
                        isCurrentResolving
                          ? 'border-rose-500 bg-rose-950/20 ring-1 ring-rose-500'
                          : 'border-zinc-800/80 bg-zinc-900/40 hover:bg-zinc-900 hover:border-zinc-700 hover:shadow-xl'
                      }`}
                    >
                      <div className="flex items-start gap-3.5 mb-3">
                        <div className="h-10 w-10 rounded-xl bg-zinc-800 group-hover:bg-rose-600 flex items-center justify-center font-black text-sm text-white shrink-0 transition-colors shadow-sm">
                          {ep.number}
                        </div>
                        <div className="space-y-1 min-w-0 flex-1">
                          <h4 className="text-sm font-bold text-zinc-200 group-hover:text-white line-clamp-2 leading-snug">
                            {displayTitle || `Episodio ${ep.number}`}
                          </h4>
                          <div className="flex items-center gap-2">
                            {ep.duration && (
                              <span className="text-xs text-zinc-400 flex items-center gap-1">
                                <Clock className="h-3 w-3" /> {ep.duration}
                              </span>
                            )}
                            {ep.quality && (
                              <Badge variant="outline" className="text-[10px] py-0 px-1.5 border-zinc-800 text-zinc-400 font-mono">
                                {ep.quality.split(',')[0]}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>

                      {ep.description && (
                        <p className="text-xs text-zinc-400 line-clamp-2 mb-3 leading-relaxed">
                          {ep.description}
                        </p>
                      )}

                      <div className="pt-2 border-t border-zinc-800/60 flex items-center justify-between">
                        <span className="text-[11px] font-semibold text-zinc-500 group-hover:text-rose-400 transition-colors">
                          Reproducir episodio
                        </span>
                        <div className="h-8 w-8 rounded-full bg-zinc-800 group-hover:bg-white flex items-center justify-center text-zinc-300 group-hover:text-zinc-950 transition-colors shadow-sm">
                          {isCurrentResolving ? (
                            <Loader2 className="h-4 w-4 animate-spin text-rose-500" />
                          ) : (
                            <Play className="h-4 w-4 fill-current ml-0.5" />
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-16 bg-zinc-900/30 rounded-2xl border border-zinc-850 space-y-2">
                <Tv className="h-8 w-8 text-zinc-600 mx-auto" />
                <p className="text-sm text-zinc-300 font-medium">
                  No hay episodios listados para la Temporada {selectedSeasonNumber}.
                </p>
                <p className="text-xs text-zinc-500">
                  Prueba seleccionando otra temporada en la barra superior.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
