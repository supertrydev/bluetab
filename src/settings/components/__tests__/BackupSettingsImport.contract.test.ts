import * as fs from 'fs';
import * as path from 'path';

const BACKUP_SETTINGS_FILE = path.resolve(__dirname, '../BackupSettings.tsx');
const REVIEW_PROMPT_FILE = path.resolve(__dirname, '../../../components/CWSReviewPrompt.tsx');
const ENGLISH_RESOURCE_FILE = path.resolve(__dirname, '../../../i18n/locales/en.json');

const backupSettingsSource = fs.readFileSync(BACKUP_SETTINGS_FILE, 'utf-8');
const english = JSON.parse(fs.readFileSync(ENGLISH_RESOURCE_FILE, 'utf-8'));

describe('Backup settings import contract', () => {
  it('uses backup wording and a single modal entry point for import', () => {
    expect(backupSettingsSource).toContain("t('settings.backup.exportBackup')");
    expect(backupSettingsSource).toContain("t('settings.backup.importBackup')");
    expect(english.settings.backup.exportBackup).toBe('Export Backup');
    expect(english.settings.backup.importBackup).toBe('Import Backup');
    expect(backupSettingsSource).not.toContain('Export JSON');
    expect(backupSettingsSource).not.toContain('Import Data');
    expect(backupSettingsSource).not.toContain('Import Bookmarks');
    expect(backupSettingsSource).not.toContain('Modal Preview');
    expect(backupSettingsSource).not.toContain('Actual Modals');
  });

  it('does not show competitor/product-specific import names in backup settings UI', () => {
    expect(backupSettingsSource).not.toMatch(/OneTab|Toby|Workona/i);
  });

  it('keeps live browser bookmark selection inside the Import Backup modal', () => {
    expect(backupSettingsSource).toContain("t('settings.backup.browserBookmarks')");
    expect(english.settings.backup.browserBookmarks).toBe('Browser Bookmarks');
    expect(backupSettingsSource).toContain('chrome.bookmarks.getTree');
    expect(backupSettingsSource).toContain('parseChromeBookmarks');
    expect(backupSettingsSource).toContain('convertToTabGroups');
    expect(backupSettingsSource).toContain("permissions: ['bookmarks']");
  });
});

describe('CWS review prompt contract', () => {
  it('uses neutral Chrome Web Store copy without star-rating manipulation', () => {
    const reviewPromptSource = fs.readFileSync(REVIEW_PROMPT_FILE, 'utf-8');

    expect(reviewPromptSource).toContain("t('dialogs.cwsReview.title')");
    expect(reviewPromptSource).toContain("t('dialogs.cwsReview.description')");
    expect(english.dialogs.cwsReview.title).toBe('Enjoying Bluetab?');
    expect(english.dialogs.cwsReview.description).toContain('Chrome Web Store');
    expect(reviewPromptSource).not.toMatch(/5\s*stars?|five\s*stars?|rate us/i);
    expect(reviewPromptSource).not.toContain('Do you like Bluetab?');
  });

  it('does not keep temporary modal preview hooks in the options page', () => {
    const optionsSource = fs.readFileSync(path.resolve(__dirname, '../../../options/main.tsx'), 'utf-8');

    expect(optionsSource).not.toContain('#review-prompt-preview');
  });
});
