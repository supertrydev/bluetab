/**
 * Suggested sources, by topic. A source is offered when it is in English or in
 * the language of the interface.
 */
export type FeedTopic = 'news' | 'technology' | 'development';

export interface FeedTemplate {
  id: string;
  title: string;
  url: string;
  topic: FeedTopic;
  language: 'en' | 'tr';
}

export function getFeedTemplates(uiLanguage: string): FeedTemplate[] {
  const language = uiLanguage.toLowerCase().split('-')[0];
  // Sources in the user's own language come first.
  return FEED_TEMPLATES
    .filter((template) => template.language === 'en' || template.language === language)
    .sort((a, b) => Number(b.language === language) - Number(a.language === language));
}

export const FEED_TEMPLATES: FeedTemplate[] = [
  {
    id: 'bbc-news',
    title: 'BBC News',
    url: 'https://feeds.bbci.co.uk/news/rss.xml',
    topic: 'news',
    language: 'en',
  },
  {
    id: 'guardian-international',
    title: 'The Guardian',
    url: 'https://www.theguardian.com/international/rss',
    topic: 'news',
    language: 'en',
  },
  {
    id: 'nytimes-home',
    title: 'The New York Times',
    url: 'https://www.nytimes.com/services/xml/rss/nyt/HomePage.xml',
    topic: 'news',
    language: 'en',
  },
  {
    id: 'wired',
    title: 'WIRED',
    url: 'https://www.wired.com/feed/rss',
    topic: 'technology',
    language: 'en',
  },
  {
    id: 'techcrunch',
    title: 'TechCrunch',
    url: 'https://techcrunch.com/feed/',
    topic: 'technology',
    language: 'en',
  },
  {
    id: 'ars-technica',
    title: 'Ars Technica',
    url: 'https://feeds.arstechnica.com/arstechnica/index',
    topic: 'technology',
    language: 'en',
  },
  {
    id: 'the-verge',
    title: 'The Verge',
    url: 'https://www.theverge.com/rss/index.xml',
    topic: 'technology',
    language: 'en',
  },
  {
    id: 'hacker-news',
    title: 'Hacker News',
    url: 'https://news.ycombinator.com/rss',
    topic: 'development',
    language: 'en',
  },
  {
    id: 'trt-son-dakika',
    title: 'TRT Haber',
    url: 'https://www.trthaber.com/sondakika_articles.rss',
    topic: 'news',
    language: 'tr',
  },
  {
    id: 'trt-bilim-teknoloji',
    title: 'TRT Bilim Teknoloji',
    url: 'https://www.trthaber.com/bilim_teknoloji_articles.rss',
    topic: 'technology',
    language: 'tr',
  },
  {
    id: 'bbc-turkce',
    title: 'BBC T\u00fcrk\u00e7e',
    url: 'https://www.bbc.com/turkce/index.xml',
    topic: 'news',
    language: 'tr',
  },
  {
    id: 'webrazzi',
    title: 'Webrazzi',
    url: 'https://webrazzi.com/feed/',
    topic: 'technology',
    language: 'tr',
  },
  {
    id: 'shiftdelete',
    title: 'ShiftDelete.Net',
    url: 'https://shiftdelete.net/feed',
    topic: 'technology',
    language: 'tr',
  },
  {
    id: 'donanimhaber',
    title: 'Donan\u0131mHaber',
    url: 'https://www.donanimhaber.com/rss/tum/',
    topic: 'technology',
    language: 'tr',
  },
  {
    id: 'diken',
    title: 'Diken',
    url: 'https://www.diken.com.tr/feed/',
    topic: 'news',
    language: 'tr',
  },
  {
    id: 'medyascope',
    title: 'Medyascope',
    url: 'https://medyascope.tv/feed/',
    topic: 'news',
    language: 'tr',
  },
  {
    id: 'gazete-duvar',
    title: 'Gazete Duvar',
    url: 'https://www.gazeteduvar.com.tr/rss',
    topic: 'news',
    language: 'tr',
  },
  {
    id: 'aa-teyit-bilim',
    title: 'AA Teyit Hatt\u0131',
    url: 'https://www.aa.com.tr/tr/teyithatti/rss/news?cat=bilim-teknoloji',
    topic: 'news',
    language: 'tr',
  },
];
