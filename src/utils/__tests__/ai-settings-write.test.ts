import { planSettingsWrite } from '../ai-settings-write';

describe('planSettingsWrite', () => {
  it('accepts valid values and routes them to the right store', () => {
    const plan = planSettingsWrite({
      theme: 'dark',
      floatingButtonEnabled: false,
      pomodoroPreset: 'deepWork',
      customWork: 45,
      focusEnabled: true,
      focusPresets: { socialMedia: true, notAPreset: true },
      smartNaming: false,
      autoArchiveInactiveDays: 14,
    });

    expect(plan.general).toEqual({ theme: 'dark', floatingButtonEnabled: false, autoArchiveInactiveDays: 14 });
    expect(plan.pomodoro).toEqual({ preset: 'deepWork', customWork: 45 });
    expect(plan.focus).toEqual({ enabled: true, presets: { socialMedia: true } });
    expect(plan.ai).toEqual({ smartNaming: false });
    expect(plan.rejected).toEqual([]);
  });

  it('rejects unknown keys, wrong types, bad enums and out-of-range numbers', () => {
    const plan = planSettingsWrite({
      theme: 'blue',
      floatingButtonEnabled: 'yes',
      customWork: 0,
      maxGroups: 2.5,
      autoArchiveInactiveDays: 5,
      groupMenuConfig: {},
      madeUpKey: true,
    });

    expect(plan.applied).toEqual([]);
    expect(plan.rejected.map((entry) => entry.key).sort()).toEqual([
      'autoArchiveInactiveDays', 'customWork', 'floatingButtonEnabled', 'groupMenuConfig', 'madeUpKey', 'maxGroups', 'theme',
    ]);
    expect(plan.general).toEqual({});
  });

  it('normalises custom domains and allows clearing the list', () => {
    expect(planSettingsWrite({ focusCustomDomains: ['https://www.X.com/home', 'x.com', 'bad'] }).focus)
      .toEqual({ customDomains: ['x.com'] });
    expect(planSettingsWrite({ focusCustomDomains: [] }).focus).toEqual({ customDomains: [] });
    expect(planSettingsWrite({ focusCustomDomains: ['nope'] }).rejected).toHaveLength(1);
    expect(planSettingsWrite({ focusCustomDomains: 'x.com' }).rejected).toHaveLength(1);
  });
});
