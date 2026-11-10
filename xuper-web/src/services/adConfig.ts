export interface VideoAdItem {
  id: string;
  advertiser: string;
  title: string;
  description: string;
  videoUrl: string;
  targetUrl: string;
  duration: number; // in seconds
  skipDelay: number; // in seconds
  networkBadge: string;
}

export interface BannerAdItem {
  id: string;
  advertiser: string;
  title: string;
  subtitle: string;
  ctaText: string;
  imageUrl?: string;
  targetUrl: string;
  networkBadge: string;
}

export interface InterstitialAdItem {
  id: string;
  advertiser: string;
  title: string;
  tagline: string;
  badge: string;
  description: string;
  bulletPoints: string[];
  ctaText: string;
  targetUrl: string;
  imageUrl?: string;
  videoUrl?: string;
  networkBadge: string;
}

export const SAMPLE_VIDEO_ADS: VideoAdItem[] = [
  {
    id: 'ad_cyber_vpn',
    advertiser: 'CyberShield VPN',
    title: 'Navega en Ultra HD 4K con privacidad total',
    description: 'Evita bloqueos de operadoras y desbloquea señales de todo el mundo a máxima velocidad.',
    videoUrl: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
    targetUrl: 'https://monetag.com',
    duration: 15,
    skipDelay: 5,
    networkBadge: 'Red Monetag • Anuncio de Video',
  },
  {
    id: 'ad_cloud_gaming',
    advertiser: 'NovaPlay Cloud Gaming',
    title: 'Juega en tu Smart TV sin consolas',
    description: 'Más de 500 juegos de última generación transmitidos en 60fps directamente a tu pantalla.',
    videoUrl: 'https://www.w3schools.com/html/mov_bbb.mp4',
    targetUrl: 'https://adsterra.com',
    duration: 12,
    skipDelay: 5,
    networkBadge: 'Red Adsterra • Anuncio de Video',
  },
];

export const SAMPLE_BANNER_ADS: BannerAdItem[] = [
  {
    id: 'banner_adsterra',
    advertiser: 'Adsterra Network Partner',
    title: 'Fibra Óptica 1 Gbps Simétrica',
    subtitle: 'El mejor internet para tus películas y fútbol en vivo sin cortes.',
    ctaText: 'Ver Planes',
    targetUrl: 'https://adsterra.com',
    networkBadge: 'Adsterra Display Ad',
  },
  {
    id: 'banner_monetag',
    advertiser: 'Monetag Premium Ads',
    title: 'Smart TV 4K OLED • 45% Descuento',
    subtitle: 'Disfruta tus series favoritas con sonido Dolby Atmos envolvente.',
    ctaText: 'Aprovechar Oferta',
    targetUrl: 'https://monetag.com',
    networkBadge: 'Monetag Banner 728x90',
  },
];

export const SAMPLE_INTERSTITIAL_ADS: InterstitialAdItem[] = [
  {
    id: 'inter_exoclick',
    advertiser: 'StreamPass Premium VIP',
    title: 'Desbloquea Canales Exclusivos y Deportes en Vivo',
    tagline: 'La mejor experiencia de streaming sin límites de velocidad.',
    badge: 'OFERTA ESPECIAL 2026',
    description:
      'Accede a más de 5,000 películas en calidad Master 4K HDR, servidores con ancho de banda dedicado y soporte multi-pantalla simultáneo.',
    bulletPoints: [
      'Cero cortes en partidos de fútbol y eventos en vivo',
      'Audio 5.1 y pistas de doblaje en español e idiomas originales',
      'Compatible con Smart TV, PC, tablet y teléfonos móviles',
    ],
    ctaText: 'Comenzar Prueba Gratis de 30 Días',
    targetUrl: 'https://adsterra.com',
    networkBadge: 'Red Adsterra / Monetag Interstitial',
  },
];

export const adManager = {
  isAdsEnabled(): boolean {
    const saved = localStorage.getItem('xuper_ads_enabled');
    // Default to true so user can test the ads immediately
    return saved === null ? true : saved === 'true';
  },

  setAdsEnabled(enabled: boolean): void {
    localStorage.setItem('xuper_ads_enabled', String(enabled));
  },

  getAdNetwork(): 'monetag' | 'adsterra' | 'exoclick' | 'custom' {
    return (localStorage.getItem('xuper_ad_network') as any) || 'monetag';
  },

  setAdNetwork(net: string): void {
    localStorage.setItem('xuper_ad_network', net);
  },

  getRandomVideoAd(): VideoAdItem {
    const idx = Math.floor(Math.random() * SAMPLE_VIDEO_ADS.length);
    return SAMPLE_VIDEO_ADS[idx];
  },

  getRandomBannerAd(): BannerAdItem {
    const idx = Math.floor(Math.random() * SAMPLE_BANNER_ADS.length);
    return SAMPLE_BANNER_ADS[idx];
  },

  getInterstitialAd(): InterstitialAdItem {
    return SAMPLE_INTERSTITIAL_ADS[0];
  },
};
