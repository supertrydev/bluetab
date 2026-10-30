/**
 * Curated starter feeds for the Add Feed dialog. These are ordinary RSS/Atom
 * URLs, so users can preview before subscribing and edit the category.
 */
export type FeedTemplateRegion = 'english' | 'turkish';

export interface FeedTemplate {
  id: string;
  title: string;
  description: string;
  url: string;
  category: string;
  region: FeedTemplateRegion;
}

export const FEED_TEMPLATES: FeedTemplate[] = [
  {
    id: 'bbc-news',
    title: 'BBC News',
    description: 'World and UK headlines',
    url: 'https://feeds.bbci.co.uk/news/rss.xml',
    category: 'News',
    region: 'english',
  },
  {
    id: 'guardian-international',
    title: 'The Guardian',
    description: 'International front page',
    url: 'https://www.theguardian.com/international/rss',
    category: 'News',
    region: 'english',
  },
  {
    id: 'nytimes-home',
    title: 'The New York Times',
    description: 'Homepage headlines',
    url: 'https://www.nytimes.com/services/xml/rss/nyt/HomePage.xml',
    category: 'News',
    region: 'english',
  },
  {
    id: 'wired',
    title: 'WIRED',
    description: 'Technology, culture, and science',
    url: 'https://www.wired.com/feed/rss',
    category: 'Technology',
    region: 'english',
  },
  {
    id: 'techcrunch',
    title: 'TechCrunch',
    description: 'Startups and tech business',
    url: 'https://techcrunch.com/feed/',
    category: 'Technology',
    region: 'english',
  },
  {
    id: 'ars-technica',
    title: 'Ars Technica',
    description: 'Technology analysis',
    url: 'https://feeds.arstechnica.com/arstechnica/index',
    category: 'Technology',
    region: 'english',
  },
  {
    id: 'the-verge',
    title: 'The Verge',
    description: 'Tech, platforms, and culture',
    url: 'https://www.theverge.com/rss/index.xml',
    category: 'Technology',
    region: 'english',
  },
  {
    id: 'hacker-news',
    title: 'Hacker News',
    description: 'Developer and startup links',
    url: 'https://news.ycombinator.com/rss',
    category: 'Development',
    region: 'english',
  },
  {
    id: 'trt-son-dakika',
    title: 'TRT Haber',
    description: 'Breaking news updates',
    url: 'https://www.trthaber.com/sondakika_articles.rss',
    category: 'News',
    region: 'turkish',
  },
  {
    id: 'trt-bilim-teknoloji',
    title: 'TRT Bilim Teknoloji',
    description: 'Science and technology coverage',
    url: 'https://www.trthaber.com/bilim_teknoloji_articles.rss',
    category: 'Technology',
    region: 'turkish',
  },
  {
    id: 'bbc-turkce',
    title: 'BBC Turkce',
    description: 'World and Turkey news',
    url: 'https://www.bbc.com/turkce/index.xml',
    category: 'News',
    region: 'turkish',
  },
  {
    id: 'webrazzi',
    title: 'Webrazzi',
    description: 'Startups and technology ecosystem',
    url: 'https://webrazzi.com/feed/',
    category: 'Technology',
    region: 'turkish',
  },
  {
    id: 'shiftdelete',
    title: 'ShiftDelete.Net',
    description: 'Technology news',
    url: 'https://shiftdelete.net/feed',
    category: 'Technology',
    region: 'turkish',
  },
  {
    id: 'donanimhaber',
    title: 'DonanimHaber',
    description: 'Hardware and technology news',
    url: 'https://www.donanimhaber.com/rss/tum/',
    category: 'Technology',
    region: 'turkish',
  },
  {
    id: 'diken',
    title: 'Diken',
    description: 'Turkey news cycle',
    url: 'https://www.diken.com.tr/feed/',
    category: 'News',
    region: 'turkish',
  },
  {
    id: 'medyascope',
    title: 'Medyascope',
    description: 'News and analysis',
    url: 'https://medyascope.tv/feed/',
    category: 'News',
    region: 'turkish',
  },
  {
    id: 'gazete-duvar',
    title: 'Gazete Duvar',
    description: 'News and commentary',
    url: 'https://www.gazeteduvar.com.tr/rss',
    category: 'News',
    region: 'turkish',
  },
  {
    id: 'aa-teyit-bilim',
    title: 'AA Teyit Hatti',
    description: 'Science and technology fact-checking',
    url: 'https://www.aa.com.tr/tr/teyithatti/rss/news?cat=bilim-teknoloji',
    category: 'Fact Check',
    region: 'turkish',
  },
];
