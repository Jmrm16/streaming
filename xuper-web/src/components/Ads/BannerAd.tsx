import React, { useState } from 'react';
import { ExternalLink, X, Sparkles, Megaphone } from 'lucide-react';
import { Button } from '../ui/button';
import { BannerAdItem, adManager } from '../../services/adConfig';

interface BannerAdProps {
  placement?: 'catalog' | 'player_pause' | 'sidebar' | 'detail' | 'footer';
  onClose?: () => void;
}

export const BannerAd: React.FC<BannerAdProps> = ({ placement = 'catalog', onClose }) => {
  const [ad] = useState<BannerAdItem>(() => adManager.getRandomBannerAd());
  const [isDismissed, setIsDismissed] = useState(false);

  if (isDismissed) return null;

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsDismissed(true);
    if (onClose) onClose();
  };

  if (placement === 'detail') {
    return (
      <div className="w-full my-6 rounded-2xl border border-amber-500/30 bg-gradient-to-r from-amber-950/20 via-zinc-900 to-zinc-950 p-4 sm:p-5 relative overflow-hidden shadow-xl animate-in fade-in">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="h-11 w-11 shrink-0 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Megaphone className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase font-extrabold text-amber-400 tracking-wider">
                  Patrocinador Oficial
                </span>
                <span className="text-[10px] text-zinc-500">• {ad.networkBadge}</span>
              </div>
              <h4 className="text-sm font-bold text-white truncate">{ad.title}</h4>
              <p className="text-xs text-zinc-400 truncate">{ad.subtitle}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <a
              href={ad.targetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-xs transition-all shadow-md shadow-amber-950/40 flex items-center gap-2 hover:scale-105"
            >
              <span>{ad.ctaText}</span>
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>
      </div>
    );
  }

  if (placement === 'footer') {
    return (
      <div className="w-full mt-10 mb-6 rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-4 relative overflow-hidden shadow-lg">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-center sm:text-left">
          <div className="flex items-center gap-3">
            <span className="text-[9px] uppercase font-bold text-zinc-500 px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800">
              PUBLICIDAD
            </span>
            <div>
              <p className="text-xs font-bold text-zinc-200">{ad.title}</p>
              <p className="text-[11px] text-zinc-500">{ad.subtitle}</p>
            </div>
          </div>
          <a
            href={ad.targetUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-semibold text-xs transition-colors flex items-center gap-1.5"
          >
            <span>{ad.ctaText}</span>
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>
    );
  }

  if (placement === 'player_pause') {
    return (
      <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-40 w-11/12 max-w-xl bg-zinc-950/95 border border-zinc-800 backdrop-blur-xl rounded-2xl p-4 shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-300">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="h-10 w-10 shrink-0 rounded-xl bg-gradient-to-tr from-amber-500/20 to-orange-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
              <Megaphone className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase font-extrabold text-amber-400 tracking-wider">
                  Patrocinador
                </span>
                <span className="text-[10px] text-zinc-500">• {ad.networkBadge}</span>
              </div>
              <h4 className="text-xs sm:text-sm font-bold text-white truncate">{ad.title}</h4>
              <p className="text-[11px] text-zinc-400 truncate">{ad.subtitle}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <a
              href={ad.targetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs transition-colors flex items-center gap-1.5 shadow-md shadow-rose-950/40"
            >
              <span>{ad.ctaText}</span>
              <ExternalLink className="h-3 w-3" />
            </a>
            <button
              onClick={handleDismiss}
              className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
              title="Cerrar banner"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Catalog / Default display banner
  return (
    <div className="w-full my-6 rounded-2xl border border-zinc-800/80 bg-gradient-to-r from-zinc-950 via-zinc-900 to-zinc-950 p-4 sm:p-5 relative overflow-hidden shadow-lg group">
      <div className="absolute top-2 right-2 flex items-center gap-1.5">
        <span className="text-[9px] uppercase font-bold text-zinc-500 px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800">
          {ad.networkBadge}
        </span>
        <button
          onClick={handleDismiss}
          className="p-1 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-1">
        <div className="flex items-start sm:items-center gap-3">
          <div className="h-11 w-11 shrink-0 rounded-xl bg-rose-950/40 border border-rose-800/40 flex items-center justify-center text-rose-400 shadow-inner">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-extrabold uppercase text-amber-400 tracking-wider">
                Anuncio Patrocinado
              </span>
              <span className="text-zinc-600">•</span>
              <span className="text-xs text-zinc-400 font-medium">{ad.advertiser}</span>
            </div>
            <h4 className="text-sm font-bold text-white mt-0.5">{ad.title}</h4>
            <p className="text-xs text-zinc-400 mt-0.5">{ad.subtitle}</p>
          </div>
        </div>

        <a
          href={ad.targetUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="self-start sm:self-center shrink-0 px-4 py-2 rounded-xl bg-zinc-100 hover:bg-white text-zinc-950 font-bold text-xs shadow-md transition-transform active:scale-95 flex items-center gap-2"
        >
          <span>{ad.ctaText}</span>
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
    </div>
  );
};
