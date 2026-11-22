import { Storage } from '../utils/storage';
import { getAccessToken } from '../utils/auth-state';
import { DEFAULT_AI_SETTINGS, type AISettings } from '../types/ai';

export async function getAISettings(): Promise<AISettings> {
  const stored = (await Storage.get<Partial<AISettings>>('ai_settings')) ?? {};
  return { ...DEFAULT_AI_SETTINGS, ...stored };
}

export async function getAIRequestHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}
