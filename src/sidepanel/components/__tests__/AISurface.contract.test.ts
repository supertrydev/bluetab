import * as fs from 'fs';
import * as path from 'path';

const AI_PANEL_FILE = path.resolve(__dirname, '../AIPanel.tsx');
const AI_THREAD_FILE = path.resolve(__dirname, '../AIChatThread.tsx');
const AI_SETTINGS_FILE = path.resolve(__dirname, '../../../settings/components/AISettings.tsx');
const AI_SERVICE_FILE = path.resolve(__dirname, '../../../services/ai-service.ts');
const AI_TYPES_FILE = path.resolve(__dirname, '../../../types/ai.ts');

const aiPanelSource = fs.readFileSync(AI_PANEL_FILE, 'utf-8');
const aiThreadSource = fs.readFileSync(AI_THREAD_FILE, 'utf-8');
const aiSettingsSource = fs.readFileSync(AI_SETTINGS_FILE, 'utf-8');
const aiServiceSource = fs.readFileSync(AI_SERVICE_FILE, 'utf-8');
const aiTypesSource = fs.readFileSync(AI_TYPES_FILE, 'utf-8');
const english = JSON.parse(fs.readFileSync(
  path.resolve(__dirname, '../../../i18n/locales/en.json'),
  'utf-8',
));

describe('AI surface contract', () => {
  it('does not render proactive suggestion cards above the chat thread', () => {
    expect(aiPanelSource).not.toContain('SuggestionCards');
    expect(aiPanelSource).not.toContain('generateSuggestions');
    expect(aiPanelSource).not.toContain('dismissSuggestion');
  });

  it('removes proactive suggestion settings and stale threshold controls', () => {
    expect(aiSettingsSource).not.toContain('Proactive Suggestions');
    expect(aiSettingsSource).not.toContain('Stale Tab Threshold');
    expect(aiSettingsSource).not.toContain('staleTabThreshold');
    expect(aiSettingsSource).not.toContain('proactiveSuggestions');
  });

  it('keeps the welcome prompts inline with the chat thread', () => {
    expect(aiThreadSource).toContain("sidepanel.aiChatThread.suggestions.whatCanYouDo.text");
    expect(aiThreadSource).toContain("sidepanel.aiChatThread.suggestions.groupTabs.text");
    expect(aiThreadSource).toContain("sidepanel.aiChatThread.suggestions.organizeGroups.text");
    expect(english.sidepanel.aiChatThread.suggestions).toMatchObject({
      whatCanYouDo: { text: 'What can you do?' },
      groupTabs: { text: 'Group tabs' },
      organizeGroups: { text: 'Organize groups' },
    });
  });

  it('keeps the inline AI safety notice under the chat composer', () => {
    expect(aiThreadSource).toContain('ComposerWithSafetyNote');
    expect(aiThreadSource).toContain("t('sidepanel.aiChatThread.safetyNote')");
    expect(english.sidepanel.aiChatThread.safetyNote).toBe('AI can make mistakes. Review important output before you act on it.');
  });

  it('drops proactive suggestion types from shared AI contracts', () => {
    expect(aiTypesSource).not.toContain('AISuggestion');
    expect(aiTypesSource).not.toContain('proactiveSuggestions');
    expect(aiTypesSource).not.toContain('staleTabThreshold');
    expect(aiServiceSource).not.toContain('generateSuggestions');
    expect(aiServiceSource).not.toContain('dismissSuggestion');
  });
});
