import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  X,
  Loader2,
  RotateCcw,
  RotateCw,
  Settings,
  Tv,
  ListVideo,
  PictureInPicture,
  RefreshCw,
  Check,
  Search,
  ArrowLeft,
  Subtitles,
} from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { Channel, SubtitleTrack, AudioLanguage } from '../services/api';

interface PlayerProps {
  url: string;
  title: string;
  subtitle?: string;
  isLive?: boolean;
  subtitles?: SubtitleTrack[];
  audioLanguages?: AudioLanguage[];
  channels?: Channel[];
  onSelectChannel?: (channel: Channel) => void;
  onSwitchAudioTrack?: (trackIndex: number) => void;
  onClose: () => void;
}

export const Player: React.FC<PlayerProps> = ({
  url,
  title,
  subtitle,
  isLive = false,
  subtitles = [],
  audioLanguages = [],
  channels = [],
  onSelectChannel,
  onSwitchAudioTrack,
  onClose,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);

  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showControls, setShowControls] = useState(true);

  // Advanced features state
  const [aspectRatio, setAspectRatio] = useState<'contain' | 'cover' | 'fill'>('contain');
  const [levels, setLevels] = useState<{ id: number; height: number; bitrate: number }[]>([]);
  const [currentLevel, setCurrentLevel] = useState<number>(-1); // -1 = Auto
  const [audioTracks, setAudioTracks] = useState<{ id: number; name: string; lang: string }[]>([]);
  const [currentAudioTrack, setCurrentAudioTrack] = useState<number>(0);
  const [selectedSubtitle, setSelectedSubtitle] = useState<string>('none');
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [showChannelDrawer, setShowChannelDrawer] = useState(false);
  const [channelSearch, setChannelSearch] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const initHls = () => {
    const video = videoRef.current;
    if (!video || !url) return;

    setIsLoading(true);
    setErrorMessage(null);

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    if (Hls.isSupported() && (url.includes('.m3u8') || !url.endsWith('.mp4'))) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 60,
      });
      hlsRef.current = hls;

      hls.loadSource(url);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
        setIsLoading(false);
        // Extract resolution levels
        if (data.levels && data.levels.length > 0) {
          const lvls = data.levels.map((lvl, index) => ({
            id: index,
            height: lvl.height || 0,
            bitrate: lvl.bitrate || 0,
          }));
          setLevels(lvls);
        }
        video.play().catch(() => setIsPlaying(false));
      });

      hls.on(Hls.Events.LEVEL_UPDATED, (_, data) => {
        if (data.details && data.details.totalduration) {
          setDuration(data.details.totalduration);
        }
      });

      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, (_, data) => {
        if (data.audioTracks && data.audioTracks.length > 0) {
          setAudioTracks(
            data.audioTracks.map((t, idx) => ({
              id: idx,
              name: t.name || audioLanguages?.[idx]?.name || `Pista ${idx + 1}`,
              lang: t.lang || audioLanguages?.[idx]?.code || '',
            }))
          );
        }
      });

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError();
              break;
            default:
              setErrorMessage('Error fatal al cargar la transmisión. Reintentando...');
              hls.destroy();
              break;
          }
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl') || url.endsWith('.mp4')) {
      video.src = url;
      video.addEventListener('loadedmetadata', () => {
        setIsLoading(false);
        video.play().catch(() => setIsPlaying(false));
      });
    }
  };

  useEffect(() => {
    initHls();
    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
      }
    };
  }, [url]);

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      videoRef.current.play();
      setIsPlaying(true);
    }
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    videoRef.current.muted = !isMuted;
    setIsMuted(!isMuted);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    if (videoRef.current) {
      videoRef.current.volume = val;
      videoRef.current.muted = val === 0;
      setIsMuted(val === 0);
    }
  };

  const skipSeconds = (seconds: number) => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = Math.max(0, Math.min(duration, videoRef.current.currentTime + seconds));
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  const togglePiP = async () => {
    if (!videoRef.current) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await videoRef.current.requestPictureInPicture();
      }
    } catch (e) {
      console.error('Error toggling PiP:', e);
    }
  };

  const cycleAspectRatio = () => {
    if (aspectRatio === 'contain') setAspectRatio('cover');
    else if (aspectRatio === 'cover') setAspectRatio('fill');
    else setAspectRatio('contain');
  };

  const setQualityLevel = (levelIndex: number) => {
    setCurrentLevel(levelIndex);
    if (hlsRef.current) {
      hlsRef.current.currentLevel = levelIndex;
    }
    setShowSettingsMenu(false);
  };

  // Sync external audio languages from API
  useEffect(() => {
    if (audioLanguages && audioLanguages.length > 0 && audioTracks.length === 0) {
      setAudioTracks(
        audioLanguages.map((a) => ({
          id: a.id,
          name: a.name,
          lang: a.code,
        }))
      );
    }
  }, [audioLanguages, audioTracks.length]);

  // Handle subtitle selection on video textTracks
  const switchSubtitle = (subUrl: string) => {
    setSelectedSubtitle(subUrl);
    const video = videoRef.current;
    if (!video) return;
    const tracks = video.textTracks;
    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i];
      if (subUrl === 'none') {
        t.mode = 'disabled';
      } else {
        const found = subtitles?.find((s) => s.url === subUrl);
        if (found && (t.language === found.lang || t.label === found.label)) {
          t.mode = 'showing';
        } else {
          t.mode = 'disabled';
        }
      }
    }
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const tracks = video.textTracks;
    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i];
      if (selectedSubtitle === 'none') {
        t.mode = 'disabled';
      } else {
        const found = subtitles?.find((s) => s.url === selectedSubtitle);
        if (found && (t.language === found.lang || t.label === found.label)) {
          t.mode = 'showing';
        } else {
          t.mode = 'disabled';
        }
      }
    }
  }, [selectedSubtitle, subtitles]);

  const setAudioTrack = (trackIndex: number) => {
    setCurrentAudioTrack(trackIndex);
    if (hlsRef.current && hlsRef.current.audioTracks && hlsRef.current.audioTracks.length > trackIndex) {
      hlsRef.current.audioTrack = trackIndex;
    } else if (onSwitchAudioTrack) {
      onSwitchAudioTrack(trackIndex);
    }
    setShowSettingsMenu(false);
  };

  const handleMouseMove = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying && !showSettingsMenu && !showChannelDrawer) {
        setShowControls(false);
      }
    }, 3500);
  };

  const handleContainerClick = () => {
    setShowControls((prev) => !prev);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying && !showSettingsMenu && !showChannelDrawer) {
        setShowControls(false);
      }
    }, 4000);
  };

  const formatTime = (seconds: number) => {
    if (!seconds || isNaN(seconds) || seconds === Infinity) return '0:00';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    if (hrs > 0) {
      return `${hrs}:${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
    }
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const filteredDrawerChannels = channels.filter((c) =>
    c.name.toLowerCase().includes(channelSearch.toLowerCase())
  );

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      className="fixed inset-0 z-50 bg-black flex items-center justify-center select-none overflow-hidden font-sans"
    >
      <video
        ref={videoRef}
        crossOrigin="anonymous"
        onTimeUpdate={() => {
          if (videoRef.current) {
            setProgress(videoRef.current.currentTime);
            setDuration(videoRef.current.duration || 0);
          }
        }}
        onWaiting={() => setIsLoading(true)}
        onPlaying={() => {
          setIsLoading(false);
          setIsPlaying(true);
        }}
        onClick={handleContainerClick}
        className={`w-full h-full cursor-pointer transition-all duration-200 ${
          aspectRatio === 'contain'
            ? 'object-contain'
            : aspectRatio === 'cover'
            ? 'object-cover'
            : 'object-fill'
        }`}
        playsInline
      >
        {subtitles.map((sub) => (
          <track
            key={sub.url}
            kind="subtitles"
            src={sub.url}
            srcLang={sub.lang}
            label={sub.label}
            default={selectedSubtitle === sub.url}
          />
        ))}
      </video>

      {/* Loading Spinner Overlay */}
      {isLoading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50 pointer-events-none">
          <Loader2 className="h-12 w-12 text-rose-500 animate-spin mb-3" />
          <p className="text-zinc-200 text-sm font-semibold tracking-wide">Cargando transmisión en vivo...</p>
        </div>
      )}

      {/* Error Alert Overlay */}
      {errorMessage && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 p-6 text-center z-30">
          <p className="text-rose-400 font-semibold mb-4 text-sm">{errorMessage}</p>
          <Button onClick={initHls} className="gap-2 bg-rose-600 hover:bg-rose-700 text-white">
            <RefreshCw className="h-4 w-4" /> Reintentar conexión
          </Button>
        </div>
      )}

      {/* Centered Large Play/Pause Touch Control */}
      {showControls && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
          <button
            onClick={(e) => {
              e.stopPropagation();
              togglePlay();
            }}
            className="pointer-events-auto h-16 w-16 sm:h-20 sm:w-20 rounded-full bg-black/60 backdrop-blur-md border border-white/20 flex items-center justify-center text-white hover:scale-110 active:scale-95 transition-all shadow-2xl cursor-pointer"
          >
            {isPlaying ? (
              <Pause className="h-8 w-8 sm:h-10 sm:w-10 fill-current" />
            ) : (
              <Play className="h-8 w-8 sm:h-10 sm:w-10 fill-current ml-1" />
            )}
          </button>
        </div>
      )}

      {/* Top Header Overlay */}
      <div
        className={`absolute top-0 left-0 right-0 p-4 sm:p-5 bg-gradient-to-b from-black/90 via-black/40 to-transparent flex items-center justify-between transition-opacity duration-300 z-20 ${
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div className="flex items-center gap-2.5 min-w-0 pr-2">
          {/* Back button for mobile & easy exit */}
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="rounded-full bg-black/60 hover:bg-zinc-800 text-white h-9 w-9 shrink-0 cursor-pointer"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>

          {isLive ? (
            <Badge variant="destructive" className="bg-red-600 font-bold px-2 py-0.5 tracking-wider animate-pulse shrink-0 text-[10px]">
              EN VIVO
            </Badge>
          ) : (
            <Badge variant="secondary" className="bg-zinc-800 text-zinc-300 font-bold px-2 py-0.5 tracking-wider shrink-0 text-[10px]">
              VOD
            </Badge>
          )}

          <div className="min-w-0">
            <h2 className="text-sm sm:text-base md:text-lg font-bold text-white tracking-wide truncate">{title}</h2>
            {subtitle && <p className="text-[11px] text-zinc-400 truncate">{subtitle}</p>}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Quick Channels Switcher Button (For Live TV) */}
          {channels.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowChannelDrawer(!showChannelDrawer)}
              className="gap-2 rounded-lg border-zinc-700 bg-zinc-900/80 text-zinc-200 hover:text-white text-xs h-9"
            >
              <ListVideo className="h-4 w-4 text-rose-500" />
              <span>Canales ({channels.length})</span>
            </Button>
          )}

          {/* Aspect Ratio Toggle */}
          <Button
            variant="ghost"
            size="sm"
            onClick={cycleAspectRatio}
            className="rounded-lg text-zinc-300 hover:text-white bg-zinc-900/60 hover:bg-zinc-800 text-xs px-2.5 h-9"
          >
            {aspectRatio === 'contain' ? 'Ajustar' : aspectRatio === 'cover' ? 'Rellenar' : 'Estirar'}
          </Button>

          {/* Close Player */}
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="rounded-full bg-zinc-900/80 hover:bg-zinc-800 text-zinc-300 hover:text-white h-9 w-9"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Quick Channels Sidebar Drawer (Inside Player) */}
      {showChannelDrawer && channels.length > 0 && (
        <div className="absolute top-0 right-0 bottom-0 w-80 bg-zinc-950/95 backdrop-blur-xl border-l border-zinc-800/80 z-40 p-4 flex flex-col shadow-2xl animate-in slide-in-from-right duration-200">
          <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
            <div className="flex items-center gap-2">
              <Tv className="h-4 w-4 text-rose-500" />
              <h3 className="text-sm font-bold text-white">Guía de Canales</h3>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowChannelDrawer(false)}
              className="h-7 w-7 text-zinc-400 hover:text-white"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="my-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500" />
              <Input
                placeholder="Buscar canal..."
                value={channelSearch}
                onChange={(e) => setChannelSearch(e.target.value)}
                className="pl-8 text-xs h-8 bg-zinc-900 border-zinc-800"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto space-y-1 pr-1">
            {filteredDrawerChannels.map((ch, idx) => (
              <div
                key={ch.channelCode || idx}
                onClick={() => {
                  if (onSelectChannel) onSelectChannel(ch);
                  setShowChannelDrawer(false);
                }}
                className="flex items-center gap-3 p-2 rounded-lg hover:bg-zinc-900 border border-transparent hover:border-zinc-800 transition-colors cursor-pointer group"
              >
                {ch.logo ? (
                  <img src={ch.logo} alt={ch.name} className="h-8 w-12 object-contain shrink-0" />
                ) : (
                  <div className="h-8 w-8 rounded-md bg-zinc-800 flex items-center justify-center shrink-0">
                    <Tv className="h-4 w-4 text-zinc-400" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-zinc-200 group-hover:text-white truncate">
                    {ch.name}
                  </p>
                  {ch.category && (
                    <span className="text-[10px] text-zinc-500 truncate block">{ch.category}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Settings Popup Menu (Quality & Audio) */}
      {showSettingsMenu && (
        <div className="absolute bottom-20 right-6 z-30 w-64 bg-zinc-950/95 backdrop-blur-xl border border-zinc-800 rounded-xl p-3 shadow-2xl space-y-3 animate-in fade-in duration-150">
          <div>
            <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2 px-1">
              Resolución / Calidad
            </h4>
            <div className="space-y-1 max-h-36 overflow-y-auto">
              <Button
                variant={currentLevel === -1 ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setQualityLevel(-1)}
                className="w-full justify-between text-xs h-7 px-2 font-medium"
              >
                <span>Automático (Adaptativo)</span>
                {currentLevel === -1 && <Check className="h-3.5 w-3.5 text-rose-500" />}
              </Button>
              {levels.map((lvl) => (
                <Button
                  key={lvl.id}
                  variant={currentLevel === lvl.id ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => setQualityLevel(lvl.id)}
                  className="w-full justify-between text-xs h-7 px-2 font-medium"
                >
                  <span>{lvl.height > 0 ? `${lvl.height}p` : `Nivel ${lvl.id + 1}`}</span>
                  {currentLevel === lvl.id && <Check className="h-3.5 w-3.5 text-rose-500" />}
                </Button>
              ))}
            </div>
          </div>

          {audioTracks.length > 0 && (
            <div className="pt-2 border-t border-zinc-800">
              <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2 px-1">
                Idioma / Audio
              </h4>
              <div className="space-y-1">
                {audioTracks.map((track) => (
                  <Button
                    key={track.id}
                    variant={currentAudioTrack === track.id ? 'secondary' : 'ghost'}
                    size="sm"
                    onClick={() => setAudioTrack(track.id)}
                    className="w-full justify-between text-xs h-7 px-2 font-medium"
                  >
                    <span>{track.name}</span>
                    {currentAudioTrack === track.id && <Check className="h-3.5 w-3.5 text-rose-500" />}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {subtitles.length > 0 && (
            <div className="pt-2 border-t border-zinc-800">
              <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2 px-1 flex items-center justify-between">
                <span>Subtítulos</span>
                <span className="text-[10px] text-zinc-500 font-normal lowercase">{subtitles.length} disponibles</span>
              </h4>
              <div className="space-y-1 max-h-36 overflow-y-auto">
                <Button
                  variant={selectedSubtitle === 'none' ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => switchSubtitle('none')}
                  className="w-full justify-between text-xs h-7 px-2 font-medium"
                >
                  <span>Desactivados</span>
                  {selectedSubtitle === 'none' && <Check className="h-3.5 w-3.5 text-rose-500" />}
                </Button>
                {subtitles.map((sub) => (
                  <Button
                    key={sub.url}
                    variant={selectedSubtitle === sub.url ? 'secondary' : 'ghost'}
                    size="sm"
                    onClick={() => switchSubtitle(sub.url)}
                    className="w-full justify-between text-xs h-7 px-2 font-medium"
                  >
                    <span>{sub.label}</span>
                    {selectedSubtitle === sub.url && <Check className="h-3.5 w-3.5 text-rose-500" />}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Bottom Controls Overlay */}
      <div
        className={`absolute bottom-0 left-0 right-0 p-5 bg-gradient-to-t from-black/95 via-black/60 to-transparent transition-opacity duration-300 z-20 ${
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Timeline Seekbar (for VOD/Movies/Series) */}
        {!isLive && duration > 0 && duration !== Infinity && (
          <div className="mb-3 space-y-1">
            <input
              type="range"
              min={0}
              max={duration}
              step={0.5}
              value={progress}
              onChange={(e) => {
                const seek = parseFloat(e.target.value);
                setProgress(seek);
                if (videoRef.current) videoRef.current.currentTime = seek;
              }}
              className="w-full h-1 bg-zinc-700/60 hover:h-2 accent-rose-500 rounded-lg cursor-pointer transition-all"
            />
            <div className="flex justify-between text-xs text-zinc-400 font-mono">
              <span>{formatTime(progress)}</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Play/Pause */}
            <Button
              variant="outline"
              size="icon"
              onClick={togglePlay}
              className="rounded-full bg-white text-zinc-950 hover:bg-zinc-200 border-none h-10 w-10 shrink-0"
            >
              {isPlaying ? <Pause className="h-5 w-5 fill-current" /> : <Play className="h-5 w-5 fill-current ml-0.5" />}
            </Button>

            {/* Skip 10s Backward / Forward (for VOD) */}
            {!isLive && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => skipSeconds(-10)}
                  className="text-zinc-300 hover:text-white rounded-full h-8 w-8"
                  title="Retroceder 10s"
                >
                  <RotateCcw className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => skipSeconds(10)}
                  className="text-zinc-300 hover:text-white rounded-full h-8 w-8"
                  title="Adelantar 10s"
                >
                  <RotateCw className="h-4 w-4" />
                </Button>
              </>
            )}

            {/* Volume Control */}
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" onClick={toggleMute} className="text-zinc-300 hover:text-white h-8 w-8">
                {isMuted || volume === 0 ? (
                  <VolumeX className="h-4 w-4 text-red-400" />
                ) : (
                  <Volume2 className="h-4 w-4" />
                )}
              </Button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={isMuted ? 0 : volume}
                onChange={handleVolumeChange}
                className="hidden md:block w-20 h-1 bg-zinc-700/60 accent-white rounded-lg cursor-pointer"
              />
            </div>
          </div>

          {/* Right Action Icons */}
          <div className="flex items-center gap-2">
            {/* Reconnect / Refresh */}
            <Button
              variant="ghost"
              size="icon"
              onClick={initHls}
              className="text-zinc-300 hover:text-white h-8 w-8"
              title="Recargar transmisión"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>

            {/* Subtitles Button (if available) */}
            {subtitles.length > 0 && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  if (selectedSubtitle === 'none') {
                    switchSubtitle(subtitles[0].url);
                  } else {
                    const currIdx = subtitles.findIndex((s) => s.url === selectedSubtitle);
                    if (currIdx === subtitles.length - 1) {
                      switchSubtitle('none');
                    } else {
                      switchSubtitle(subtitles[currIdx + 1].url);
                    }
                  }
                }}
                className={`h-8 w-8 cursor-pointer ${
                  selectedSubtitle !== 'none'
                    ? 'text-rose-400 bg-rose-500/10 hover:bg-rose-500/20'
                    : 'text-zinc-400 hover:text-white'
                }`}
                title={`Subtítulos: ${
                  selectedSubtitle === 'none'
                    ? 'Desactivados (clic para activar)'
                    : subtitles.find((s) => s.url === selectedSubtitle)?.label || 'Activados'
                }`}
              >
                <Subtitles className="h-4 w-4" />
              </Button>
            )}

            {/* PiP */}
            <Button
              variant="ghost"
              size="icon"
              onClick={togglePiP}
              className="text-zinc-300 hover:text-white h-8 w-8 cursor-pointer"
              title="Picture in Picture"
            >
              <PictureInPicture className="h-4 w-4" />
            </Button>

            {/* Settings Menu (Quality / Audio) */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowSettingsMenu(!showSettingsMenu)}
              className={`h-8 w-8 text-zinc-300 hover:text-white ${showSettingsMenu ? 'bg-zinc-800 text-white' : ''}`}
              title="Calidad y Audio"
            >
              <Settings className="h-4 w-4" />
            </Button>

            {/* Fullscreen */}
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleFullscreen}
              className="text-zinc-300 hover:text-white h-8 w-8"
              title="Pantalla Completa"
            >
              {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
