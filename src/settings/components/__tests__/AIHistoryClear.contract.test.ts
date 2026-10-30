import * as fs from 'fs';
import * as path from 'path';

const AI_SETTINGS_FILE = path.resolve(__dirname, '../AISettings.tsx');
const AI_CHAT_HOOK_FILE = path.resolve(__dirname, '../../../sidepanel/hooks/useAIChat.ts');
const aiSettingsSource = fs.readFileSync(AI_SETTINGS_FILE, 'utf-8');
const aiChatHookSource = fs.readFileSync(AI_CHAT_HOOK_FILE, 'utf-8');

describe('AI history clear contract', () => {
  it('delegates Clear AI History to AIService.clearHistory instead of removing only the legacy key', () => {
    expect(aiSettingsSource).toContain("import { AIService } from '@/services/ai-service';");
    expect(aiSettingsSource).toContain('await AIService.clearHistory();');
    expect(aiSettingsSource).not.toContain("Storage.remove('ai_history')");
  });

  it('broadcasts and receives an AI_HISTORY_CLEARED reset so open sidepanels clear immediately', () => {
    expect(aiSettingsSource).toContain("type: 'AI_HISTORY_CLEARED'");
    expect(aiChatHookSource).toContain("message?.type !== 'AI_HISTORY_CLEARED'");
    expect(aiChatHookSource).toContain('commitThreads([freshThread]);');
    expect(aiChatHookSource).toContain('chat.setMessages([]);');
  });
});
