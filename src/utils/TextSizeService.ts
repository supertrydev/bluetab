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

export class TextSizeService {
  private static instance: TextSizeService;
  private config: TextSizeConfig;
  private currentSettings: TextSizeSettings | null = null;

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
      await this.applyTextSize(settings.textSize);
    } catch (error) {
      console.error('Failed to initialize TextSizeService:', error);
      // Apply default settings on error
      await this.applyTextSize(this.config.defaultSize);
    }
  }

  /**
   * Load settings from Chrome storage
   */
  public async loadSettings(): Promise<TextSizeSettings> {
    try {
      const result = await chrome.storage.sync.get(this.config.storageKey);
      const stored = result[this.config.storageKey];

      if (stored && this.validateSettings(stored)) {
        this.currentSettings = stored;
        return stored;
      }

      // Return default settings if none exist or invalid
      const defaultSettings = { ...DEFAULT_TEXT_SIZE_SETTINGS };
      await this.saveSettings(defaultSettings);
      this.currentSettings = defaultSettings;
      return defaultSettings;
    } catch (error) {
      console.error('Failed to load text size settings:', error);
      throw new Error('Failed to load settings from storage');
    }
  }

  /**
   * Save settings to Chrome storage
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

      await chrome.storage.sync.set({
        [this.config.storageKey]: updatedSettings
      });

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
    try {
      if (!isValidTextSize(size)) {
        throw new Error(`Invalid text size: ${size}`);
      }

      // Performance measurement
      const startTime = performance.now();

      // Update CSS custom property
      const root = document.documentElement;
      const sizeValue = TEXT_SIZE_VALUES[size];

      root.style.setProperty(this.config.cssPropertyName, sizeValue);

      // Update current settings
      if (this.currentSettings) {
        const updatedSettings: TextSizeSettings = {
          ...this.currentSettings,
          textSize: size,
        };
        await this.saveSettings(updatedSettings);
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
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'sync' && changes[this.config.storageKey]) {
        const newSettings = changes[this.config.storageKey].newValue;
        if (this.validateSettings(newSettings)) {
          this.currentSettings = newSettings;
          callback(newSettings);
        }
      }
    });
  }

  /**
   * Remove storage listener
   */
  public removeStorageListener(): void {
    chrome.storage.onChanged.removeListener(() => {});
  }
}

// Export singleton instance
export const textSizeService = TextSizeService.getInstance();