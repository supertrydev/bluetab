import { config } from '../config/config';
import { canAccessFeature } from '../utils/feature-gate';
import { AIAllowanceService } from './ai-allowance-service';
import { getAIRequestHeaders, getAISettings } from './ai-request';

const LOG_PREFIX = '[BlueTab][AIService]';
const NAME_GROUP_TIMEOUT_MS = 15_000;

/** Small worker-safe naming request. Failures leave the generated name intact. */
export async function suggestGroupName(tabs: { title: string; url: string }[]): Promise<string | null> {
  // Single-tab groups skip AI naming
  if (tabs.length < 2) return null;

  // Naming follows the saved preference and Pro access, independently of the notice.
  try {
    const settings = await getAISettings();
    if (!settings.smartNaming) return null;
    if (!(await canAccessFeature('ai_commands')).allowed) return null;
  } catch {
    return null;
  }

  try {
    const response = await fetch(
      config.supertry.apiUrl + config.ai.nameGroupEndpoint,
      {
        method: 'POST',
        headers: await getAIRequestHeaders(),
        body: JSON.stringify({ tabs: tabs.slice(0, 10) }),
        // The naming model thinks before it answers; 5 s cut off names the
        // server had already produced, leaving the group untitled.
        signal: AbortSignal.timeout(NAME_GROUP_TIMEOUT_MS),
      }
    );
    await AIAllowanceService.syncFromAIResponse(response);
    if (!response.ok) {
      console.warn(`${LOG_PREFIX} suggestGroupName: HTTP ${response.status}`);
      return null;
    }
    const data = await response.json() as { name: string };
    return data.name ?? null;
  } catch (err) {
    // warn, not log: store builds strip console.log.
    console.warn(`${LOG_PREFIX} suggestGroupName: no name`, err);
    return null;
  }
}
