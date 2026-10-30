import { DEFAULT_FOCUS_SETTINGS, normalizeFocusSettings } from './focus-presets';

describe('normalizeFocusSettings', () => {
  it('fills missing focus fields from defaults', () => {
    expect(
      normalizeFocusSettings({
        autoEnableWithPomodoro: false,
      }),
    ).toEqual({
      ...DEFAULT_FOCUS_SETTINGS,
      autoEnableWithPomodoro: false,
    });
  });

  it('fills missing preset flags without overwriting provided values', () => {
    expect(
      normalizeFocusSettings({
        presets: { socialMedia: true },
        customDomains: ['kick.com'],
      }),
    ).toEqual({
      ...DEFAULT_FOCUS_SETTINGS,
      presets: {
        ...DEFAULT_FOCUS_SETTINGS.presets,
        socialMedia: true,
      },
      customDomains: ['kick.com'],
    });
  });
});
