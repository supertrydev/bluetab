import { ADHDService } from '@/services/adhd-service';
import { PomodoroService } from '@/services/pomodoro-service';

export interface FocusPreferences {
  tabs: 8 | 12 | 20 | null;
  timer: 'pomodoro' | 'flowtime' | 'visual' | 'none';
  suspend: 30 | 120 | null;
}

/** Apply only on Finish; exploring or skipping the questions writes nothing. */
export async function applyFocusPreferences(answers: FocusPreferences): Promise<void> {
  if (answers.timer === 'pomodoro' || answers.timer === 'visual') {
    await PomodoroService.setPreset('classic');
  }
  await ADHDService.updateSettings({
    masterEnabled: answers.tabs !== null || answers.timer !== 'none' || answers.suspend !== null,
    visibleTabLimit: { enabled: answers.tabs !== null, ...(answers.tabs !== null ? { limit: answers.tabs } : {}) },
    flowtimeTimer: { enabled: answers.timer === 'flowtime' },
    visualTime: { enabled: answers.timer === 'visual' },
    autoSuspend: { enabled: answers.suspend !== null, ...(answers.suspend !== null ? { thresholdMin: answers.suspend } : {}) },
  });
}
