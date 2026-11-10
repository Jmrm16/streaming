import React, { useState, useEffect, useRef } from 'react';
import { Volume2, VolumeX, ExternalLink, SkipForward, ShieldAlert } from 'lucide-react';
import { Button } from '../ui/button';
import { VideoAdItem, adManager } from '../../services/adConfig';

interface PreRollAdProps {
  onComplete: () => void;
  initialMuted?: boolean;
}

export const PreRollAd: React.FC<PreRollAdProps> = ({ onComplete, initialMuted = true }) => {
  const [ad] = useState<VideoAdItem>(() => adManager.getRandomVideoAd());
  const [timeLeft, setTimeLeft] = useState<number>(ad.skipDelay);
  const [canSkip, setCanSkip] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(initialMuted);
  const [adProgress, setAdProgress] = useState<number>(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    video.play().catch(() => {
      // Auto-play was prevented with sound, retry muted
      video.muted = true;
      setIsMuted(true);
      video.play().catch(console.error);
    });

    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          setCanSkip(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [ad]);

  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (video && video.duration) {
      setAdProgress((video.currentTime / video.duration) * 100);
    }
  };

  const handleToggleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  };

  return (
    <div className="absolute inset-0 z-50 bg-black flex flex-col justify-between overflow-hidden select-none animate-in fade-in duration-300">
      {/* Video Element */}
      <video
        ref={videoRef}
        src={ad.videoUrl}
        className="absolute inset-0 w-full h-full object-cover"
        playsInline
        muted={isMuted}
        onTimeUpdate={handleTimeUpdate}
        onEnded={onComplete}
      />

      {/* Top Overlay Banner */}
      <div className="relative z-10 p-4 sm:p-6 bg-gradient-to-b from-black/90 via-black/40 to-transparent flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="px-2.5 py-1 rounded-md bg-amber-500/90 text-black font-extrabold text-[11px] tracking-wider uppercase shadow-md flex items-center gap-1.5">
            <ShieldAlert className="h-3.5 w-3.5" />
            Anuncio
          </span>
          <div>
            <p className="text-xs sm:text-sm font-bold text-white drop-shadow">{ad.advertiser}</p>
            <p className="text-[10px] text-zinc-300 drop-shadow line-clamp-1">{ad.networkBadge}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleToggleMute}
            className="h-9 w-9 rounded-full bg-black/60 hover:bg-black/80 text-white backdrop-blur border border-zinc-700/60"
            title={isMuted ? 'Activar sonido' : 'Silenciar'}
          >
            {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </Button>
          <a
            href={ad.targetUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-zinc-900/80 hover:bg-zinc-800 text-white text-xs font-medium border border-zinc-700/80 backdrop-blur transition-all"
          >
            <span>Visitar</span>
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>

      {/* Center Details Clickable */}
      <a
        href={ad.targetUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="relative z-10 self-start mx-4 sm:mx-6 p-3 sm:p-4 rounded-xl bg-black/60 hover:bg-black/80 backdrop-blur-md border border-zinc-800/80 max-w-md transition-all group cursor-pointer"
      >
        <h4 className="text-sm font-bold text-white group-hover:text-rose-400 transition-colors flex items-center gap-2">
          {ad.title}
          <ExternalLink className="h-3.5 w-3.5 opacity-60 group-hover:opacity-100" />
        </h4>
        <p className="text-xs text-zinc-300 mt-1 line-clamp-2">{ad.description}</p>
      </a>

      {/* Bottom Controls Bar */}
      <div className="relative z-10 p-4 sm:p-6 bg-gradient-to-t from-black/90 via-black/40 to-transparent space-y-3">
        {/* Progress Bar */}
        <div className="w-full h-1 bg-zinc-800/80 rounded-full overflow-hidden">
          <div
            className="h-full bg-amber-500 transition-all duration-200"
            style={{ width: `${adProgress}%` }}
          />
        </div>

        <div className="flex items-center justify-between">
          <p className="text-[11px] text-zinc-400">
            El video principal comenzará al terminar la publicidad.
          </p>

          {canSkip ? (
            <Button
              size="default"
              onClick={onComplete}
              className="gap-2 bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs sm:text-sm px-5 py-2 rounded-xl shadow-lg shadow-rose-950/60 transition-transform active:scale-95 cursor-pointer animate-in zoom-in-95 duration-200"
            >
              <span>Saltar anuncio</span>
              <SkipForward className="h-4 w-4" />
            </Button>
          ) : (
            <div className="px-4 py-2 rounded-xl bg-black/70 backdrop-blur border border-zinc-800 text-xs text-zinc-300 font-medium">
              Puedes saltar el anuncio en <span className="font-bold text-amber-400">{timeLeft}s</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
