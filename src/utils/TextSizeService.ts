/**
 * Text Size Service for BlueTab Extension
 * Manages text size settings and CSS variable updates
 */

import {
  TextSizeOption,
  TextSizeSettings,
  TextSizeConfig,
  DEFAULT_TEXT_SIZE_CONFIG,
  DEFAULT_TEXT_SIZE_SETTINGS,
  TEXT_SIZE_VALUES,
  isValidTextSize
} from '../types/text-size';
import { Storage } from './storage';

export class TextSizeService {
  private static instance: TextSizeService;
  private config: TextSizeConfig;
  private currentSettings: TextSizeSettings | null = null;
  private storageChangeHandler: ((changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => void) | null = null;
  private externalListeners = new Set<(settings: TextSizeSettings) => void>();

  private constructor(config: TextSizeConfig = DEFAULT_TEXT_SIZE_CONFIG) {
    this.config = config;
  }

  /**
   * Get singleton instance of TextSizeService
   */
  public static getInstance(config?: TextSizeConfig): TextSizeService {
    if (!TextSizeService.instance) {
      TextSizeService.instance = new TextSizeService(config);
    }
    return TextSizeService.instance;
  }

  /**
   * Initialize the service and apply saved settings
   */
  public async initialize(): Promise<void> {
    try {
      const settings = await this.loadSettings();
      await this.applyTextSizeInternal(settings.textSize, { persist: false });
    } catch (error) {
      console.error('Failed to initialize TextSizeService:', error);
      this.currentSettings = {
        ...DEFAULT_TEXT_SIZE_SETTINGS,
        textSize: this.config.defaultSize,
      };
      await this.applyTextSizeInternal(this.config.defaultSize, { persist: false });
    } finally {
      this.ensureStorageChangeListener();
    }
  }

  /**
   * Load settings from Bluetab local storage.
   * Falls back to legacy chrome.storage.sync once so existing users keep
   * their preference when the key joins Bluetab Cloud Sync.
   */
  public async loadSettings(): Promise<TextSizeSettings> {
    try {
      const stored = await Storage.get<TextSizeSettings>(this.config.storageKey);

      if (stored && this.validateSettings(stored)) {
        this.currentSettings = stored;
        return stored;
      }

      const legacyResult = (await chrome.storage.sync.get(this.config.storageKey).catch(() => ({}))) as Record<string, unknown>;
      const legacyStored = legacyResult[this.config.storageKey];
      if (legacyStored && this.validateSettings(legacyStored)) {
        await Storage.set(this.config.storageKey, legacyStored);
        this.currentSettings = legacyStored;
        return legacyStored;
      }

      // Return default settings if none exist or invalid
      const defaultSettings = {
        ...DEFAULT_TEXT_SIZE_SETTINGS,
        textSize: this.config.defaultSize,
      };
      await this.saveSettings(defaultSettings);
      return this.currentSettings ?? defaultSettings;
    } catch (error) {
      console.error('Failed to load text size settings:', error);
      throw new Error('Failed to load settings from storage');
    }
  }

  /**
   * Save settings to Bluetab local storage so Cloud Sync can include it.
   */
  public async saveSettings(settings: TextSizeSettings): Promise<void> {
    try {
      if (!this.validateSettings(settings)) {
        throw new Error('Invalid settings provided');
      }

      const updatedSettings = {
        ...settings,
        lastUpdated: Date.now(),
      };

      await Storage.set(this.config.storageKey, updatedSettings);

      this.currentSettings = updatedSettings;
    } catch (error) {
      console.error('Failed to save text size settings:', error);
      throw new Error('Failed to save settings to storage');
    }
  }

  /**
   * Apply text size by updating CSS custom property
   */
  public async applyTextSize(size: TextSizeOption): Promise<void> {
    await this.applyTextSizeInternal(size, { persist: true });
  }

  private async applyTextSizeInternal(
    size: TextSizeOption,
    options: { persist: boolean },
  ): Promise<void> {
    try {
      if (!isValidTextSize(size)) {
        throw new Error(`Invalid text size: ${size}`);
      }

      // Performance measurement
      const startTime = performance.now();

      // Update CSS custom property
      const root = typeof document !== 'undefined' ? document.documentElement : null;
      const sizeValue = TEXT_SIZE_VALUES[size];

      root?.style.setProperty(this.config.cssPropertyName, sizeValue);

      const baseSettings = this.currentSettings ?? {
        ...DEFAULT_TEXT_SIZE_SETTINGS,
        textSize: this.config.defaultSize,
      };
      const updatedSettings: TextSizeSettings = {
        ...baseSettings,
        textSize: size,
      };

      if (options.persist) {
        await this.saveSettings(updatedSettings);
      } else {
        this.currentSettings = updatedSettings;
      }

      // Check performance target
      const duration = performance.now() - startTime;
      if (duration > 100) {
        console.warn(`Text size update took ${duration}ms (target: <100ms)`);
      }

      console.log(`Applied text size: ${size} (${sizeValue}) in ${duration.toFixed(2)}ms`);
    } catch (error) {
      console.error('Failed to apply text size:', error);
      throw new Error('Failed to apply text size');
    }
  }

  /**
   * Get current text size
   */
  public getCurrentTextSize(): TextSizeOption {
    return this.currentSettings?.textSize || this.config.defaultSize;
  }

  /**
   * Get current settings
   */
  public getCurrentSettings(): TextSizeSettings | null {
    return this.currentSettings;
  }

  /**
   * Update text size (convenience method)
   */
  public async updateTextSize(size: TextSizeOption): Promise<void> {
    await this.applyTextSize(size);
  }

  /**
   * Reset to default text size
   */
  public async resetToDefault(): Promise<void> {
    await this.applyTextSize(this.config.defaultSize);
  }

  /**
   * Validate settings object
   */
  private validateSettings(settings: any): settings is TextSizeSettings {
    return (
      settings &&
      typeof settings === 'object' &&
      isValidTextSize(settings.textSize) &&
      typeof settings.lastUpdated === 'number' &&
      typeof settings.version === 'string'
    );
  }

  /**
   * Get available text size options
   */
  public getAvailableOptions(): TextSizeOption[] {
    return Object.keys(TEXT_SIZE_VALUES) as TextSizeOption[];
  }

  /**
   * Get text size value for a given option
   */
  public getTextSizeValue(option: TextSizeOption): string {
    return TEXT_SIZE_VALUES[option];
  }

  /**
   * Add event listener for storage changes
   */
  public addStorageListener(callback: (settings: TextSizeSettings) => void): void {
    this.externalListeners.add(callback);
    this.ensureStorageChangeListener();
  }

  /**
   * Remove storage listener
   */
  public removeStorageListener(): void {
    this.externalListeners.clear();
  }

  private ensureStorageChangeListener(): void {
    if (this.storageChangeHandler) {
      return;
    }

    this.storageChangeHandler = (changes, areaName) => {
      if (areaName !== 'local' || !changes[this.config.storageKey]) {
        return;
      }

      const newSettings = changes[this.config.storageKey].newValue;
      if (!this.validateSettings(newSettings)) {
        return;
      }

      this.currentSettings = newSettings;
      void this.applyTextSizeInternal(newSettings.textSize, { persist: false })
        .then(() => this.notifyExternalListeners(newSettings))
        .catch((error) => {
          console.error('Failed to apply synced text size:', error);
        });
    };

    chrome.storage.onChanged.addListener(this.storageChangeHandler);
  }

  private notifyExternalListeners(settings: TextSizeSettings): void {
    for (const listener of this.externalListeners) {
      try {
        listener(settings);
      } catch (error) {
        console.error('TextSizeService listener failed:', error);
      }
    }
  }
}

// Export singleton instance
export const textSizeService = TextSizeService.getInstance();
