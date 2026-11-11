import React, { useRef, useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Heart, Play } from 'lucide-react';
import { MediaItem, Channel } from '../services/api';

interface NetflixRowProps {
  heading: string;
  items: MediaItem[];
  isChannelRow?: boolean;
  channels?: Channel[];
  isTop10?: boolean;
  isFavorite?: (id: string) => boolean;
  onToggleFavorite?: (e: React.MouseEvent, item: MediaItem) => void;
  onToggleFavoriteChannel?: (e: React.MouseEvent, channel: Channel) => void;
  onSelectMedia: (item: MediaItem) => void;
  onSelectChannel?: (channel: Channel) => void;
  onViewAll?: () => void;
}

export const NetflixRow: React.FC<NetflixRowProps> = ({
  heading,
  items,
  isChannelRow = false,
  channels = [],
  isTop10 = false,
  isFavorite,
  onToggleFavorite,
  onToggleFavoriteChannel,
  onSelectMedia,
  onSelectChannel,
  onViewAll,
}) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false, overflow: false });

  const totalCount = isChannelRow ? channels.length : items.length;

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const update = () => {
      const atStart = track.scrollLeft <= 5;
      const atEnd = track.scrollLeft >= track.scrollWidth - track.clientWidth - 5;
      const canScroll = track.scrollWidth > track.clientWidth + 5;
      setEdges({ start: atStart, end: atEnd, overflow: canScroll });
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(track);
    track.addEventListener('scroll', update, { passive: true });
    return () => {
      observer.disconnect();
      track.removeEventListener('scroll', update);
    };
  }, [totalCount]);

  if (totalCount === 0) return null;

  const move = (direction: number) => {
    if (!trackRef.current) return;
    const scrollAmount = trackRef.current.clientWidth * 0.85;
    trackRef.current.scrollBy({
      left: direction * scrollAmount,
      behavior: 'smooth',
    });
  };

  return (
    <section className="media-row" aria-label={heading}>
      <div className="media-row-header">
        <div className="flex items-center gap-3">
          <h2 className="media-row-title">{heading}</h2>
          {onViewAll && (
            <button
              onClick={onViewAll}
              className="text-xs text-zinc-400 hover:text-white transition-colors cursor-pointer flex items-center gap-0.5 ml-2 font-medium"
            >
              <span>Explorar todos</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="row-controls" style={{ display: edges.overflow ? 'flex' : 'none' }}>
          <button
            type="button"
            className="row-arrow"
            disabled={edges.start}
            aria-label={`Anterior en ${heading}`}
            onClick={() => move(-1)}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            className="row-arrow"
            disabled={edges.end}
            aria-label={`Siguiente en ${heading}`}
            onClick={() => move(1)}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div ref={trackRef} className="media-track" tabIndex={0}>
        {isChannelRow
          ? channels.map((channel, idx) => {
              const fav = isFavorite ? isFavorite(channel.id || channel.channelCode || '') : false;
              return (
                <div
                  key={channel.id || channel.channelCode || idx}
                  className="media-card group cursor-pointer"
                  onClick={() => onSelectChannel && onSelectChannel(channel)}
                >
                  <div className="media-card-art flex flex-col items-center justify-center p-4 bg-[#1f1f1f] relative overflow-hidden">
                    <span className="card-netflix">M</span>
                    <span className="absolute top-2 right-2 text-[9px] font-bold text-red-500 bg-red-950/70 border border-red-800/60 px-1.5 py-0.5 rounded">
                      ● VIVO
                    </span>

                    {channel.logo ? (
                      <img
                        src={channel.logo}
                        alt={channel.name}
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

                    {onToggleFavoriteChannel && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleFavoriteChannel(e, channel);
                        }}
                        className={`absolute bottom-2 right-2 p-1.5 rounded-full transition-colors ${
                          fav
                            ? 'text-pink-500 bg-pink-950/80'
                            : 'text-zinc-400 hover:text-white bg-black/60 hover:bg-zinc-800'
                        }`}
                        title={fav ? 'Quitar de Mi lista' : 'Añadir a Mi lista'}
                      >
                        <Heart className={`w-3.5 h-3.5 ${fav ? 'fill-current' : ''}`} />
                      </button>
                    )}
                  </div>
                  <span className="media-card-title">{channel.name}</span>
                  <span className="media-card-info">
                    {channel.category || 'Televisión en Vivo'}
                  </span>
                </div>
              );
            })
          : items.map((item, idx) => {
              const fav = isFavorite ? isFavorite(item.id) : false;
              const artworkUrl = item.poster || item.landscape || item.backdrop;
              return (
                <div
                  key={item.id || idx}
                  className="media-card group cursor-pointer"
                  onClick={() => onSelectMedia(item)}
                >
                  <div className="media-card-art is-poster relative">
                    <img
                      src={artworkUrl}
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

                    {/* Iconic Maicaoflix "M" mark */}
                    <span className="card-netflix">M</span>

                    {/* Top 10 Red Badge for Trending */}
                    {isTop10 && idx < 10 && (
                      <span className="card-top10">
                        TOP
                        <br />
                        {idx + 1}
                      </span>
                    )}

                    {/* Quick favorite heart button on card */}
                    {onToggleFavorite && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleFavorite(e, item);
                        }}
                        className={`absolute top-2 right-2 p-1.5 rounded-full z-10 transition-colors ${
                          fav
                            ? 'text-pink-500 bg-black/70'
                            : 'text-zinc-400 hover:text-white bg-black/60 hover:bg-zinc-800'
                        }`}
                        title={fav ? 'Quitar de Mi lista' : 'Añadir a Mi lista'}
                      >
                        <Heart className={`w-3.5 h-3.5 ${fav ? 'fill-current' : ''}`} />
                      </button>
                    )}

                    {/* Floating play badge on hover */}
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <div className="w-10 h-10 rounded-full bg-white/90 text-black flex items-center justify-center shadow-lg transform scale-90 group-hover:scale-100 transition-transform">
                        <Play className="w-5 h-5 fill-current ml-0.5" />
                      </div>
                    </div>
                  </div>

                  <span className="media-card-title">{item.title}</span>
                  <span className="media-card-info">
                    {item.score && (
                      <span className="text-emerald-400 font-bold">
                        {item.score}
                      </span>
                    )}
                    <span>{item.year && item.year !== '—' ? item.year : ''}</span>
                    <span>
                      {item.genres && item.genres.length > 0
                        ? item.genres.slice(0, 2).join(' · ')
                        : item.kind || ''}
                    </span>
                  </span>
                </div>
              );
            })}
      </div>
    </section>
  );
};

export default NetflixRow;
