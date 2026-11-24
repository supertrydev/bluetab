import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { RSSFeed } from '@/types/rss';

/** The site's icon, or the first letter of its name when there is none. */
export function FeedIcon({ feed, className }: { feed: Pick<RSSFeed, 'title' | 'faviconUrl'>; className?: string }) {
  const [failedUrl, setFailedUrl] = useState('');
  if (feed.faviconUrl && failedUrl !== feed.faviconUrl) {
    return (
      <img
        src={feed.faviconUrl}
        alt=""
        className={cn('h-4 w-4 shrink-0 rounded-xs object-cover', className)}
        onError={() => setFailedUrl(feed.faviconUrl)}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded-xs bg-muted text-xs font-medium leading-none text-text-muted', className)}
    >
      {[...feed.title.trim()][0]?.toLocaleUpperCase() ?? ''}
    </span>
  );
}
