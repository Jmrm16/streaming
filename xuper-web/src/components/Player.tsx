import React, { useEffect, useRef, useState, useCallback } from 'react';
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
  Gauge,
  Sliders,
  AudioWaveform,
  AlertTriangle,
} from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from './ui/dialog';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from './ui/alert-dialog';
import { Channel, SubtitleTrack, AudioLanguage } from '../services/api';
import { MaicaoflixLogo } from './MaicaoflixLogo';

interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

function parseVttTime(timeStr: string): number {
  if (!timeStr) return -1;
  const cleaned = timeStr.trim().replace(',', '.');
  const parts = cleaned.split(':');
  if (parts.length === 3) {
    return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
  } else if (parts.length === 2) {
    return parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
  }
  return -1;
}

function parseVttCues(vttText: string): SubtitleCue[] {
  if (!vttText) return [];
  const lines = vttText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const result: SubtitleCue[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (line.includes('-->')) {
      const parts = line.split('-->');
      const start = parseVttTime(parts[0].trim().split(/\s+/)[0]);
      const end = parseVttTime(parts[1].trim().split(/\s+/)[0]);
      i++;
      let cueText = '';
      while (i < lines.length && lines[i].trim() !== '') {
        const clean = lines[i].replace(/<[^>]+>/g, '').trim();
        if (clean) {
          cueText += (cueText ? '\n' : '') + clean;
        }
        i++;
      }
      if (start >= 0 && end > start && cueText) {
        result.push({ start, end, text: cueText });
      }
    }
    i++;
  }
  return result;
}

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

const EMPTY_SUBTITLES: SubtitleTrack[] = [];
const EMPTY_AUDIO_LANGUAGES: AudioLanguage[] = [];
const EMPTY_CHANNELS: Channel[] = [];

export const Player: React.FC<PlayerProps> = ({
  url,
  title,
  subtitle,
  isLive = false,
  subtitles = EMPTY_SUBTITLES,
  audioLanguages = EMPTY_AUDIO_LANGUAGES,
  channels = EMPTY_CHANNELS,
  onSelectChannel,
  onSwitchAudioTrack,
  onClose,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const audioLanguagesRef = useRef<AudioLanguage[]>(audioLanguages);
  audioLanguagesRef.current = audioLanguages;
  const networkRetryRef = useRef<number>(0);

  // Playback states
  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);

  // Advanced features state
  const [aspectRatio, setAspectRatio] = useState<'contain' | 'cover' | 'fill'>('contain');
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [levels, setLevels] = useState<{ id: number; height: number; bitrate: number }[]>([]);
  const [currentLevel, setCurrentLevel] = useState<number>(-1); // -1 = Auto
  const [audioTracks, setAudioTracks] = useState<{ id: number; name: string; lang: string }[]>([]);
  const [currentAudioTrack, setCurrentAudioTrack] = useState<number>(0);

  // Subtitles
  const [selectedSubtitle, setSelectedSubtitle] = useState<string>('none');
  const [cues, setCues] = useState<SubtitleCue[]>([]);
  const [activeCueText, setActiveCueText] = useState<string | null>(null);

  // Modals & Panels
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'audio' | 'subtitles' | 'quality' | 'speed'>('audio');
  const [showChannelDrawer, setShowChannelDrawer] = useState(false);
  const [channelSearch, setChannelSearch] = useState('');
  const [errorAlert, setErrorAlert] = useState<{ open: boolean; message: string } | null>(null);

  const savedPositionRef = useRef<number>(0);
  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initialize and play HLS stream
  const initHls = useCallback(() => {
    const video = videoRef.current;
    if (!video || !url) return;

    setIsLoading(true);
    setErrorAlert(null);

    // Live TV streams must never inherit or seek to a previous VOD position
    if (isLive) {
      savedPositionRef.current = 0;
    }
    if (isLive || savedPositionRef.current === 0) {
      setDuration(0);
      setProgress(0);
      setBufferedEnd(0);
    }

    // Always clean up previous instance so Live TV and VOD get their exact configurations
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    if (Hls.isSupported() && (url.includes('.m3u8') || !url.endsWith('.mp4'))) {
      const hlsConfig: any = isLive
        ? {
            enableWorker: true,
            lowLatencyMode: false,
            backBufferLength: 30,
            liveSyncDurationCount: 4,
            liveMaxLatencyDurationCount: 12,
            maxLiveSyncPlaybackRate: 1.05,
            maxBufferLength: 45,
            maxMaxBufferLength: 90,
            maxBufferHole: 0.5,
            highBufferWatchdogPeriod: 2,
            liveDurationInfinity: true,
            manifestLoadingTimeOut: 15000,
            manifestLoadingMaxRetry: 8,
            manifestLoadingRetryDelay: 800,
            levelLoadingTimeOut: 15000,
            levelLoadingMaxRetry: 8,
            levelLoadingRetryDelay: 800,
            fragLoadingTimeOut: 20000,
            fragLoadingMaxRetry: 10,
            fragLoadingRetryDelay: 600,
            nudgeOffset: 0.25,
            nudgeMaxRetry: 10,
          }
        : {
            enableWorker: true,
            lowLatencyMode: false, // Critical: lowLatencyMode must be false for smooth VOD seeking & playback
            backBufferLength: 90,
            maxBufferLength: 60,
            maxMaxBufferLength: 120,
            manifestLoadingTimeOut: 18000,
            manifestLoadingMaxRetry: 5,
            levelLoadingTimeOut: 18000,
            levelLoadingMaxRetry: 5,
            fragLoadingTimeOut: 25000,
            fragLoadingMaxRetry: 6,
            fragLoadingRetryDelay: 600,
          };

      const hls = new Hls(hlsConfig);
      hlsRef.current = hls;

      hls.loadSource(url);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
        networkRetryRef.current = 0;
        setIsLoading(false);
        if (data.levels && data.levels.length > 0) {
          const lvls = data.levels.map((lvl, index) => ({
            id: index,
            height: lvl.height || 0,
            bitrate: lvl.bitrate || 0,
          }));
          setLevels(lvls);
        }
        // Only restore timestamp for VOD; Live TV stays on live edge
        if (!isLive) {
          const restorePos = savedPositionRef.current;
          if (restorePos > 0) {
            video.currentTime = restorePos;
          }
        }
        attemptPlay(video);
      });

      hls.on(Hls.Events.LEVEL_LOADED, (_, data) => {
        networkRetryRef.current = 0;
        if (data.details && data.details.totalduration && isFinite(data.details.totalduration)) {
          setDuration((prev) => Math.max(prev, data.details.totalduration));
        }
      });

      hls.on(Hls.Events.LEVEL_UPDATED, (_, data) => {
        networkRetryRef.current = 0;
        if (data.details && data.details.totalduration && isFinite(data.details.totalduration)) {
          setDuration((prev) => Math.max(prev, data.details.totalduration));
        }
      });

      hls.on(Hls.Events.FRAG_LOADED, () => {
        networkRetryRef.current = 0;
        setIsLoading(false);
      });

      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, (_, data) => {
        if (data.audioTracks && data.audioTracks.length > 0) {
          const langs = audioLanguagesRef.current;
          setAudioTracks(
            data.audioTracks.map((t, idx) => ({
              id: idx,
              name: t.name || langs?.[idx]?.name || `Pista ${idx + 1}`,
              lang: t.lang || langs?.[idx]?.code || '',
            }))
          );
        }
      });

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          const maxRetries = isLive ? 8 : 4;
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              if (networkRetryRef.current < maxRetries) {
                networkRetryRef.current += 1;
                console.warn(`HLS Network Error, attempting recovery (${networkRetryRef.current}/${maxRetries})...`);
                setTimeout(() => {
                  if (hlsRef.current === hls) {
                    hls.startLoad();
                  }
                }, Math.min(2500, 600 * networkRetryRef.current));
              } else {
                console.error('Fatal HLS Network Error after retries:', data);
                setIsLoading(false);
                setErrorAlert({
                  open: true,
                  message:
                    'No se pudo conectar con la señal de video en este momento. Intenta recargar o cambiar de canal.',
                });
                hls.destroy();
              }
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.warn('HLS Media Error, attempting recovery...');
              hls.recoverMediaError();
              break;
            default:
              console.error('Fatal HLS Error:', data);
              setIsLoading(false);
              setErrorAlert({
                open: true,
                message:
                  'No se pudo reproducir la transmisión. Esto puede deberse a un problema de conexión con el servidor o al formato de video.',
              });
              hls.destroy();
              break;
          }
        } else if (data.details === Hls.ErrorDetails.BUFFER_STALLED_ERROR && isLive) {
          // Auto-unstall live TV signal by jumping across any buffer hole or nudging forward
          if (video && !video.paused) {
            const ct = video.currentTime;
            const buf = video.buffered;
            let jumped = false;
            for (let i = 0; i < buf.length; i++) {
              if (buf.start(i) > ct + 0.05) {
                video.currentTime = buf.start(i) + 0.1;
                jumped = true;
                break;
              }
            }
            if (!jumped) {
              video.currentTime = ct + 0.25;
            }
          }
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl') || url.endsWith('.mp4')) {
      // Native Apple HLS / MP4 (Safari, iOS, TV browsers)
      video.src = url;
      video.addEventListener(
        'loadedmetadata',
        () => {
          setIsLoading(false);
          if (!isLive && savedPositionRef.current > 0) {
            video.currentTime = savedPositionRef.current;
          }
          attemptPlay(video);
        },
        { once: true }
      );
    }
  }, [url, isLive]);

  // Resilient play with unmuted -> muted autoplay fallback
  const attemptPlay = (video: HTMLVideoElement) => {
    const promise = video.play();
    if (promise !== undefined) {
      promise
        .then(() => {
          setIsPlaying(true);
          setAutoplayBlocked(false);
        })
        .catch((err) => {
          if (err?.name === 'AbortError') {
            return;
          }
          console.warn('Browser blocked unmuted playback, retrying muted:', err);
          video.muted = true;
          setIsMuted(true);
          video
            .play()
            .then(() => {
              setIsPlaying(true);
              setAutoplayBlocked(true);
            })
            .catch((err2) => {
              if (err2?.name === 'AbortError') {
                return;
              }
              console.warn('Muted autoplay also rejected:', err2);
              setIsPlaying(false);
            });
        });
    }
  };

  // Mount/Unmount stream
  useEffect(() => {
    initHls();
    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [initHls]);

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

  // Fetch and parse subtitle cues for elevated subtitle overlay
  useEffect(() => {
    if (!selectedSubtitle || selectedSubtitle === 'none') {
      setCues([]);
      setActiveCueText(null);
      return;
    }

    let isMounted = true;
    fetch(selectedSubtitle)
      .then((res) => res.text())
      .then((text) => {
        if (!isMounted) return;
        const parsed = parseVttCues(text);
        setCues(parsed);
      })
      .catch((err) => {
        console.warn('Error fetching subtitle file:', err);
        if (isMounted) setCues([]);
      });

    return () => {
      isMounted = false;
    };
  }, [selectedSubtitle]);

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept typing in inputs
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }

      switch (e.key) {
        case ' ':
        case 'k':
        case 'K':
          e.preventDefault();
          togglePlay();
          break;
        case 'f':
        case 'F':
          e.preventDefault();
          toggleFullscreen();
          break;
        case 'm':
        case 'M':
          e.preventDefault();
          toggleMute();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          skipSeconds(-10);
          break;
        case 'ArrowRight':
          e.preventDefault();
          skipSeconds(10);
          break;
        case 'ArrowUp':
          e.preventDefault();
          adjustVolume(0.1);
          break;
        case 'ArrowDown':
          e.preventDefault();
          adjustVolume(-0.1);
          break;
        case 'Escape':
          if (showSettingsDialog) {
            setShowSettingsDialog(false);
          } else if (showChannelDrawer) {
            setShowChannelDrawer(false);
          } else if (errorAlert) {
            setErrorAlert(null);
          } else {
            onClose();
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showSettingsDialog, showChannelDrawer, errorAlert, isPlaying, isMuted, volume, duration]);

  // Playback actions
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
    const newMuted = !isMuted;
    videoRef.current.muted = newMuted;
    setIsMuted(newMuted);
    if (!newMuted && autoplayBlocked) {
      setAutoplayBlocked(false);
    }
  };

  const unmuteAndPlay = () => {
    if (!videoRef.current) return;
    videoRef.current.muted = false;
    setIsMuted(false);
    setAutoplayBlocked(false);
    videoRef.current.play().catch(() => {});
  };

  const adjustVolume = (delta: number) => {
    if (!videoRef.current) return;
    const newVol = Math.max(0, Math.min(1, volume + delta));
    setVolume(newVol);
    videoRef.current.volume = newVol;
    videoRef.current.muted = newVol === 0;
    setIsMuted(newVol === 0);
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
    const maxDur = duration > 0 ? duration : (videoRef.current.duration || 0);
    videoRef.current.currentTime = Math.max(0, Math.min(maxDur, videoRef.current.currentTime + seconds));
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
  };

  const changePlaybackRate = (rate: number) => {
    setPlaybackRate(rate);
    if (videoRef.current) {
      videoRef.current.playbackRate = rate;
    }
  };

  const switchSubtitle = (subUrl: string) => {
    setSelectedSubtitle(subUrl);
    if (subUrl === 'none') {
      setCues([]);
      setActiveCueText(null);
    }
  };

  const setAudioTrack = (trackIndex: number) => {
    setCurrentAudioTrack(trackIndex);

    const video = videoRef.current;
    const currentPos = video ? video.currentTime : savedPositionRef.current;
    if (currentPos > 0) {
      savedPositionRef.current = currentPos;
    }

    // 1. Instantaneous in-stream HLS audio track change if native multi-track HLS is present
    if (
      hlsRef.current &&
      hlsRef.current.audioTracks &&
      hlsRef.current.audioTracks.length > 1 &&
      trackIndex < hlsRef.current.audioTracks.length
    ) {
      hlsRef.current.audioTrack = trackIndex;
      return;
    }

    // 2. Seamless in-place source reload with audio PID swapping from proxy (zero unmount, zero full reload)
    if (hlsRef.current) {
      const [base, query] = url.split('?');
      const searchParams = new URLSearchParams(query || '');
      if (trackIndex > 0) {
        searchParams.set('audio', String(trackIndex));
      } else {
        searchParams.delete('audio');
      }
      const targetUrl = searchParams.toString() ? `${base}?${searchParams.toString()}` : base;

      if (hlsRef.current.url === targetUrl) return;

      const wasPlaying = isPlaying;
      hlsRef.current.loadSource(targetUrl);
      hlsRef.current.once(Hls.Events.MANIFEST_PARSED, () => {
        if (videoRef.current) {
          if (currentPos > 0) {
            videoRef.current.currentTime = currentPos;
          }
          if (wasPlaying) {
            videoRef.current.play().catch(() => {});
          }
        }
      });
      return;
    }

    // 3. Fallback for native HTML5 video (Safari / mobile)
    if (video) {
      const [base, query] = url.split('?');
      const searchParams = new URLSearchParams(query || '');
      if (trackIndex > 0) {
        searchParams.set('audio', String(trackIndex));
      } else {
        searchParams.delete('audio');
      }
      const targetUrl = searchParams.toString() ? `${base}?${searchParams.toString()}` : base;
      const wasPlaying = !video.paused;
      video.src = targetUrl;
      video.addEventListener(
        'loadedmetadata',
        () => {
          if (currentPos > 0) {
            video.currentTime = currentPos;
          }
          if (wasPlaying) {
            video.play().catch(() => {});
          }
        },
        { once: true }
      );
    }
  };

  // Controls timer management
  const resetControlsTimer = useCallback(() => {
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying && !showSettingsDialog && !showChannelDrawer) {
        setShowControls(false);
      }
    }, 4500);
  }, [isPlaying, showSettingsDialog, showChannelDrawer]);

  const wakeControls = useCallback(() => {
    setShowControls(true);
    resetControlsTimer();
  }, [resetControlsTimer]);

  // Double tap to seek state & visual feedback
  const [seekFeedback, setSeekFeedback] = useState<{
    side: 'left' | 'right';
    label: string;
  } | null>(null);
  const seekFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTapRef = useRef<{ time: number; x: number }>({ time: 0, x: 0 });

  const showDoubleTapFeedback = (side: 'left' | 'right', label: string) => {
    setSeekFeedback({ side, label });
    if (seekFeedbackTimerRef.current) clearTimeout(seekFeedbackTimerRef.current);
    seekFeedbackTimerRef.current = setTimeout(() => {
      setSeekFeedback(null);
    }, 750);
  };

  const handleScreenInteraction = (clientX?: number) => {
    const now = Date.now();
    const timeSinceLastTap = now - lastTapRef.current.time;

    // Double tap handling if clientX is provided and not live stream
    if (clientX !== undefined && timeSinceLastTap < 320 && !isLive && duration > 0) {
      const screenWidth = window.innerWidth || document.documentElement.clientWidth;
      if (clientX < screenWidth * 0.38) {
        // Double tap left: Rewind 10s
        skipSeconds(-10);
        showDoubleTapFeedback('left', '-10s');
        lastTapRef.current = { time: 0, x: 0 };
        wakeControls();
        return;
      } else if (clientX > screenWidth * 0.62) {
        // Double tap right: Fast forward 10s
        skipSeconds(10);
        showDoubleTapFeedback('right', '+10s');
        lastTapRef.current = { time: 0, x: 0 };
        wakeControls();
        return;
      }
    }

    if (clientX !== undefined) {
      lastTapRef.current = { time: now, x: clientX };
    }

    // Single click / tap toggle
    if (!showControls) {
      wakeControls();
    } else {
      setShowControls(false);
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    }
  };

  const handleMouseMove = () => {
    wakeControls();
  };

  const handleContainerClick = () => {
    handleScreenInteraction();
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
      onTouchStart={handleMouseMove}
      onClick={(e) => {
        if (e.target === containerRef.current) {
          handleScreenInteraction();
        }
      }}
      className="fixed inset-0 z-50 bg-black flex items-center justify-center select-none overflow-hidden font-sans"
    >
      <video
        ref={videoRef}
        crossOrigin="anonymous"
        autoPlay
        playsInline
        onTimeUpdate={() => {
          if (videoRef.current) {
            const cur = videoRef.current.currentTime;
            setProgress(cur);
            const vidDur = videoRef.current.duration;
            if (vidDur && isFinite(vidDur) && vidDur > 0) {
              setDuration((prev) => Math.max(prev, vidDur));
            }
            savedPositionRef.current = cur;

            // Buffered range indicator
            if (videoRef.current.buffered.length > 0) {
              setBufferedEnd(videoRef.current.buffered.end(videoRef.current.buffered.length - 1));
            }

            // Real-time subtitle cue lookup
            if (cues.length > 0 && selectedSubtitle !== 'none') {
              const match = cues.find((c) => cur >= c.start && cur <= c.end);
              const txt = match ? match.text : null;
              if (txt !== activeCueText) {
                setActiveCueText(txt);
              }
            } else if (activeCueText) {
              setActiveCueText(null);
            }
          }
        }}
        onWaiting={() => setIsLoading(true)}
        onPlaying={() => {
          setIsLoading(false);
          setIsPlaying(true);
        }}
        className={`w-full h-full transition-all duration-200 pointer-events-none select-none ${
          aspectRatio === 'contain'
            ? 'object-contain'
            : aspectRatio === 'cover'
            ? 'object-cover'
            : 'object-fill'
        }`}
      />

      {/* Interactive Fullscreen Touch & Click Surface Layer */}
      <div
        className="absolute inset-0 z-10 cursor-pointer"
        onClick={(e) => {
          handleScreenInteraction(e.clientX);
        }}
        onTouchEnd={(e) => {
          if (e.changedTouches && e.changedTouches[0]) {
            handleScreenInteraction(e.changedTouches[0].clientX);
          } else {
            handleScreenInteraction();
          }
        }}
      />

      {/* Double Tap Seek Feedback Ripple */}
      {seekFeedback && (
        <div
          className={`absolute top-1/2 -translate-y-1/2 z-30 pointer-events-none flex flex-col items-center justify-center ${
            seekFeedback.side === 'left' ? 'left-12 sm:left-24' : 'right-12 sm:right-24'
          }`}
        >
          <div className="flex flex-col items-center justify-center w-24 h-24 sm:w-28 sm:h-28 rounded-full bg-black/75 backdrop-blur-md border border-white/20 animate-pulse shadow-2xl text-white">
            {seekFeedback.side === 'left' ? (
              <RotateCcw className="w-8 h-8 text-white mb-1" />
            ) : (
              <RotateCw className="w-8 h-8 text-white mb-1" />
            )}
            <span className="text-white font-bold text-sm">{seekFeedback.label}</span>
          </div>
        </div>
      )}

      {/* Elevated High-Visibility Netflix-Style Subtitle Overlay */}
      {activeCueText && selectedSubtitle !== 'none' && (
        <div
          className={`absolute left-0 right-0 flex justify-center pointer-events-none z-30 px-6 sm:px-12 transition-all duration-200 ${
            showControls ? 'bottom-28 sm:bottom-32' : 'bottom-12 sm:bottom-16'
          }`}
        >
          <div
            className="bg-black/85 text-white font-semibold text-base sm:text-xl md:text-2xl px-5 py-2.5 rounded-lg shadow-2xl text-center max-w-[90%] sm:max-w-[80%] whitespace-pre-line leading-relaxed tracking-wide border border-white/10 backdrop-blur-sm select-none"
            style={{
              textShadow: '0 2px 4px rgba(0,0,0,0.95), 0 0 2px rgba(0,0,0,0.9)',
            }}
          >
            {activeCueText}
          </div>
        </div>
      )}

      {/* Loading Spinner Overlay */}
      {isLoading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 pointer-events-none z-30">
          <div className="w-12 h-12 rounded-full border-4 border-white/20 border-t-[#e50914] animate-spin mb-3" />
          <p className="text-zinc-200 text-sm font-semibold tracking-wide">Cargando...</p>
        </div>
      )}

      {/* Autoplay Blocked Floating Pill (Unmute prompt) */}
      {autoplayBlocked && (
        <button
          type="button"
          onClick={unmuteAndPlay}
          className="absolute top-20 left-1/2 -translate-x-1/2 z-40 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-red-600 hover:bg-red-700 text-white font-bold text-xs shadow-2xl animate-bounce cursor-pointer"
        >
          <VolumeX className="w-4 h-4" />
          <span>El navegador silenció el audio — Haz clic aquí para activar el sonido</span>
        </button>
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
        onClick={(e) => {
          e.stopPropagation();
          resetControlsTimer();
        }}
        className={`absolute top-0 left-0 right-0 p-4 sm:p-5 bg-gradient-to-b from-black/95 via-black/50 to-transparent flex items-center justify-between transition-opacity duration-300 z-20 ${
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div className="flex items-center gap-3 min-w-0 pr-2">
          {/* Back button */}
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="rounded-full bg-black/60 hover:bg-zinc-800 text-white h-9 w-9 shrink-0 cursor-pointer"
            title="Volver"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>

          <MaicaoflixLogo width={100} height={22} className="hidden sm:block ml-1 mr-2" />

          {isLive ? (
            <Badge variant="destructive" className="bg-red-600 font-bold px-2 py-0.5 tracking-wider shrink-0 text-[10px]">
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
          {/* Quick Channels Guide for Live TV */}
          {channels.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowChannelDrawer(!showChannelDrawer)}
              className="gap-2 rounded-lg border-zinc-700 bg-zinc-900/80 text-zinc-200 hover:text-white text-xs h-9"
            >
              <ListVideo className="h-4 w-4 text-red-500" />
              <span>Canales ({channels.length})</span>
            </Button>
          )}

          {/* Aspect Ratio Cycler */}
          <Button
            variant="ghost"
            size="sm"
            onClick={cycleAspectRatio}
            className="rounded-lg text-zinc-300 hover:text-white bg-zinc-900/60 hover:bg-zinc-800 text-xs px-2.5 h-9"
            title="Cambiar relación de aspecto"
          >
            {aspectRatio === 'contain' ? 'Ajustar' : aspectRatio === 'cover' ? 'Rellenar' : 'Estirar'}
          </Button>

          {/* Close Player */}
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="rounded-full bg-zinc-900/80 hover:bg-zinc-800 text-zinc-300 hover:text-white h-9 w-9"
            title="Cerrar reproductor"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Quick Channels Sidebar Drawer (For Live TV) */}
      {showChannelDrawer && channels.length > 0 && (
        <div className="absolute top-0 right-0 bottom-0 w-80 bg-zinc-950/95 backdrop-blur-xl border-l border-zinc-800/80 z-40 p-4 flex flex-col shadow-2xl animate-in slide-in-from-right duration-200">
          <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
            <div className="flex items-center gap-2">
              <Tv className="h-4 w-4 text-red-500" />
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
                className="pl-8 text-xs h-8 bg-zinc-900 border-zinc-800 text-white"
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

      {/* Bottom Controls Overlay */}
      <div
        onClick={(e) => {
          e.stopPropagation();
          resetControlsTimer();
        }}
        className={`absolute bottom-0 left-0 right-0 p-5 bg-gradient-to-t from-black/95 via-black/70 to-transparent transition-opacity duration-300 z-20 ${
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Timeline Seekbar (for VOD/Movies/Series) */}
        {!isLive && duration > 0 && duration !== Infinity && (
          <div className="mb-3 space-y-1.5">
            <div className="relative w-full h-1.5 bg-zinc-700/70 hover:h-2 rounded-full cursor-pointer group transition-all flex items-center">
              {/* Buffered progress */}
              {bufferedEnd > 0 && (
                <div
                  className="absolute top-0 bottom-0 left-0 bg-zinc-400/35 rounded-full pointer-events-none transition-all duration-150"
                  style={{ width: `${Math.min(100, (bufferedEnd / duration) * 100)}%` }}
                />
              )}
              {/* Played progress */}
              <div
                className="absolute top-0 bottom-0 left-0 bg-[#e50914] rounded-full pointer-events-none"
                style={{ width: `${Math.min(100, (progress / duration) * 100)}%` }}
              />
              {/* Scrubber Thumb */}
              <div
                className="absolute h-3.5 w-3.5 rounded-full bg-[#e50914] shadow-md pointer-events-none -translate-x-1/2 transition-transform group-hover:scale-125"
                style={{ left: `${Math.min(100, Math.max(0, (progress / duration) * 100))}%` }}
              />
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
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
            </div>
            <div className="flex justify-between text-xs text-zinc-300 font-mono">
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
              className="rounded-full bg-white text-zinc-950 hover:bg-zinc-200 border-none h-10 w-10 shrink-0 cursor-pointer shadow-lg"
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
                  className="text-zinc-300 hover:text-white rounded-full h-8 w-8 cursor-pointer"
                  title="Retroceder 10s"
                >
                  <RotateCcw className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => skipSeconds(10)}
                  className="text-zinc-300 hover:text-white rounded-full h-8 w-8 cursor-pointer"
                  title="Adelantar 10s"
                >
                  <RotateCw className="h-4 w-4" />
                </Button>
              </>
            )}

            {/* Volume Control */}
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleMute}
                className="text-zinc-300 hover:text-white h-8 w-8 cursor-pointer"
              >
                {isMuted || volume === 0 ? (
                  <VolumeX className="h-4 w-4 text-red-500" />
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
              className="text-zinc-300 hover:text-white h-8 w-8 cursor-pointer"
              title="Recargar transmisión"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>

            {/* Subtitles Quick Toggle */}
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
                    ? 'text-red-500 bg-red-950/40 hover:bg-red-950/60'
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

            {/* Picture in Picture */}
            <Button
              variant="ghost"
              size="icon"
              onClick={togglePiP}
              className="text-zinc-300 hover:text-white h-8 w-8 cursor-pointer"
              title="Picture in Picture"
            >
              <PictureInPicture className="h-4 w-4" />
            </Button>

            {/* Settings Dialog Trigger */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowSettingsDialog(true)}
              className="h-8 w-8 text-zinc-300 hover:text-white cursor-pointer"
              title="Audio, Subtítulos y Calidad"
            >
              <Settings className="h-4 w-4" />
            </Button>

            {/* Fullscreen */}
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleFullscreen}
              className="text-zinc-300 hover:text-white h-8 w-8 cursor-pointer"
              title="Pantalla Completa"
            >
              {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>

      {/* ============================================================ */}
      {/* SHADCN DIALOG: Audio, Subtitles, Quality & Speed             */}
      {/* ============================================================ */}
      <Dialog open={showSettingsDialog} onOpenChange={setShowSettingsDialog}>
        <DialogContent className="max-w-md bg-zinc-950 border-zinc-800 text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold">
              <Sliders className="h-4 w-4 text-red-500" />
              <span>Ajustes de Reproducción</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-zinc-400">
              Personaliza el audio, subtítulos, resolución y velocidad.
            </DialogDescription>
          </DialogHeader>

          {/* Navigation Tabs */}
          <div className="grid grid-cols-4 gap-1 p-1 bg-zinc-900 rounded-lg text-xs font-semibold">
            <button
              type="button"
              onClick={() => setSettingsTab('audio')}
              className={`py-1.5 rounded-md transition-all cursor-pointer ${
                settingsTab === 'audio'
                  ? 'bg-zinc-800 text-white shadow'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Audio
            </button>
            <button
              type="button"
              onClick={() => setSettingsTab('subtitles')}
              className={`py-1.5 rounded-md transition-all cursor-pointer ${
                settingsTab === 'subtitles'
                  ? 'bg-zinc-800 text-white shadow'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Subtítulos
            </button>
            <button
              type="button"
              onClick={() => setSettingsTab('quality')}
              className={`py-1.5 rounded-md transition-all cursor-pointer ${
                settingsTab === 'quality'
                  ? 'bg-zinc-800 text-white shadow'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Calidad
            </button>
            <button
              type="button"
              onClick={() => setSettingsTab('speed')}
              className={`py-1.5 rounded-md transition-all cursor-pointer ${
                settingsTab === 'speed'
                  ? 'bg-zinc-800 text-white shadow'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Velocidad
            </button>
          </div>

          {/* Tab 1: Audio */}
          {settingsTab === 'audio' && (
            <div className="py-2 space-y-1.5 max-h-56 overflow-y-auto pr-1">
              {audioTracks.length === 0 ? (
                <p className="text-xs text-zinc-500 italic py-4 text-center">
                  Solo una pista de audio disponible en esta transmisión.
                </p>
              ) : (
                audioTracks.map((track) => (
                  <Button
                    key={track.id}
                    variant={currentAudioTrack === track.id ? 'secondary' : 'ghost'}
                    size="sm"
                    onClick={() => {
                      setAudioTrack(track.id);
                      setShowSettingsDialog(false);
                    }}
                    className="w-full justify-between text-xs h-9 px-3 font-medium cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <AudioWaveform className="h-3.5 w-3.5 text-zinc-400" />
                      <span>{track.name}</span>
                    </div>
                    {currentAudioTrack === track.id && (
                      <Check className="h-4 w-4 text-red-500 font-bold" />
                    )}
                  </Button>
                ))
              )}
            </div>
          )}

          {/* Tab 2: Subtítulos */}
          {settingsTab === 'subtitles' && (
            <div className="py-2 space-y-1.5 max-h-56 overflow-y-auto pr-1">
              <Button
                variant={selectedSubtitle === 'none' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => {
                  switchSubtitle('none');
                  setShowSettingsDialog(false);
                }}
                className="w-full justify-between text-xs h-9 px-3 font-medium cursor-pointer"
              >
                <span>Desactivados</span>
                {selectedSubtitle === 'none' && (
                  <Check className="h-4 w-4 text-red-500 font-bold" />
                )}
              </Button>
              {subtitles.map((sub) => (
                <Button
                  key={sub.url}
                  variant={selectedSubtitle === sub.url ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => {
                    switchSubtitle(sub.url);
                    setShowSettingsDialog(false);
                  }}
                  className="w-full justify-between text-xs h-9 px-3 font-medium cursor-pointer"
                >
                  <span>{sub.label}</span>
                  {selectedSubtitle === sub.url && (
                    <Check className="h-4 w-4 text-red-500 font-bold" />
                  )}
                </Button>
              ))}
              {subtitles.length === 0 && (
                <p className="text-xs text-zinc-500 italic py-4 text-center">
                  No hay subtítulos externos disponibles para este contenido.
                </p>
              )}
            </div>
          )}

          {/* Tab 3: Calidad */}
          {settingsTab === 'quality' && (
            <div className="py-2 space-y-1.5 max-h-56 overflow-y-auto pr-1">
              <Button
                variant={currentLevel === -1 ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => {
                  setQualityLevel(-1);
                  setShowSettingsDialog(false);
                }}
                className="w-full justify-between text-xs h-9 px-3 font-medium cursor-pointer"
              >
                <span>Automático (Adaptativo)</span>
                {currentLevel === -1 && <Check className="h-4 w-4 text-red-500 font-bold" />}
              </Button>
              {levels.map((lvl) => (
                <Button
                  key={lvl.id}
                  variant={currentLevel === lvl.id ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => {
                    setQualityLevel(lvl.id);
                    setShowSettingsDialog(false);
                  }}
                  className="w-full justify-between text-xs h-9 px-3 font-medium cursor-pointer"
                >
                  <span>{lvl.height > 0 ? `${lvl.height}p` : `Nivel ${lvl.id + 1}`}</span>
                  {currentLevel === lvl.id && (
                    <Check className="h-4 w-4 text-red-500 font-bold" />
                  )}
                </Button>
              ))}
            </div>
          )}

          {/* Tab 4: Velocidad */}
          {settingsTab === 'speed' && (
            <div className="py-2 space-y-1.5 max-h-56 overflow-y-auto pr-1">
              {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => (
                <Button
                  key={rate}
                  variant={playbackRate === rate ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => {
                    changePlaybackRate(rate);
                    setShowSettingsDialog(false);
                  }}
                  className="w-full justify-between text-xs h-9 px-3 font-medium cursor-pointer"
                >
                  <span>{rate === 1 ? '1.0x (Normal)' : `${rate}x`}</span>
                  {playbackRate === rate && (
                    <Check className="h-4 w-4 text-red-500 font-bold" />
                  )}
                </Button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ============================================================ */}
      {/* SHADCN ALERT DIALOG: Fatal Playback Errors                   */}
      {/* ============================================================ */}
      {errorAlert && (
        <AlertDialog open={errorAlert.open} onOpenChange={(open) => !open && setErrorAlert(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <div className="flex items-center gap-2 text-red-500 mb-1">
                <AlertTriangle className="h-5 w-5" />
                <AlertDialogTitle>Error de reproducción</AlertDialogTitle>
              </div>
              <AlertDialogDescription>{errorAlert.message}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={onClose}>Cerrar reproductor</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  setErrorAlert(null);
                  initHls();
                }}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                Reintentar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
};

export default Player;
