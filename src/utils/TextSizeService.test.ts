import {
  TextSizeService,
} from './TextSizeService';
import {
  DEFAULT_TEXT_SIZE_CONFIG,
  DEFAULT_TEXT_SIZE_SETTINGS,
  TEXT_SIZE_VALUES,
  type TextSizeSettings,
} from '../types/text-size';
import { Storage } from './storage';

jest.mock('./storage', () => ({
  Storage: {
    get: jest.fn(),
    set: jest.fn(),
  },
}));

const mockedStorage = Storage as jest.Mocked<typeof Storage>;

describe('TextSizeService', () => {
  const setProperty = jest.fn();
  const documentElement = {
    style: {
      setProperty,
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (TextSizeService as unknown as { instance?: TextSizeService }).instance = undefined;
    mockedStorage.get.mockResolvedValue({
      ...DEFAULT_TEXT_SIZE_SETTINGS,
      textSize: 'medium',
    });
    mockedStorage.set.mockResolvedValue(undefined);
    (global as Record<string, unknown>).document = {
      documentElement,
    };
  });

  it('initializes idempotently and registers one storage listener', async () => {
    const service = TextSizeService.getInstance(DEFAULT_TEXT_SIZE_CONFIG);

    await service.initialize();
    await service.initialize();

    expect(setProperty).toHaveBeenCalledWith(
      DEFAULT_TEXT_SIZE_CONFIG.cssPropertyName,
      TEXT_SIZE_VALUES.medium,
    );
    expect(chrome.storage.onChanged.addListener).toHaveBeenCalledTimes(1);
  });

  it('reapplies text size when synced local storage changes without rewriting storage', async () => {
    const service = TextSizeService.getInstance(DEFAULT_TEXT_SIZE_CONFIG);
    await service.initialize();

    const changeListener = (chrome.storage.onChanged.addListener as jest.Mock).mock.calls[0][0] as (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => void | Promise<void>;

    const syncedSettings: TextSizeSettings = {
      ...DEFAULT_TEXT_SIZE_SETTINGS,
      textSize: 'large',
      lastUpdated: Date.now() + 1,
    };

    setProperty.mockClear();
    mockedStorage.set.mockClear();

    await changeListener(
      {
        [DEFAULT_TEXT_SIZE_CONFIG.storageKey]: {
          oldValue: DEFAULT_TEXT_SIZE_SETTINGS,
          newValue: syncedSettings,
        },
      },
      'local',
    );

    expect(setProperty).toHaveBeenCalledWith(
      DEFAULT_TEXT_SIZE_CONFIG.cssPropertyName,
      TEXT_SIZE_VALUES.large,
    );
    expect(mockedStorage.set).not.toHaveBeenCalled();
    expect(service.getCurrentTextSize()).toBe('large');
  });
});
