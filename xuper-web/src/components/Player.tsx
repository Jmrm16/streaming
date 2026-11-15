import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
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
  SkipForward,
  SkipBack,
  Lock,
  Unlock,
  Sun,
  Sparkles,
  Layers,
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
import { api, Channel, SubtitleTrack, AudioLanguage, Episode, Season } from '../services/api';
import { EpisodeProgressEntry } from '../lib/firebase';
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

interface PlayerEpisodeMeta {
  seasonId: string;
  seasonNumber: number;
  episodeNumber: number;
  episodeTitle: string;
  seasons?: Season[];
  episodes?: Episode[];
}

interface PlayerProps {
  url: string;
  title: string;
  subtitle?: string;
  isLive?: boolean;
  initialTime?: number;
  subtitles?: SubtitleTrack[];
  audioLanguages?: AudioLanguage[];
  channels?: Channel[];
  contentId?: string;
  seriesId?: string;
  rootSeriesId?: string;
  episodeMeta?: PlayerEpisodeMeta;
  episodeProgressMap?: Record<string, EpisodeProgressEntry>;
  onSelectChannel?: (channel: Channel) => void;
  onSelectEpisode?: (
    ep: Episode,
    seasonId: string,
    seasonNumber: number,
    seasonsList?: Season[],
    episodesList?: Episode[]
  ) => Promise<void> | void;
  onSwitchAudioTrack?: (trackIndex: number) => void;
  onProgressUpdate?: (currentTime: number, duration: number) => void;
  onRefreshStream?: () => Promise<void> | void;
  onClose: () => void;
}

export const cleanEpisodeTitleText = (raw: string): string => {
  if (!raw) return '';
  return (
    raw
      .replace(/^.*?T\d+[-_ ]*E?\d*[:\-_ ]*/i, '')
      .replace(/^Capítulo\s*\d+[:\-_ ]*/i, '')
      .trim() || raw
  );
};

const EMPTY_SUBTITLES: SubtitleTrack[] = [];
const EMPTY_AUDIO_LANGUAGES: AudioLanguage[] = [];
const EMPTY_CHANNELS: Channel[] = [];

const hasExtension = (source: string, extension: string): boolean => {
  try {
    return new URL(source, window.location.href).pathname.toLowerCase().endsWith(extension);
  } catch {
    return source.split(/[?#]/)[0].toLowerCase().endsWith(extension);
  }
};

const formatPlayerTime = (seconds: number): string => {
  if (!seconds || isNaN(seconds) || seconds === Infinity) return '0:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) {
    return `${hrs}:${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
};

export const Player: React.FC<PlayerProps> = ({
  url,
  title,
  subtitle,
  isLive = false,
  initialTime = 0,
  subtitles = EMPTY_SUBTITLES,
  audioLanguages = EMPTY_AUDIO_LANGUAGES,
  channels = EMPTY_CHANNELS,
  contentId,
  seriesId,
  rootSeriesId,
  episodeMeta,
  episodeProgressMap,
  onSelectChannel,
  onSelectEpisode,
  onSwitchAudioTrack,
  onProgressUpdate,
  onRefreshStream,
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
  const [resumeBanner, setResumeBanner] = useState<string | null>(null);

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
  const [settingsTab, setSettingsTab] = useState<'audio' | 'subtitles' | 'quality' | 'speed' | 'image'>('audio');
  const [showChannelDrawer, setShowChannelDrawer] = useState(false);
  const [channelSearch, setChannelSearch] = useState('');
  const [errorAlert, setErrorAlert] = useState<{ open: boolean; message: string } | null>(null);

  // Series Episode Switcher & Auto-Next
  const isSeriesPlayback = Boolean(!isLive && onSelectEpisode && (episodeMeta || seriesId));
  const currentSeasonId = episodeMeta?.seasonId || seriesId || '';
  const currentSeasonNumber = episodeMeta?.seasonNumber || 1;
  const [seasonsList, setSeasonsList] = useState<Season[]>(episodeMeta?.seasons || []);
  const [playingSeasonEpisodes, setPlayingSeasonEpisodes] = useState<Episode[]>(
    episodeMeta?.episodes || []
  );
  const [showEpisodeDrawer, setShowEpisodeDrawer] = useState(false);
  const [drawerSeasonId, setDrawerSeasonId] = useState<string>(currentSeasonId);
  const [drawerSeasonNumber, setDrawerSeasonNumber] = useState<number>(currentSeasonNumber);
  const [drawerEpisodes, setDrawerEpisodes] = useState<Episode[]>(episodeMeta?.episodes || []);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [episodeSearch, setEpisodeSearch] = useState('');
  const [isSwitchingEpisode, setIsSwitchingEpisode] = useState<string | null>(null);
  const episodeCacheRef = useRef<Record<string, Episode[]>>({});

  const [autoPlayNext, setAutoPlayNext] = useState<boolean>(() => {
    try {
      return localStorage.getItem('maicaoflix_autoplay_next') !== '0';
    } catch {
      return true;
    }
  });
  const [autoNextCountdown, setAutoNextCountdown] = useState<number | null>(null);
  const [autoNextCancelled, setAutoNextCancelled] = useState<boolean>(false);

  // Pro Player Controls (Lock, Skip Intro, Timeline Hover Preview, Remaining Time, Brightness/Preset)
  const [isControlsLocked, setIsControlsLocked] = useState(false);
  const [lockedNoticeVisible, setLockedNoticeVisible] = useState(false);
  const [skipIntroDismissed, setSkipIntroDismissed] = useState(false);
  const [showRemainingTime, setShowRemainingTime] = useState(false);
  const [hoverSeek, setHoverSeek] = useState<{ time: number; percent: number } | null>(null);
  const [videoBrightness, setVideoBrightness] = useState<number>(100);
  const [picturePreset, setPicturePreset] = useState<'standard' | 'cinema' | 'vivid'>('standard');

  const savedPositionRef = useRef<number>(0);
  const lastInitKeyRef = useRef<string>('');
  const lastReportedTimeRef = useRef<number>(0);
  const latestProgressRef = useRef<{ cur: number; dur: number }>({ cur: 0, dur: 0 });
  const onProgressUpdateRef = useRef(onProgressUpdate);
  onProgressUpdateRef.current = onProgressUpdate;
  const onRefreshStreamRef = useRef(onRefreshStream);
  onRefreshStreamRef.current = onRefreshStream;
  const refreshingStreamRef = useRef<boolean>(false);
  const lastUiProgressRef = useRef<number>(0);
  const resumeBannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lockedNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushProgress = useCallback(() => {
    if (!isLive && latestProgressRef.current.cur > 3 && latestProgressRef.current.dur > 0) {
      onProgressUpdateRef.current?.(latestProgressRef.current.cur, latestProgressRef.current.dur);
    }
  }, [isLive]);

  const handleClose = useCallback(() => {
    flushProgress();
    onClose();
  }, [flushProgress, onClose]);

  // Sync incoming episode metadata & hydrate seasons/episodes when launched directly (e.g., from Continue Watching)
  useEffect(() => {
    if (!isSeriesPlayback) return;

    if (episodeMeta?.seasons && episodeMeta.seasons.length > 0) {
      const sorted = episodeMeta.seasons.slice().sort((a, b) => a.number - b.number);
      setSeasonsList(sorted);
    }
    if (episodeMeta?.episodes && episodeMeta.episodes.length > 0 && currentSeasonId) {
      episodeCacheRef.current[currentSeasonId] = episodeMeta.episodes;
      setPlayingSeasonEpisodes(episodeMeta.episodes);
      if (!drawerSeasonId || drawerSeasonId === currentSeasonId) {
        setDrawerSeasonId(currentSeasonId);
        setDrawerSeasonNumber(currentSeasonNumber);
        setDrawerEpisodes(episodeMeta.episodes);
      }
      return;
    }

    const fetchTargetId = currentSeasonId || rootSeriesId || '';
    if (!fetchTargetId) return;
    if (episodeCacheRef.current[fetchTargetId]?.length) {
      const cached = episodeCacheRef.current[fetchTargetId];
      setPlayingSeasonEpisodes(cached);
      if (!drawerSeasonId || drawerSeasonId === fetchTargetId) {
        setDrawerSeasonId(fetchTargetId);
        setDrawerSeasonNumber(currentSeasonNumber);
        setDrawerEpisodes(cached);
      }
      return;
    }

    let isMounted = true;
    setDrawerLoading(true);
    api
      .getDetail(fetchTargetId)
      .then((res) => {
        if (!isMounted || !res) return;
        const eps = res.episodes || [];
        let rawSeasons = (res.seasons || []).slice().sort((a, b) => a.number - b.number);
        if (rawSeasons.length === 0 && eps.length > 0) {
          rawSeasons = [
            {
              id: fetchTargetId,
              number: currentSeasonNumber,
              name: `Temporada ${currentSeasonNumber}`,
            },
          ];
        }
        if (rawSeasons.length > 0) {
          setSeasonsList(rawSeasons);
        }
        if (eps.length > 0) {
          episodeCacheRef.current[fetchTargetId] = eps;
          setPlayingSeasonEpisodes(eps);
          setDrawerSeasonId(fetchTargetId);
          setDrawerSeasonNumber(currentSeasonNumber);
          setDrawerEpisodes(eps);
        }
      })
      .catch((err) => {
        console.warn('Error hydrating series episodes inside Player:', err);
      })
      .finally(() => {
        if (isMounted) setDrawerLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isSeriesPlayback, currentSeasonId, currentSeasonNumber, rootSeriesId, episodeMeta]);

  const handleDrawerSeasonChange = async (newSeasonId: string) => {
    setDrawerSeasonId(newSeasonId);
    const chosen = seasonsList.find((s) => s.id === newSeasonId);
    if (chosen) {
      setDrawerSeasonNumber(chosen.number);
    }
    if (episodeCacheRef.current[newSeasonId]) {
      setDrawerEpisodes(episodeCacheRef.current[newSeasonId]);
      return;
    }
    setDrawerLoading(true);
    try {
      const res = await api.getDetail(newSeasonId);
      if (res?.episodes) {
        episodeCacheRef.current[newSeasonId] = res.episodes;
        setDrawerEpisodes(res.episodes);
      }
    } catch (err) {
      console.warn('Error fetching drawer season episodes:', err);
    } finally {
      setDrawerLoading(false);
    }
  };

  const currentEpIndex = useMemo(() => {
    if (!playingSeasonEpisodes.length) return -1;
    if (contentId) {
      const byId = playingSeasonEpisodes.findIndex((e) => e.id === contentId);
      if (byId !== -1) return byId;
    }
    if (episodeMeta?.episodeNumber) {
      return playingSeasonEpisodes.findIndex((e) => e.number === episodeMeta.episodeNumber);
    }
    return -1;
  }, [playingSeasonEpisodes, contentId, episodeMeta?.episodeNumber]);

  const prevEpisode = useMemo(() => {
    return currentEpIndex > 0 ? playingSeasonEpisodes[currentEpIndex - 1] : null;
  }, [playingSeasonEpisodes, currentEpIndex]);

  const nextEpisode = useMemo(() => {
    return currentEpIndex >= 0 && currentEpIndex + 1 < playingSeasonEpisodes.length
      ? playingSeasonEpisodes[currentEpIndex + 1]
      : null;
  }, [playingSeasonEpisodes, currentEpIndex]);

  const triggerEpisodeChange = useCallback(
    async (
      ep: Episode,
      targetSeasonId: string,
      targetSeasonNumber: number,
      customEpisodesList?: Episode[]
    ) => {
      if (!onSelectEpisode || isSwitchingEpisode) return;
      flushProgress();
      setAutoNextCountdown(null);
      setAutoNextCancelled(false);
      setShowEpisodeDrawer(false);
      const label = cleanEpisodeTitleText(ep.name || ep.title || `Episodio ${ep.number}`);
      setIsSwitchingEpisode(`T${targetSeasonNumber}:E${ep.number} — ${label}`);
      try {
        await onSelectEpisode(
          ep,
          targetSeasonId,
          targetSeasonNumber,
          seasonsList,
          customEpisodesList || playingSeasonEpisodes
        );
      } finally {
        setIsSwitchingEpisode(null);
      }
    },
    [onSelectEpisode, isSwitchingEpisode, flushProgress, seasonsList, playingSeasonEpisodes]
  );

  // Reset per-video transient banners whenever active source URL changes
  useEffect(() => {
    setAutoNextCountdown(null);
    setAutoNextCancelled(false);
    setSkipIntroDismissed(false);
    setHoverSeek(null);
  }, [url]);

  // Clear stale subtitle selection if episode/source changes and no longer includes that track
  useEffect(() => {
    setSelectedSubtitle((prev) =>
      prev !== 'none' && !subtitles.some((s) => s.url === prev) ? 'none' : prev
    );
  }, [url, subtitles]);

  // Countdown tick for Auto-Next episode
  useEffect(() => {
    if (autoNextCountdown === null) return;
    if (autoNextCountdown <= 0) {
      setAutoNextCountdown(null);
      if (nextEpisode && currentSeasonId) {
        triggerEpisodeChange(nextEpisode, currentSeasonId, currentSeasonNumber);
      }
      return;
    }
    const timer = setTimeout(() => {
      setAutoNextCountdown((prev) => (prev !== null ? prev - 1 : null));
    }, 1000);
    return () => clearTimeout(timer);
  }, [autoNextCountdown, nextEpisode, currentSeasonId, currentSeasonNumber, triggerEpisodeChange]);

  const videoFilterStyle = useMemo(() => {
    const brightnessVal = videoBrightness / 100;
    if (picturePreset === 'cinema') {
      return `brightness(${brightnessVal}) contrast(1.08) saturate(0.95)`;
    }
    if (picturePreset === 'vivid') {
      return `brightness(${brightnessVal}) contrast(1.1) saturate(1.22)`;
    }
    return `brightness(${brightnessVal})`;
  }, [videoBrightness, picturePreset]);

  const toggleAutoPlayNext = () => {
    setAutoPlayNext((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('maicaoflix_autoplay_next', next ? '1' : '0');
      } catch {
        // ignore storage failure
      }
      return next;
    });
  };

  // Initialize and play HLS stream
  const initHls = useCallback(() => {
    const video = videoRef.current;
    if (!video || !url) return;

    setIsLoading(true);
    setErrorAlert(null);
    networkRetryRef.current = 0;
    refreshingStreamRef.current = false;
    lastUiProgressRef.current = 0;
    setLevels([]);
    setCurrentLevel(-1);
    setAudioTracks([]);
    setCurrentAudioTrack(0);

    // Apply initial resume position when source changes (or reset for Live TV)
    const initKey = `${contentId || url}::${seriesId || ''}::${initialTime}`;
    if (isLive) {
      savedPositionRef.current = 0;
      lastInitKeyRef.current = initKey;
    } else if (lastInitKeyRef.current !== initKey) {
      lastInitKeyRef.current = initKey;
      lastReportedTimeRef.current = 0;
      latestProgressRef.current = { cur: 0, dur: 0 };
      if (initialTime && initialTime > 3) {
        savedPositionRef.current = initialTime;
        setProgress(initialTime);
        setResumeBanner(formatPlayerTime(initialTime));
        if (resumeBannerTimerRef.current) clearTimeout(resumeBannerTimerRef.current);
        resumeBannerTimerRef.current = setTimeout(() => {
          setResumeBanner(null);
        }, 3800);
      } else {
        savedPositionRef.current = 0;
        setResumeBanner(null);
      }
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
    video.pause();
    video.removeAttribute('src');
    video.load();

    const isHlsSource = hasExtension(url, '.m3u8');
    const isMp4Source = hasExtension(url, '.mp4');

    if (Hls.isSupported() && isHlsSource) {
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
        const statusCode = (data as { response?: { code?: number } })?.response?.code;
        if (data.fatal) {
          const maxRetries = isLive ? 8 : 4;
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              if (
                (statusCode === 410 || statusCode === 404 || networkRetryRef.current >= 2) &&
                onRefreshStreamRef.current &&
                !refreshingStreamRef.current
              ) {
                refreshingStreamRef.current = true;
                console.warn(
                  `HLS Network Error (HTTP ${statusCode ?? 'err'}), refreshing stream token...`
                );
                Promise.resolve(onRefreshStreamRef.current()).finally(() => {
                  refreshingStreamRef.current = false;
                });
                return;
              }
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
        } else if (
          (data.details === Hls.ErrorDetails.FRAG_LOAD_ERROR ||
            data.details === Hls.ErrorDetails.FRAG_LOAD_TIMEOUT ||
            data.details === Hls.ErrorDetails.LEVEL_LOAD_ERROR ||
            data.details === Hls.ErrorDetails.LEVEL_LOAD_TIMEOUT) &&
          statusCode === 410 &&
          onRefreshStreamRef.current &&
          !refreshingStreamRef.current
        ) {
          refreshingStreamRef.current = true;
          console.warn('Proxy token expired (HTTP 410), refreshing stream token...');
          Promise.resolve(onRefreshStreamRef.current()).finally(() => {
            refreshingStreamRef.current = false;
          });
        } else if (data.details === Hls.ErrorDetails.BUFFER_STALLED_ERROR) {
          // Jump only across genuine buffered gaps ahead; never seek past the buffered end
          if (video && !video.paused) {
            const ct = video.currentTime;
            const buf = video.buffered;
            for (let i = 0; i < buf.length; i++) {
              if (buf.start(i) > ct + 0.05 && buf.end(i) > buf.start(i) + 0.3) {
                video.currentTime = buf.start(i) + 0.1;
                break;
              }
            }
            if (isLive && buf.length > 0) {
              const liveEdge = buf.end(buf.length - 1);
              if (liveEdge - ct > 25) {
                video.currentTime = Math.max(buf.start(buf.length - 1), liveEdge - 4);
              }
            }
          }
          hls.startLoad();
        }
      });
    } else if ((isHlsSource && video.canPlayType('application/vnd.apple.mpegurl')) || isMp4Source) {
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
    } else {
      setIsLoading(false);
      setErrorAlert({
        open: true,
        message: 'La fuente de video no tiene un formato compatible. Intenta recargar el título.',
      });
    }
  }, [url, isLive, initialTime, contentId, seriesId]);

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
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
      if (resumeBannerTimerRef.current) {
        clearTimeout(resumeBannerTimerRef.current);
      }
      if (lockedNoticeTimerRef.current) {
        clearTimeout(lockedNoticeTimerRef.current);
      }
    };
  }, [initHls]);

  // Save playback progress on tab hide, unload, or unmount
  useEffect(() => {
    const handleVisibilityOrUnload = () => {
      if (document.visibilityState === 'hidden') {
        flushProgress();
      }
    };
    window.addEventListener('beforeunload', flushProgress);
    document.addEventListener('visibilitychange', handleVisibilityOrUnload);
    return () => {
      window.removeEventListener('beforeunload', flushProgress);
      document.removeEventListener('visibilitychange', handleVisibilityOrUnload);
      flushProgress();
    };
  }, [flushProgress]);

  useEffect(() => {
    const syncFullscreenState = () => setIsFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener('fullscreenchange', syncFullscreenState);
    return () => document.removeEventListener('fullscreenchange', syncFullscreenState);
  }, []);

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
        case 'n':
        case 'N':
          if (nextEpisode && currentSeasonId) {
            e.preventDefault();
            triggerEpisodeChange(nextEpisode, currentSeasonId, currentSeasonNumber);
          }
          break;
        case 'e':
        case 'E':
          if (isSeriesPlayback) {
            e.preventDefault();
            setShowChannelDrawer(false);
            setShowEpisodeDrawer((prev) => !prev);
          }
          break;
        case 'l':
        case 'L':
          e.preventDefault();
          setIsControlsLocked((prev) => {
            const next = !prev;
            if (next) {
              setShowControls(false);
              setLockedNoticeVisible(true);
            } else {
              setLockedNoticeVisible(false);
              setShowControls(true);
            }
            return next;
          });
          break;
        case 'Escape':
          if (isControlsLocked) {
            setIsControlsLocked(false);
            setLockedNoticeVisible(false);
            setShowControls(true);
          } else if (showSettingsDialog) {
            setShowSettingsDialog(false);
          } else if (showEpisodeDrawer) {
            setShowEpisodeDrawer(false);
          } else if (showChannelDrawer) {
            setShowChannelDrawer(false);
          } else if (errorAlert) {
            setErrorAlert(null);
          } else {
            handleClose();
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    showSettingsDialog,
    showChannelDrawer,
    showEpisodeDrawer,
    isControlsLocked,
    isSeriesPlayback,
    nextEpisode,
    currentSeasonId,
    currentSeasonNumber,
    triggerEpisodeChange,
    errorAlert,
    isPlaying,
    isMuted,
    volume,
    duration,
    handleClose,
  ]);

  // Playback actions
  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      attemptPlay(videoRef.current);
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
      if (
        isPlaying &&
        !showSettingsDialog &&
        !showChannelDrawer &&
        !showEpisodeDrawer &&
        autoNextCountdown === null
      ) {
        setShowControls(false);
      }
    }, 4500);
  }, [isPlaying, showSettingsDialog, showChannelDrawer, showEpisodeDrawer, autoNextCountdown]);

  useEffect(() => {
    if (isControlsLocked) {
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
      setShowControls(false);
      return;
    }
    if (
      isPlaying &&
      !showSettingsDialog &&
      !showChannelDrawer &&
      !showEpisodeDrawer &&
      autoNextCountdown === null
    ) {
      resetControlsTimer();
    } else if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
  }, [
    isPlaying,
    isControlsLocked,
    showSettingsDialog,
    showChannelDrawer,
    showEpisodeDrawer,
    autoNextCountdown,
    resetControlsTimer,
  ]);

  const wakeControls = useCallback(() => {
    if (isControlsLocked) return;
    setShowControls(true);
    resetControlsTimer();
  }, [isControlsLocked, resetControlsTimer]);

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
    if (isControlsLocked) {
      setLockedNoticeVisible(true);
      if (lockedNoticeTimerRef.current) clearTimeout(lockedNoticeTimerRef.current);
      lockedNoticeTimerRef.current = setTimeout(() => {
        setLockedNoticeVisible(false);
      }, 2800);
      return;
    }

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
    if (isControlsLocked) return;
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

  const filteredDrawerChannels = useMemo(
    () =>
      showChannelDrawer
        ? channels.filter((c) => c.name.toLowerCase().includes(channelSearch.toLowerCase()))
        : [],
    [showChannelDrawer, channels, channelSearch]
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
        style={{ filter: videoFilterStyle }}
        onTimeUpdate={() => {
          if (videoRef.current) {
            const cur = videoRef.current.currentTime;
            const vidDur = videoRef.current.duration;
            savedPositionRef.current = cur;

            // Throttled UI state updates (skip Live TV; update VOD every >= 0.25s)
            if (!isLive && Math.abs(cur - lastUiProgressRef.current) >= 0.25) {
              lastUiProgressRef.current = cur;
              setProgress(cur);
              if (vidDur && isFinite(vidDur) && vidDur > 0) {
                setDuration((prev) => (vidDur > prev ? vidDur : prev));
              }
              if (videoRef.current.buffered.length > 0) {
                setBufferedEnd(videoRef.current.buffered.end(videoRef.current.buffered.length - 1));
              }
            }

            // Throttled playback progress reporting (every ~15s) for VOD/Series
            if (!isLive && cur > 3 && vidDur && isFinite(vidDur) && vidDur > 0) {
              latestProgressRef.current = { cur, dur: vidDur };
              if (Math.abs(cur - lastReportedTimeRef.current) >= 15) {
                lastReportedTimeRef.current = cur;
                onProgressUpdateRef.current?.(cur, vidDur);
              }
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
          if (videoRef.current && videoRef.current.playbackRate !== playbackRate) {
            videoRef.current.playbackRate = playbackRate;
          }
        }}
        onPause={() => {
          setIsPlaying(false);
          flushProgress();
        }}
        onEnded={() => {
          setIsPlaying(false);
          flushProgress();
          if (!isLive && autoPlayNext && nextEpisode && !autoNextCancelled) {
            setAutoNextCountdown(6);
          }
          if (!isControlsLocked) {
            setShowControls(true);
          }
        }}
        onError={() => {
          if (!hlsRef.current) {
            setIsLoading(false);
            setErrorAlert({
              open: true,
              message: 'El navegador no pudo cargar este video. Verifica la señal e inténtalo de nuevo.',
            });
          }
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
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 pointer-events-none z-30">
          <div className="h-9 w-9 rounded-full border-2 border-white/20 border-t-white animate-spin" />
          <p className="mt-4 text-xs font-medium tracking-wide text-zinc-300">Cargando</p>
        </div>
      )}

      {/* Resume Position Floating Indicator */}
      {resumeBanner && !autoplayBlocked && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-40 pointer-events-none inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/85 px-4 py-1.5 text-xs font-semibold text-white shadow-xl backdrop-blur-md animate-in fade-in duration-200">
          <Play className="w-3.5 h-3.5 text-red-500 fill-current" />
          <span>Reanudando desde {resumeBanner}</span>
        </div>
      )}

      {/* Autoplay Blocked Floating Pill (Unmute prompt) */}
      {autoplayBlocked && (
        <button
          type="button"
          onClick={unmuteAndPlay}
          className="absolute top-20 left-1/2 -translate-x-1/2 z-40 inline-flex items-center gap-2 rounded-md border border-white/15 bg-black/85 px-3 py-2 text-xs font-medium text-white shadow-xl hover:bg-zinc-900 cursor-pointer"
        >
          <VolumeX className="w-4 h-4" />
          <span>Activar sonido</span>
        </button>
      )}

      {/* Skip Intro Button (VOD Series) */}
      {!isLive &&
        isSeriesPlayback &&
        !isControlsLocked &&
        !isLoading &&
        !isSwitchingEpisode &&
        duration > 300 &&
        progress >= 8 &&
        progress <= 115 &&
        !skipIntroDismissed && (
          <div
            onClick={(e) => e.stopPropagation()}
            onTouchEnd={(e) => e.stopPropagation()}
            className={`absolute left-4 sm:left-8 z-30 flex items-center gap-1.5 transition-all duration-200 ${
              showControls ? 'bottom-28 sm:bottom-32' : 'bottom-10 sm:bottom-14'
            }`}
          >
            <button
              type="button"
              onClick={() => {
                skipSeconds(85);
                setSkipIntroDismissed(true);
                wakeControls();
              }}
              className="inline-flex items-center gap-2 rounded-md border border-white/25 bg-black/85 hover:bg-white hover:text-black text-white px-4 py-2 text-xs sm:text-sm font-bold shadow-2xl backdrop-blur-md transition-colors cursor-pointer"
            >
              <SkipForward className="h-4 w-4" />
              <span>Omitir intro (+85s)</span>
            </button>
            <button
              type="button"
              onClick={() => setSkipIntroDismissed(true)}
              title="Ocultar botón"
              className="h-8 w-8 rounded-md border border-white/15 bg-black/75 hover:bg-zinc-800 text-zinc-300 hover:text-white flex items-center justify-center cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

      {/* Switching Episode Overlay */}
      {isSwitchingEpisode && (
        <div
          onClick={(e) => e.stopPropagation()}
          onTouchEnd={(e) => e.stopPropagation()}
          className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 backdrop-blur-md z-40 px-4 text-center"
        >
          <Loader2 className="h-10 w-10 text-red-500 animate-spin" />
          <p className="mt-3 text-xs font-semibold uppercase tracking-widest text-zinc-400">
            Cargando episodio
          </p>
          <p className="mt-1 text-sm sm:text-base font-bold text-white max-w-md truncate">
            {isSwitchingEpisode}
          </p>
        </div>
      )}

      {/* Up-Next / Auto-Next Countdown Card */}
      {!isLive &&
        isSeriesPlayback &&
        autoPlayNext &&
        nextEpisode &&
        !autoNextCancelled &&
        !isSwitchingEpisode &&
        (autoNextCountdown !== null ||
          (duration > 60 && duration - progress <= 22 && duration - progress > 0.5)) && (
          <div
            onClick={(e) => e.stopPropagation()}
            onTouchEnd={(e) => e.stopPropagation()}
            className="absolute bottom-28 sm:bottom-32 right-4 sm:right-8 z-30 w-80 sm:w-96 rounded-xl border border-white/15 bg-zinc-950/95 backdrop-blur-xl p-3.5 shadow-2xl animate-in slide-in-from-bottom-4 duration-200"
          >
            <div className="flex items-start gap-3">
              {nextEpisode.picture ? (
                <img
                  src={nextEpisode.picture}
                  alt={cleanEpisodeTitleText(
                    nextEpisode.name || nextEpisode.title || `Episodio ${nextEpisode.number}`
                  )}
                  className="w-24 aspect-video rounded-lg object-cover shrink-0 bg-zinc-900 border border-white/10"
                />
              ) : (
                <div className="w-24 aspect-video rounded-lg bg-zinc-900 border border-white/10 flex items-center justify-center shrink-0">
                  <Play className="h-5 w-5 text-zinc-500" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-bold uppercase tracking-wider text-red-400">
                  {autoNextCountdown !== null
                    ? `Siguiente episodio en ${autoNextCountdown}s`
                    : 'A continuación'}
                </p>
                <p className="text-xs sm:text-sm font-bold text-white line-clamp-2 mt-0.5">
                  T{currentSeasonNumber}:E{nextEpisode.number} •{' '}
                  {cleanEpisodeTitleText(
                    nextEpisode.name || nextEpisode.title || `Episodio ${nextEpisode.number}`
                  )}
                </p>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setAutoNextCountdown(null);
                  setAutoNextCancelled(true);
                }}
                className="h-8 text-xs text-zinc-300 hover:text-white cursor-pointer"
              >
                {autoNextCountdown !== null ? 'Cancelar' : 'Ocultar'}
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() =>
                  triggerEpisodeChange(
                    nextEpisode,
                    currentSeasonId,
                    currentSeasonNumber,
                    playingSeasonEpisodes
                  )
                }
                className="h-8 text-xs font-bold bg-white text-black hover:bg-zinc-200 gap-1.5 cursor-pointer"
              >
                <Play className="h-3.5 w-3.5 fill-current" />
                <span>Reproducir ahora</span>
              </Button>
            </div>
          </div>
        )}

      {/* Locked Screen Unlock Pill */}
      {isControlsLocked && (lockedNoticeVisible || !isPlaying) && (
        <div
          onClick={(e) => e.stopPropagation()}
          onTouchEnd={(e) => e.stopPropagation()}
          className="absolute bottom-8 left-1/2 -translate-x-1/2 z-40"
        >
          <button
            type="button"
            onClick={() => {
              setIsControlsLocked(false);
              setLockedNoticeVisible(false);
              wakeControls();
            }}
            className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-black/85 hover:bg-zinc-900 px-4 py-2 text-xs font-semibold text-white shadow-2xl backdrop-blur-md cursor-pointer"
          >
            <Unlock className="h-4 w-4 text-red-400" />
            <span>Controles bloqueados • Toca para desbloquear</span>
          </button>
        </div>
      )}

      {/* Centered Large Play/Pause Touch Control */}
      {showControls && !isControlsLocked && !isPlaying && !isLoading && !isSwitchingEpisode && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
          <button
            onClick={(e) => {
              e.stopPropagation();
              togglePlay();
            }}
            className="pointer-events-auto h-14 w-14 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-xl cursor-pointer"
          >
            <Play className="h-7 w-7 fill-current ml-1" />
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
          showControls && !isControlsLocked ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div className="flex items-center gap-3 min-w-0 pr-2">
          {/* Back button */}
          <Button
            variant="ghost"
            size="icon"
            onClick={handleClose}
            className="rounded-full text-white hover:bg-white/10 h-9 w-9 shrink-0 cursor-pointer"
            title="Volver"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>

          <MaicaoflixLogo width={92} height={20} className="hidden sm:block ml-1 mr-2" />

          {isLive ? (
            <Badge variant="destructive" className="bg-red-600 font-semibold px-2 py-0.5 tracking-wider shrink-0 text-[9px]">
              ● EN VIVO
            </Badge>
          ) : null}

          <div className="min-w-0">
            <h2 className="text-sm sm:text-base md:text-lg font-bold text-white tracking-wide truncate">{title}</h2>
            {subtitle && <p className="text-[11px] text-zinc-400 truncate">{subtitle}</p>}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Quick Episodes Drawer Trigger for Series */}
          {isSeriesPlayback && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setShowEpisodeDrawer((prev) => !prev);
                setShowChannelDrawer(false);
              }}
              className={`gap-1.5 rounded-md border-white/15 bg-black/35 hover:bg-white/10 hover:text-white text-xs h-9 cursor-pointer ${
                showEpisodeDrawer ? 'border-red-500/60 text-white bg-red-950/30' : 'text-zinc-200'
              }`}
              title="Episodios y temporadas (E)"
            >
              <Layers className="h-4 w-4 text-red-400" />
              <span className="hidden sm:inline">Episodios</span>
            </Button>
          )}

          {/* Lock Screen Controls */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              setIsControlsLocked(true);
              setShowControls(false);
              setShowEpisodeDrawer(false);
              setShowChannelDrawer(false);
              setLockedNoticeVisible(true);
              if (lockedNoticeTimerRef.current) clearTimeout(lockedNoticeTimerRef.current);
              lockedNoticeTimerRef.current = setTimeout(() => {
                setLockedNoticeVisible(false);
              }, 2600);
            }}
            className="rounded-full text-zinc-300 hover:text-white hover:bg-white/10 h-9 w-9 cursor-pointer"
            title="Bloquear pantalla (L)"
          >
            <Lock className="h-4 w-4" />
          </Button>

          {/* Quick Channels Guide for Live TV */}
          {channels.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setShowChannelDrawer(!showChannelDrawer);
                setShowEpisodeDrawer(false);
              }}
              className="gap-2 rounded-md border-white/15 bg-black/35 text-zinc-200 hover:bg-white/10 hover:text-white text-xs h-9"
            >
              <ListVideo className="h-4 w-4" />
              <span>Canales ({channels.length})</span>
            </Button>
          )}

          {/* Aspect Ratio Cycler */}
          <Button
            variant="ghost"
            size="sm"
            onClick={cycleAspectRatio}
            className="rounded-md text-zinc-300 hover:text-white hover:bg-white/10 text-xs px-2.5 h-9"
            title="Cambiar relación de aspecto"
          >
            {aspectRatio === 'contain' ? 'Ajustar' : aspectRatio === 'cover' ? 'Rellenar' : 'Estirar'}
          </Button>

          {/* Close Player */}
          <Button
            variant="ghost"
            size="icon"
            onClick={handleClose}
            className="rounded-full text-zinc-300 hover:bg-white/10 hover:text-white h-9 w-9"
            title="Cerrar reproductor"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Quick Episodes & Seasons Sidebar Drawer (For Series) */}
      {showEpisodeDrawer && isSeriesPlayback && (
        <div
          onClick={(e) => e.stopPropagation()}
          onTouchEnd={(e) => e.stopPropagation()}
          className="absolute top-0 right-0 bottom-0 w-80 sm:w-96 bg-zinc-950/95 backdrop-blur-xl border-l border-zinc-800/80 z-40 p-4 flex flex-col shadow-2xl animate-in slide-in-from-right duration-200"
        >
          <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-red-500" />
              <h3 className="text-sm font-bold text-white">Episodios y Temporadas</h3>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowEpisodeDrawer(false)}
              className="h-7 w-7 text-zinc-400 hover:text-white cursor-pointer"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {seasonsList.length > 0 && (
            <div className="mt-3">
              <select
                value={drawerSeasonId}
                onChange={(e) => handleDrawerSeasonChange(e.target.value)}
                aria-label="Seleccionar temporada"
                className="w-full h-9 rounded-md bg-zinc-900 border border-zinc-800 px-3 text-xs font-semibold text-white focus:outline-none focus:border-red-500 cursor-pointer"
              >
                {seasonsList.map((s) => {
                  const seasonKey = s.id || drawerSeasonId;
                  return (
                    <option key={`${seasonKey}-${s.number}`} value={seasonKey}>
                      {s.name || s.title || `Temporada ${s.number}`}
                    </option>
                  );
                })}
              </select>
            </div>
          )}

          <div className="my-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500" />
              <Input
                placeholder="Buscar episodio o número..."
                value={episodeSearch}
                onChange={(e) => setEpisodeSearch(e.target.value)}
                className="pl-8 text-xs h-8 bg-zinc-900 border-zinc-800 text-white"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
            {drawerLoading ? (
              <div className="flex flex-col items-center justify-center py-12 text-zinc-400 gap-2">
                <Loader2 className="h-6 w-6 animate-spin text-red-500" />
                <span className="text-xs">Cargando episodios...</span>
              </div>
            ) : drawerEpisodes.length === 0 ? (
              <p className="text-xs text-zinc-500 text-center py-8">
                No se encontraron episodios para esta temporada.
              </p>
            ) : (
              drawerEpisodes
                .filter((ep) => {
                  const q = episodeSearch.trim().toLowerCase();
                  if (!q) return true;
                  const epLabel = cleanEpisodeTitleText(
                    ep.name || ep.title || `Episodio ${ep.number}`
                  ).toLowerCase();
                  return (
                    epLabel.includes(q) ||
                    String(ep.number).includes(q) ||
                    `e${ep.number}`.includes(q)
                  );
                })
                .map((ep) => {
                  const isActiveEp =
                    (contentId && ep.id === contentId) ||
                    (!contentId &&
                      drawerSeasonId === currentSeasonId &&
                      ep.number === episodeMeta?.episodeNumber);
                  const epProg = episodeProgressMap?.[ep.id];
                  const epLabel = cleanEpisodeTitleText(
                    ep.name || ep.title || `Episodio ${ep.number}`
                  );
                  const pct = epProg ? Math.min(100, Math.max(0, epProg.progressPercent || 0)) : 0;

                  return (
                    <button
                      key={ep.id}
                      type="button"
                      disabled={Boolean(isSwitchingEpisode)}
                      onClick={() =>
                        triggerEpisodeChange(
                          ep,
                          drawerSeasonId || currentSeasonId,
                          drawerSeasonNumber || currentSeasonNumber,
                          drawerEpisodes
                        )
                      }
                      className={`w-full text-left flex items-center gap-3 p-2 rounded-lg border transition-colors cursor-pointer group ${
                        isActiveEp
                          ? 'bg-red-950/35 border-red-500/60'
                          : 'bg-zinc-900/40 hover:bg-zinc-900 border-transparent hover:border-zinc-800'
                      }`}
                    >
                      <div className="relative w-24 aspect-video rounded-md overflow-hidden bg-zinc-900 shrink-0">
                        {ep.picture ? (
                          <img
                            src={ep.picture}
                            alt={epLabel}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-xs font-bold text-zinc-500">
                            E{ep.number}
                          </div>
                        )}
                        {pct > 0 && (
                          <div className="absolute bottom-0 left-0 right-0 h-1 bg-zinc-800/90">
                            <div
                              className="h-full bg-red-600"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] font-bold text-zinc-400">
                            E{ep.number}
                          </span>
                          {isActiveEp && (
                            <Badge className="bg-red-600 text-white text-[9px] px-1.5 py-0 h-4">
                              EN REPRODUCCIÓN
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs font-semibold text-zinc-100 group-hover:text-white truncate mt-0.5">
                          {epLabel}
                        </p>
                        {epProg && epProg.currentTime > 10 && pct < 96 ? (
                          <span className="text-[10px] text-zinc-400 block mt-0.5">
                            Visto {formatPlayerTime(epProg.currentTime)}
                          </span>
                        ) : pct >= 96 ? (
                          <span className="text-[10px] text-emerald-400 block mt-0.5">
                            Completado
                          </span>
                        ) : ep.duration ? (
                          <span className="text-[10px] text-zinc-500 block mt-0.5">
                            {ep.duration}
                          </span>
                        ) : null}
                      </div>
                    </button>
                  );
                })
            )}
          </div>
        </div>
      )}

      {/* Quick Channels Sidebar Drawer (For Live TV) */}
      {showChannelDrawer && channels.length > 0 && (
        <div
          onClick={(e) => e.stopPropagation()}
          onTouchEnd={(e) => e.stopPropagation()}
          className="absolute top-0 right-0 bottom-0 w-80 bg-zinc-950/95 backdrop-blur-xl border-l border-zinc-800/80 z-40 p-4 flex flex-col shadow-2xl animate-in slide-in-from-right duration-200"
        >
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
          showControls && !isControlsLocked ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Timeline Seekbar (for VOD/Movies/Series) */}
        {!isLive && duration > 0 && duration !== Infinity && (
          <div className="mb-3 space-y-1.5">
            <div
              onMouseMove={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                if (rect.width <= 0) return;
                const pct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
                setHoverSeek({ time: pct * duration, percent: pct * 100 });
              }}
              onMouseLeave={() => setHoverSeek(null)}
              className="relative w-full h-1.5 bg-zinc-700/70 hover:h-2 rounded-full cursor-pointer group transition-all flex items-center"
            >
              {hoverSeek && (
                <div
                  className="absolute -top-8 -translate-x-1/2 px-2 py-0.5 rounded bg-black/95 border border-white/15 text-[11px] font-mono text-white shadow-lg pointer-events-none whitespace-nowrap z-10"
                  style={{ left: `clamp(24px, ${hoverSeek.percent}%, calc(100% - 24px))` }}
                >
                  {formatTime(hoverSeek.time)}
                </div>
              )}
              {/* Buffered progress */}
              {bufferedEnd > 0 && (
                <div
                  className="absolute top-0 bottom-0 left-0 bg-zinc-400/35 rounded-full pointer-events-none transition-all duration-150"
                  style={{ width: `${Math.min(100, (bufferedEnd / duration) * 100)}%` }}
                />
              )}
              {/* Played progress */}
              <div
                className="absolute top-0 bottom-0 left-0 bg-red-600 rounded-full pointer-events-none"
                style={{ width: `${Math.min(100, (progress / duration) * 100)}%` }}
              />
              {/* Scrubber Thumb */}
              <div
                className="absolute h-3 w-3 rounded-full bg-red-600 shadow-md pointer-events-none -translate-x-1/2 transition-transform group-hover:scale-125"
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
              <button
                type="button"
                onClick={() => setShowRemainingTime((prev) => !prev)}
                className="hover:text-white transition-colors cursor-pointer"
                title="Alternar tiempo restante / duración total"
              >
                {showRemainingTime
                  ? `-${formatTime(Math.max(0, duration - progress))}`
                  : formatTime(duration)}
              </button>
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

            {/* Previous / Next Episode (for Series) */}
            {isSeriesPlayback && (
              <div className="flex items-center gap-1 border-l border-white/10 pl-2 ml-0.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={!prevEpisode || Boolean(isSwitchingEpisode)}
                  onClick={() =>
                    prevEpisode &&
                    triggerEpisodeChange(
                      prevEpisode,
                      currentSeasonId,
                      currentSeasonNumber,
                      playingSeasonEpisodes
                    )
                  }
                  className="text-zinc-300 hover:text-white disabled:opacity-30 rounded-full h-8 w-8 cursor-pointer"
                  title={
                    prevEpisode
                      ? `Episodio anterior (E${prevEpisode.number})`
                      : 'No hay episodio anterior'
                  }
                >
                  <SkipBack className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={!nextEpisode || Boolean(isSwitchingEpisode)}
                  onClick={() =>
                    nextEpisode &&
                    triggerEpisodeChange(
                      nextEpisode,
                      currentSeasonId,
                      currentSeasonNumber,
                      playingSeasonEpisodes
                    )
                  }
                  className="text-zinc-300 hover:text-white disabled:opacity-30 rounded-full h-8 w-8 cursor-pointer"
                  title={
                    nextEpisode
                      ? `Siguiente episodio (E${nextEpisode.number})`
                      : 'Último episodio de la temporada'
                  }
                >
                  <SkipForward className="h-4 w-4" />
                </Button>
              </div>
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
            {/* Series Episodes Quick Toggle */}
            {isSeriesPlayback && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => {
                  setShowEpisodeDrawer((prev) => !prev);
                  setShowChannelDrawer(false);
                }}
                className={`h-8 w-8 cursor-pointer ${
                  showEpisodeDrawer ? 'text-red-500 bg-red-950/40' : 'text-zinc-300 hover:text-white'
                }`}
                title="Episodios (E)"
              >
                <Layers className="h-4 w-4" />
              </Button>
            )}

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
              title="Audio, Subtítulos, Calidad e Imagen"
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
      {/* SHADCN DIALOG: Audio, Subtitles, Quality, Speed & Image      */}
      {/* ============================================================ */}
      <Dialog open={showSettingsDialog} onOpenChange={setShowSettingsDialog}>
        <DialogContent className="max-w-md bg-zinc-950 border-zinc-800 text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold">
              <Sliders className="h-4 w-4 text-red-500" />
              <span>Ajustes de Reproducción</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-zinc-400">
              Personaliza el audio, subtítulos, resolución, velocidad e imagen.
            </DialogDescription>
          </DialogHeader>

          {/* Navigation Tabs */}
          <div className="grid grid-cols-5 gap-1 p-1 bg-zinc-900 rounded-lg text-[11px] sm:text-xs font-semibold">
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
            <button
              type="button"
              onClick={() => setSettingsTab('image')}
              className={`py-1.5 rounded-md transition-all cursor-pointer ${
                settingsTab === 'image'
                  ? 'bg-zinc-800 text-white shadow'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Imagen
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
                  <div className="flex items-center gap-2">
                    <Gauge className="h-3.5 w-3.5 text-zinc-400" />
                    <span>{rate === 1 ? '1.0x (Normal)' : `${rate}x`}</span>
                  </div>
                  {playbackRate === rate && (
                    <Check className="h-4 w-4 text-red-500 font-bold" />
                  )}
                </Button>
              ))}
            </div>
          )}

          {/* Tab 5: Imagen y Reproducción */}
          {settingsTab === 'image' && (
            <div className="py-2 space-y-4">
              {/* Modo de imagen */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-300">
                  <Sparkles className="h-3.5 w-3.5 text-red-400" />
                  <span>Modo de imagen</span>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {(
                    [
                      { id: 'standard', label: 'Estándar' },
                      { id: 'cinema', label: 'Cine' },
                      { id: 'vivid', label: 'Vívido' },
                    ] as const
                  ).map((preset) => (
                    <Button
                      key={preset.id}
                      type="button"
                      size="sm"
                      variant={picturePreset === preset.id ? 'secondary' : 'outline'}
                      onClick={() => setPicturePreset(preset.id)}
                      className={`h-8 text-xs cursor-pointer ${
                        picturePreset === preset.id
                          ? 'bg-red-600 hover:bg-red-700 text-white border-red-500'
                          : 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:text-white'
                      }`}
                    >
                      {preset.label}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Brillo */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5 font-semibold text-zinc-300">
                    <Sun className="h-3.5 w-3.5 text-amber-400" />
                    <span>Brillo</span>
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-zinc-300">{videoBrightness}%</span>
                    {videoBrightness !== 100 && (
                      <button
                        type="button"
                        onClick={() => setVideoBrightness(100)}
                        className="text-[11px] text-red-400 hover:text-red-300 underline cursor-pointer"
                      >
                        Restablecer
                      </button>
                    )}
                  </div>
                </div>
                <input
                  type="range"
                  min={50}
                  max={130}
                  step={5}
                  value={videoBrightness}
                  onChange={(e) => setVideoBrightness(Number(e.target.value))}
                  aria-label="Brillo del reproductor"
                  className="w-full h-1.5 bg-zinc-800 accent-red-500 rounded-lg cursor-pointer"
                />
              </div>

              {/* Auto-Next Toggle */}
              <div className="pt-2 border-t border-zinc-800/80 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-zinc-200">
                    Siguiente capítulo automático
                  </p>
                  <p className="text-[11px] text-zinc-400">
                    Reproducir automáticamente el próximo episodio al finalizar.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={autoPlayNext}
                  onClick={toggleAutoPlayNext}
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors cursor-pointer ${
                    autoPlayNext ? 'bg-red-600' : 'bg-zinc-700'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      autoPlayNext ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
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
              <AlertDialogCancel onClick={handleClose}>Cerrar reproductor</AlertDialogCancel>
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
