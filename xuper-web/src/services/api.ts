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
}

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

export const api = {
  async ping(): Promise<boolean> {
    try {
      const res = await fetch(`${getApiBaseUrl()}/ping`, { signal: AbortSignal.timeout(3000) });
      const data = await res.json();
      return !!data.returnValue;
    } catch {
      return false;
    }
  },

  async getLiveCategories(): Promise<{ id: string; name: string }[]> {
    try {
      const res = await fetch(`${getApiBaseUrl()}/liveCategories`);
      const data = await res.json();
      if (data.categories && Array.isArray(data.categories)) {
        return data.categories.map((c: any) => ({
          id: String(c.id || c.columnId || c.code),
          name: c.name || c.title || 'General',
        }));
      }
      return [];
    } catch (e) {
      console.error('Error fetching categories:', e);
      return [];
    }
  },

  async getLiveChannels(columnId?: string, pageNum = 1, pageSize = 200): Promise<Channel[]> {
    try {
      const params = new URLSearchParams();
      if (columnId && columnId !== 'all') params.set('columnId', columnId);
      params.set('pageNum', String(pageNum));
      params.set('pageSize', String(pageSize));

      const res = await fetch(`${getApiBaseUrl()}/liveChannels?${params.toString()}`);
      const data = await res.json();
      if (data.channels && Array.isArray(data.channels)) {
        return data.channels;
      }
      return [];
    } catch (e) {
      console.error('Error fetching live channels:', e);
      return [];
    }
  },

  async resolveLive(channelCode: string, streamUrl?: string): Promise<{ url: string }> {
    const params = new URLSearchParams();
    if (channelCode) params.set('channelCode', channelCode);
    if (streamUrl) params.set('streamUrl', streamUrl);

    const res = await fetch(`${getApiBaseUrl()}/resolveLive?${params.toString()}`);
    const data = await res.json();
    return {
      url: data.proxyPath || data.url || '',
    };
  },

  async getHome(
    root: 'featured' | 'movies' | 'series' | 'anime' | 'kids' = 'movies',
    page = 1
  ): Promise<MediaItem[]> {
    try {
      const res = await fetch(`${getApiBaseUrl()}/home?root=${root}&page=${page}`);
      const data = await res.json();
      if (data.items && Array.isArray(data.items)) {
        return data.items;
      }
      return [];
    } catch (e) {
      console.error('Error fetching catalog:', e);
      return [];
    }
  },

  async getDetail(id: string): Promise<MediaDetailResponse | null> {
    try {
      const res = await fetch(`${getApiBaseUrl()}/detail?id=${encodeURIComponent(id)}`);
      const data = await res.json();
      if (data.returnValue && data.item) {
        return {
          item: data.item,
          episodes: data.episodes || [],
          seasons: data.seasons || [],
        };
      }
      return null;
    } catch (e) {
      console.error('Error fetching media detail:', e);
      return null;
    }
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

  async resolveMedia(contentId: string, seriesId?: string): Promise<{ url: string; codec?: string }> {
    const params = new URLSearchParams();
    params.set('id', contentId);
    if (seriesId) params.set('series', seriesId);

    const res = await fetch(`${getApiBaseUrl()}/resolve?${params.toString()}`);
    const data = await res.json();
    return {
      url: data.proxyPath || data.url || '',
      codec: data.codec,
    };
  },
};
