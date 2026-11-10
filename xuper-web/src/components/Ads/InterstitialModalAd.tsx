import React, { useState, useEffect } from 'react';
import { X, ExternalLink, CheckCircle2, ShieldCheck, Flame } from 'lucide-react';
import { Button } from '../ui/button';
import { adManager, InterstitialAdItem } from '../../services/adConfig';

interface InterstitialModalAdProps {
  isOpen: boolean;
  onClose: () => void;
}

export const InterstitialModalAd: React.FC<InterstitialModalAdProps> = ({ isOpen, onClose }) => {
  const [ad] = useState<InterstitialAdItem>(() => adManager.getInterstitialAd());
  const [countdown, setCountdown] = useState<number>(4);
  const [canClose, setCanClose] = useState<boolean>(false);

  useEffect(() => {
    if (!isOpen) {
      setCountdown(4);
      setCanClose(false);
      return;
    }

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          setCanClose(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg rounded-3xl bg-zinc-950 border border-zinc-800 p-6 sm:p-8 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        {/* Glow Accent */}
        <div className="absolute -top-24 -right-24 w-60 h-60 bg-rose-600/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-60 h-60 bg-amber-600/20 rounded-full blur-3xl pointer-events-none" />

        {/* Header Bar */}
        <div className="flex items-center justify-between pb-4 border-b border-zinc-800/80 mb-5 relative z-10">
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full bg-rose-950/70 border border-rose-800/50 text-rose-400 font-bold text-[10px] tracking-wider uppercase flex items-center gap-1">
              <Flame className="h-3 w-3" />
              {ad.badge}
            </span>
            <span className="text-[11px] text-zinc-500">• {ad.networkBadge}</span>
          </div>

          {canClose ? (
            <button
              onClick={onClose}
              className="p-1.5 rounded-full text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors flex items-center gap-1.5 text-xs font-semibold"
            >
              <span>Continuar</span>
              <X className="h-4 w-4" />
            </button>
          ) : (
            <div className="text-xs text-zinc-400 font-medium px-2.5 py-1 rounded-full bg-zinc-900 border border-zinc-800">
              Omitir en <span className="text-amber-400 font-bold">{countdown}s</span>
            </div>
          )}
        </div>

        {/* Content Body */}
        <div className="space-y-4 relative z-10">
          <div>
            <h3 className="text-xl sm:text-2xl font-black text-white tracking-tight leading-tight">
              {ad.title}
            </h3>
            <p className="text-xs sm:text-sm text-zinc-400 mt-1.5 font-medium">{ad.tagline}</p>
          </div>

          <div className="p-4 rounded-2xl bg-zinc-900/60 border border-zinc-800/60 space-y-2.5">
            <p className="text-xs text-zinc-300 leading-relaxed">{ad.description}</p>
            <div className="space-y-1.5 pt-1">
              {ad.bulletPoints.map((point, idx) => (
                <div key={idx} className="flex items-center gap-2 text-xs text-zinc-200">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                  <span>{point}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="pt-2 flex flex-col sm:flex-row items-center gap-3">
            <a
              href={ad.targetUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onClose}
              className="w-full sm:flex-1 py-3 px-5 rounded-xl bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 text-white font-bold text-xs sm:text-sm text-center shadow-lg shadow-rose-950/60 transition-transform active:scale-95 flex items-center justify-center gap-2"
            >
              <span>{ad.ctaText}</span>
              <ExternalLink className="h-4 w-4" />
            </a>

            {canClose && (
              <Button
                variant="outline"
                size="sm"
                onClick={onClose}
                className="w-full sm:w-auto text-xs border-zinc-800 text-zinc-400 hover:text-white"
              >
                No por ahora
              </Button>
            )}
          </div>

          <div className="flex items-center justify-center gap-1.5 text-[11px] text-zinc-500 pt-1">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
            <span>Publicidad verificada y segura para la comunidad</span>
          </div>
        </div>
      </div>
    </div>
  );
};
