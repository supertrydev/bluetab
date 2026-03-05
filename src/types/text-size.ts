/**
 * Text Size Setting Types for BlueTab Extension
 */

// Valid text size options
export type TextSizeOption = 'small' | 'medium' | 'large';

// Text size settings stored in browser storage
export interface TextSizeSettings {
  textSize: TextSizeOption;
  lastUpdated: number;
  version: string; // For migration purposes
}

// React component state for text size management
export interface TextSizeState {
  currentSize: TextSizeOption;
  isLoading: boolean;
  hasError: boolean;
  errorMessage?: string;
}

// Text size service configuration
export interface TextSizeConfig {
  defaultSize: TextSizeOption;
  storageKey: string;
  cssPropertyName: string;
}

// Constants for text size values
export const TEXT_SIZE_VALUES: Record<TextSizeOption, string> = {
  small: '12px',
  medium: '14px',
  large: '16px',
} as const;

// Default configuration
export const DEFAULT_TEXT_SIZE_CONFIG: TextSizeConfig = {
  defaultSize: 'medium',
  storageKey: 'bluetab_text_size_settings',
  cssPropertyName: '--text-size-base',
} as const;

// Validation helpers
export const isValidTextSize = (size: string): size is TextSizeOption => {
  return ['small', 'medium', 'large'].includes(size);
};

// Default settings for new users
export const DEFAULT_TEXT_SIZE_SETTINGS: TextSizeSettings = {
  textSize: 'medium',
  lastUpdated: Date.now(),
  version: '1.0.0',
} as const;