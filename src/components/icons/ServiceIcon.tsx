/**
 * ServiceIcon — packaged brand mark for one curated integration.
 */

import { useTranslation } from 'react-i18next';

interface ServiceBrand {
  title: string;
  hex: string;
  asset: string;
}

const SERVICE_BRANDS: Record<string, ServiceBrand> = {
  linear: { title: 'Linear', hex: '5E6AD2', asset: 'linear.svg' },
  todoist: { title: 'Todoist', hex: 'E44332', asset: 'todoist.svg' },
  notion: { title: 'Notion', hex: '000000', asset: 'notion.svg' },
  github: { title: 'GitHub', hex: '181717', asset: 'github.svg' },
  'google-calendar': { title: 'Google Calendar', hex: '4285F4', asset: 'google-calendar.svg' },
  'outlook-calendar': { title: 'Outlook Calendar', hex: '0078D4', asset: 'outlook-calendar.svg' },
  slack: { title: 'Slack', hex: '4A154B', asset: 'slack.svg' },
  discord: { title: 'Discord', hex: '5865F2', asset: 'discord.svg' },
  jira: { title: 'Jira', hex: '0052CC', asset: 'jira.svg' },
  trello: { title: 'Trello', hex: '0052CC', asset: 'trello.svg' },
  asana: { title: 'Asana', hex: 'F06A6A', asset: 'asana.svg' },
  gitlab: { title: 'GitLab', hex: 'FC6D26', asset: 'gitlab.svg' },
  readwise: { title: 'Readwise', hex: '8B5CF6', asset: 'readwise.svg' },
};

const FALLBACK_BRAND: ServiceBrand = {
  title: 'Integration',
  hex: '64748B',
  asset: 'logo-light.svg',
};

function lookup(id: string): ServiceBrand {
  return SERVICE_BRANDS[id] ?? FALLBACK_BRAND;
}

function getBrandAssetUrl(asset: string): string {
  const path = asset.startsWith('logo-')
    ? `src/assets/${asset}`
    : `src/assets/brand-icons/${asset}`;

  return chrome.runtime.getURL(path);
}

interface ServiceIconProps {
  /** Bluetab integration id (e.g. "notion", "google-calendar"). */
  id: string;
  /** Pixel size of the image. Default 16. */
  size?: number;
  /** Optional className applied to the <img>. */
  className?: string;
}

export function ServiceIcon({ id, size = 16, className }: ServiceIconProps) {
  const { t } = useTranslation();
  const brand = lookup(id);

  return (
    <img
      src={getBrandAssetUrl(brand.asset)}
      alt=""
      aria-label={brand === FALLBACK_BRAND ? t('components.serviceIcon.integration') : brand.title}
      width={size}
      height={size}
      className={className}
      draggable={false}
    />
  );
}

export function getServiceBrandHex(id: string): string | null {
  return lookup(id).hex;
}
