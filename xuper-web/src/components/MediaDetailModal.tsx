import React, { useEffect, useState } from 'react';
import { X, Play, Star, Calendar, Clock, Film, Tv, Loader2, User } from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { api, MediaItem, MediaDetailResponse, Episode } from '../services/api';

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
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<MediaDetailResponse | null>(null);
  const [selectedSeason, setSelectedSeason] = useState<number>(1);
  const [isResolving, setIsResolving] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const fetchDetail = async () => {
      setLoading(true);
      const res = await api.getDetail(media.id);
      if (isMounted) {
        if (res) {
          setDetail(res);
          if (res.seasons && res.seasons.length > 0) {
            setSelectedSeason(res.seasons[0].number || 1);
          }
        }
        setLoading(false);
      }
    };
    fetchDetail();
    return () => {
      isMounted = false;
    };
  }, [media.id]);

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
    try {
      const res = await api.resolveMedia(ep.id, media.id);
      if (res.url) {
        const epTitle = ep.name || ep.title || `Episodio ${ep.number}`;
        onPlayEpisode(res.url, media.title, `T${selectedSeason} : E${ep.number} - ${epTitle}`);
      } else {
        alert('No se pudo obtener el enlace del episodio.');
      }
    } catch {
      alert('Error al resolver el episodio.');
    } finally {
      setIsResolving(false);
    }
  };

  const item = detail?.item || media;
  const isSeries = item.type === 'teleplay' || item.type === 'series' || item.category === 'serie' || (detail?.episodes && detail.episodes.length > 0);
  const episodes = detail?.episodes || [];
  const seasons = detail?.seasons || [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 md:p-10 bg-black/80 backdrop-blur-md overflow-y-auto animate-in fade-in duration-200">
      <div className="relative w-full max-w-4xl bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden my-auto max-h-[90vh] flex flex-col">
        {/* Close Button */}
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="absolute top-4 right-4 z-20 rounded-full bg-black/60 hover:bg-zinc-800 text-zinc-300 hover:text-white"
        >
          <X className="h-5 w-5" />
        </Button>

        {/* Hero Backdrop Header */}
        <div className="relative h-64 sm:h-80 w-full overflow-hidden shrink-0 bg-zinc-900">
          <img
            src={item.backdrop || item.landscape || item.poster}
            alt={item.title}
            className="w-full h-full object-cover opacity-60"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/60 to-transparent" />

          {/* Info Overlay */}
          <div className="absolute bottom-6 left-6 right-6 flex items-end gap-6">
            <img
              src={item.poster}
              alt={item.title}
              className="hidden sm:block w-32 h-48 object-cover rounded-xl shadow-2xl border border-zinc-800 shrink-0"
            />
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={isSeries ? 'secondary' : 'default'} className="uppercase font-bold tracking-wider text-[10px]">
                  {isSeries ? 'Serie' : 'Película'}
                </Badge>
                {item.score && (
                  <Badge variant="outline" className="gap-1 border-amber-500/40 text-amber-400 bg-amber-950/20">
                    <Star className="h-3 w-3 fill-amber-400" />
                    <span>{item.score}</span>
                  </Badge>
                )}
                {item.year && item.year !== '—' && (
                  <span className="text-xs text-zinc-400 flex items-center gap-1">
                    <Calendar className="h-3 w-3" /> {item.year}
                  </span>
                )}
                {item.duration && (
                  <span className="text-xs text-zinc-400 flex items-center gap-1">
                    <Clock className="h-3 w-3" /> {item.duration}
                  </span>
                )}
              </div>

              <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight leading-tight">
                {item.title}
              </h1>

              {/* Genres */}
              {item.genres && item.genres.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {item.genres.map((g, idx) => (
                    <Badge key={idx} variant="outline" className="text-[11px] py-0 border-zinc-700 text-zinc-300">
                      {g}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Scrollable Content Body */}
        <div className="p-6 space-y-6 overflow-y-auto flex-1">
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
          {item.synopsis && (
            <div className="space-y-1.5">
              <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Sinopsis</h3>
              <p className="text-sm text-zinc-300 leading-relaxed font-normal">
                {item.synopsis}
              </p>
            </div>
          )}

          {/* Cast & Director */}
          {(item.director || item.actors) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-zinc-800/80 text-xs">
              {item.director && (
                <div>
                  <span className="text-zinc-500 font-medium">Director: </span>
                  <span className="text-zinc-300">{item.director}</span>
                </div>
              )}
              {item.actors && (
                <div>
                  <span className="text-zinc-500 font-medium">Reparto: </span>
                  <span className="text-zinc-300">{item.actors}</span>
                </div>
              )}
            </div>
          )}

          {/* Series Episodes Section */}
          {isSeries && (
            <div className="space-y-4 pt-4 border-t border-zinc-800">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <Tv className="h-4 w-4 text-rose-500" />
                  <span>Episodios y Temporadas</span>
                </h3>
                {seasons.length > 1 && (
                  <div className="flex gap-2">
                    {seasons.map((s) => (
                      <Button
                        key={s.number}
                        variant={selectedSeason === s.number ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setSelectedSeason(s.number)}
                        className="text-xs rounded-lg"
                      >
                        {s.name || `Temporada ${s.number}`}
                      </Button>
                    ))}
                  </div>
                )}
              </div>

              {loading ? (
                <div className="py-12 flex flex-col items-center justify-center text-zinc-400 gap-2">
                  <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
                  <span className="text-xs">Cargando episodios de la serie...</span>
                </div>
              ) : episodes.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-72 overflow-y-auto pr-1">
                  {episodes.map((ep) => (
                    <div
                      key={ep.id}
                      onClick={() => handlePlayEpisodeClick(ep)}
                      className="group flex items-center justify-between p-3 rounded-xl border border-zinc-800/80 bg-zinc-900/40 hover:bg-zinc-800/80 hover:border-zinc-700 transition-all cursor-pointer"
                    >
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-lg bg-zinc-800 group-hover:bg-rose-600 flex items-center justify-center font-bold text-xs text-white shrink-0 transition-colors">
                          {ep.number}
                        </div>
                        <div className="space-y-0.5">
                          <p className="text-xs font-semibold text-zinc-200 group-hover:text-white line-clamp-1">
                            {ep.name || ep.title || `Capítulo ${ep.number}`}
                          </p>
                          {ep.quality && (
                            <span className="text-[10px] text-zinc-500 font-mono">
                              {ep.quality}
                            </span>
                          )}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 rounded-full text-zinc-400 group-hover:text-white group-hover:bg-zinc-700/60"
                      >
                        <Play className="h-4 w-4 fill-current ml-0.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-zinc-500 py-4 text-center">
                  No hay episodios disponibles para esta temporada.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
