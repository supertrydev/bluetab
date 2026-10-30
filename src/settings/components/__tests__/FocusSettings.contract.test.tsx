import * as fs from 'fs';
import * as path from 'path';

const COMPONENT_FILE = path.resolve(__dirname, '../FocusSettings.tsx');
const source = fs.readFileSync(COMPONENT_FILE, 'utf-8');
const english = JSON.parse(fs.readFileSync(
  path.resolve(__dirname, '../../../i18n/locales/en.json'),
  'utf-8',
));

describe('FocusSettings preset and custom domain contract', () => {
  it('shows Social Media examples with X instead of Twitter', () => {
    expect(source).toContain("examples: t('settings.focus.presets.socialMedia.examples')");
    expect(english.settings.focus.presets.socialMedia.examples).toBe('X, Facebook, Instagram, TikTok, Reddit, LinkedIn, Threads');
    expect(source).not.toContain('Twitter/X');
  });

  it('renders preset examples with multiline clamping instead of hardcoded truncate copy', () => {
    expect(source).toContain('line-clamp-2');
    expect(source).not.toContain('truncate');
  });

  it('does not reject custom domains just because a preset category could cover them', () => {
    expect(source).not.toContain('Domain already covered by a preset category');
    expect(source).not.toContain('allPresetDomains');
  });

  it('keeps the AI scan entry visible on fresh installs and requests history permission directly when needed', () => {
    expect(source).toContain("import { hasHistoryPermission, requestHistoryPermission } from '@/services/history-permission';");
    expect(source).toContain('const handleOpenScan');
    expect(source).toContain('await requestHistoryPermission()');
    expect(source).not.toContain("import { ConsentModal } from './ConsentModal';");
    expect(source).not.toContain('setShowConsentModal(true)');
    expect(source).not.toContain('{hasMinHistory === true && (');
    expect(source).not.toContain('disabled={!hasHistoryPermission}');
  });

  it('offers a multiline URL or title phrase blocklist', () => {
    expect(source).toContain("t('settings.focus.blockedPhrasesTitle')");
    expect(source).toContain("t('settings.focus.blockedPhrasesDescription')");
    expect(english.settings.focus.blockedPhrasesTitle).toBe('Blocked URL or Title Phrases');
    expect(english.settings.focus.blockedPhrasesDescription).toContain('One phrase per line');
    expect(source).toContain('blockedPhrases');
  });
});
