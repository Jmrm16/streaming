export const getApiBaseUrl = (): string => {
  return localStorage.getItem('xuper_api_url') || (import.meta.env.VITE_API_URL as string) || 'https://streaming-qste.onrender.com';
};

export const setApiBaseUrl = (url: string) => {
  localStorage.setItem('xuper_api_url', url);
};

export interface Channel {
  id?: string;
  channelCode?: string;
  name: string;
  logo?: string;
  streamUrl?: string;
  category?: string;
  epgTitle?: string;
  isFav?: boolean;
  isAdult?: boolean;
}

const ADULT_CHANNEL_REGEX =
  /\b(18\+|playboy|venus|sextreme|sexy\s*hot|brazzers|penthouse|hustler|dorcel|private\s*tv|redlight|vivid\s*red|vivid\s*touch|pop\s*adult|1pon|heyzo|tokyo\s*hot|wowgirls|female\s*sex|carib\s*(fhd|uhd)|nyokei|europe\s*sexy|rainbow\s*(look|tv|movie)|songshi|pandora\s*perfect|cinema\s*vip\s*18)\b/i;

export const isAdultCategory = (cat?: { id?: string | number; name?: string } | null): boolean => {
  if (!cat) return false;
  const idStr = String(cat.id || '').trim();
  const nameStr = String(cat.name || '').trim();
  if (idStr === '76208' || idStr === 'ddc200aa-b664-11ed-8b54-768dd7bc60d3') return true;
  return /(?:^|\b)(18\+|\+18|adultos?|xxx)(?:\b|$)/i.test(nameStr);
};

export const isAdultChannel = (ch?: Channel | null): boolean => {
  if (!ch) return false;
  if (ch.isAdult) return true;
  const cat = String(ch.category || '').trim();
  if (cat === '18+' || cat === '+18' || /adultos?|xxx/i.test(cat)) return true;
  const combined = `${ch.name || ''} ${ch.channelCode || ''}`;
  if (/adult\s*swim/i.test(combined)) return false;
  return ADULT_CHANNEL_REGEX.test(combined);
};

export interface Episode {
  id: string;
  title: string;
  name?: string;
  number: number;
  duration?: string;
  quality?: string;
  picture?: string;
  description?: string;
}

export interface Season {
  id?: string;
  number: number;
  name?: string;
  title?: string;
}

export interface MediaItem {
  id: string;
  title: string;
  poster?: string;
  backdrop?: string;
  landscape?: string;
  rating?: string;
  score?: string;
  year?: string;
  duration?: string;
  type?: 'movie' | 'series' | 'teleplay' | 'channel' | 'anime' | 'kids';
  kind?: string;
  category?: string;
  genres?: string[];
  director?: string;
  actors?: string;
  synopsis?: string;
  volumeCount?: number;
  updateCount?: number;
  isFav?: boolean;
}

export interface MediaDetailResponse {
  item: MediaItem;
  episodes: Episode[];
  seasons: Season[];
}

export interface SubtitleTrack {
  lang: string;
  label: string;
  format: string;
  url: string;
  srtUrl?: string;
}

export interface AudioLanguage {
  id: number;
  code: string;
  name: string;
}

export interface ResolveResponse {
  url: string;
  codec?: string;
  mime?: string;
  isHls?: boolean;
  subtitles?: SubtitleTrack[];
  audioLanguages?: AudioLanguage[];
  availableTracks?: any[];
  trackIndex?: number;
  contentId?: string;
  seriesId?: string;
}

// In-Memory Fast Cache with 3-minute TTL to balance snappy navigation and fresh data
const apiCache = new Map<string, { at: number; data: any }>();
const CACHE_TTL_MS = 3 * 60 * 1000;

async function fetchWithCache<T>(
  key: string,
  url: string,
  timeoutMs = 7000,
  forceRefresh = false
): Promise<T | null> {
  const cached = apiCache.get(key);
  if (!forceRefresh && cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.data as T;
  }
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return cached ? (cached.data as T) : null;
    const data = await res.json();
    apiCache.set(key, { at: Date.now(), data });
    return data as T;
  } catch (err) {
    if (cached) return cached.data as T;
    return null;
  }
}

export const api = {
  clearCache(prefix?: string): void {
    if (!prefix) {
      apiCache.clear();
    } else {
      for (const k of Array.from(apiCache.keys())) {
        if (k.startsWith(prefix)) {
          apiCache.delete(k);
        }
      }
    }
  },

  async ping(): Promise<boolean> {
    try {
      const res = await fetch(`${getApiBaseUrl()}/ping`, { signal: AbortSignal.timeout(3000) });
      const data = await res.json();
      return !!data.returnValue;
    } catch {
      return false;
    }
  },

  async checkStatus(): Promise<boolean> {
    return api.ping();
  },

  async getLiveCategories(forceRefresh = false): Promise<{ id: string; name: string }[]> {
    const key = `categories`;
    const data = await fetchWithCache<{ categories?: any[] }>(key, `${getApiBaseUrl()}/liveCategories`, 7000, forceRefresh);
    if (data && data.categories && Array.isArray(data.categories)) {
      return data.categories.map((c: any) => ({
        id: String(c.id || c.columnId || c.code),
        name: c.name || c.title || 'General',
      }));
    }
    return [];
  },

  async getLiveColumns(forceRefresh = false): Promise<{ id: string; name: string }[]> {
    return api.getLiveCategories(forceRefresh);
  },

  async getLiveChannels(columnId?: string, pageNum = 1, pageSize = 200, forceRefresh = false): Promise<Channel[]> {
    const col = columnId && columnId !== 'all' ? columnId : 'all';
    const key = `channels_${col}_p${pageNum}_s${pageSize}`;
    const params = new URLSearchParams();
    if (columnId && columnId !== 'all') params.set('columnId', columnId);
    params.set('pageNum', String(pageNum));
    params.set('pageSize', String(pageSize));

    const data = await fetchWithCache<{ channels?: Channel[] }>(
      key,
      `${getApiBaseUrl()}/liveChannels?${params.toString()}`,
      7000,
      forceRefresh
    );
    if (data && data.channels && Array.isArray(data.channels)) {
      const fromAdultCat = col === '76208' || col === 'ddc200aa-b664-11ed-8b54-768dd7bc60d3';
      return data.channels.map((ch) => {
        const adult = fromAdultCat || isAdultChannel(ch);
        return adult
          ? { ...ch, isAdult: true, category: ch.category || '18+' }
          : ch;
      });
    }
    return [];
  },

  async resolveLive(channelCode: string, streamUrl?: string): Promise<{ url: string }> {
    const params = new URLSearchParams();
    if (channelCode) params.set('channelCode', channelCode);
    if (streamUrl) params.set('streamUrl', streamUrl);

    try {
      const res = await fetch(`${getApiBaseUrl()}/resolveLive?${params.toString()}`, {
        signal: AbortSignal.timeout(9000),
      });
      const data = await res.json();
      return {
        url: data.proxyPath || data.url || '',
      };
    } catch (e) {
      console.error('Error in resolveLive:', e);
      return { url: '' };
    }
  },

  async getHome(
    root: 'featured' | 'movies' | 'series' | 'anime' | 'kids' = 'movies',
    page = 1,
    forceRefresh = false
  ): Promise<MediaItem[]> {
    const key = `home_${root}_p${page}`;
    const data = await fetchWithCache<{ items?: MediaItem[] }>(
      key,
      `${getApiBaseUrl()}/home?root=${root}&page=${page}`,
      7000,
      forceRefresh
    );
    if (data && data.items && Array.isArray(data.items)) {
      return data.items;
    }
    return [];
  },

  async getDetail(id: string): Promise<MediaDetailResponse | null> {
    const key = `detail_${id}`;
    const data = await fetchWithCache<{ returnValue?: boolean; item?: MediaItem; episodes?: Episode[]; seasons?: Season[] }>(
      key,
      `${getApiBaseUrl()}/detail?id=${encodeURIComponent(id)}`
    );
    if (data && data.returnValue && data.item) {
      return {
        item: data.item,
        episodes: data.episodes || [],
        seasons: data.seasons || [],
      };
    }
    return null;
  },

  async search(query: string): Promise<MediaItem[]> {
    if (!query.trim()) return [];
    try {
      const res = await fetch(`${getApiBaseUrl()}/search?value=${encodeURIComponent(query)}`);
      const data = await res.json();
      return data.items || [];
    } catch (e) {
      console.error('Error in search:', e);
      return [];
    }
  },

  async resolveMedia(
    contentId: string,
    seriesId?: string,
    trackIndex?: number
  ): Promise<ResolveResponse> {
    const buildUrl = (cId: string, sId?: string) => {
      const params = new URLSearchParams();
      params.set('id', cId);
      if (sId) params.set('series', sId);
      if (trackIndex !== undefined && trackIndex !== null) {
        params.set('trackIndex', String(trackIndex));
      }
      return `${getApiBaseUrl()}/resolve?${params.toString()}`;
    };

    let res = await fetch(buildUrl(contentId, seriesId));
    let data: any = null;
    try {
      data = await res.json();
    } catch {
      data = { returnValue: false };
    }

    // Automatic Client-Side Fallback: If initial resolve failed (e.g. portal100008, 502 Bad Gateway)
    // and we have a seriesId distinct from contentId, automatically retry with swapped IDs
    if ((!data?.returnValue || (!data?.url && !data?.proxyPath)) && seriesId && seriesId !== contentId) {
      console.warn('[api] Initial resolve returned error/empty url. Retrying with swapped params id=' + seriesId + '&series=' + contentId);
      try {
        const fallbackRes = await fetch(buildUrl(seriesId, contentId));
        const fallbackData = await fallbackRes.json();
        if (fallbackData && (fallbackData.url || fallbackData.proxyPath)) {
          console.log('[api] Swapped IDs fallback succeeded!');
          data = fallbackData;
        }
      } catch (fallbackErr) {
        console.error('[api] Swapped IDs fallback also failed:', fallbackErr);
      }
    }

    // The backend rotates expired sessions and seeds itself. The browser cannot
    // authenticate administrative seed routes, so retry the resolver only.
    if (!data?.returnValue || (!data?.url && !data?.proxyPath)) {
      try {
        console.warn('[api] Resolver returned no stream. Retrying once...');
        const retryRes = await fetch(buildUrl(contentId, seriesId));
        const retryData = await retryRes.json();
        if (retryData && (retryData.url || retryData.proxyPath)) {
          data = retryData;
        } else if (seriesId && seriesId !== contentId) {
          const retrySwapRes = await fetch(buildUrl(seriesId, contentId));
          const retrySwapData = await retrySwapRes.json();
          if (retrySwapData && (retrySwapData.url || retrySwapData.proxyPath)) {
            data = retrySwapData;
          }
        }
      } catch (e) {
        console.error('[api] Self-healing resolve retry failed:', e);
      }
    }

    return {
      url: (data && (data.proxyPath || data.url)) || '',
      codec: data?.codec,
      mime: data?.mime,
      isHls: data?.isHls,
      subtitles: data?.subtitles || [],
      audioLanguages: data?.audioLanguages || [],
      availableTracks: data?.availableTracks || [],
      trackIndex: data?.trackIndex,
      contentId,
      seriesId,
    };
  },

  async resolveVod(contentId: string, seriesId?: string, trackIndex?: number): Promise<ResolveResponse> {
    return api.resolveMedia(contentId, seriesId, trackIndex);
  },
};
