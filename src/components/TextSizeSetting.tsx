/**
 * Text Size Setting Component for BlueTab Extension
 */

import React, { useState, useEffect } from 'react';
import { TextSizeOption, TextSizeState } from '../types/text-size';
import { textSizeService } from '../utils/TextSizeService';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ALargeSmall } from 'lucide-react';

interface TextSizeSettingProps {
  className?: string;
  showLabels?: boolean;
}

const TEXT_SIZE_LABELS: Record<TextSizeOption, string> = {
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
};

const TEXT_SIZE_DESCRIPTIONS: Record<TextSizeOption, string> = {
  small: 'Compact text for more content',
  medium: 'Standard text size (recommended)',
  large: 'Larger text for better readability',
};

export const TextSizeSetting: React.FC<TextSizeSettingProps> = ({
  className = '',
  showLabels = true,
}) => {
  const [state, setState] = useState<TextSizeState>({
    currentSize: 'medium',
    isLoading: true,
    hasError: false,
  });

  useEffect(() => {
    loadCurrentSettings();

    // Listen for storage changes (e.g., from import)
    const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
      if (areaName === 'sync' && changes.bluetab_text_size_settings) {
        const newSettings = changes.bluetab_text_size_settings.newValue;
        if (newSettings?.textSize) {
          setState(prev => ({
            ...prev,
            currentSize: newSettings.textSize,
          }));
        }
      }
    };

    chrome.storage.onChanged.addListener(handleStorageChange);

    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, []);

  const loadCurrentSettings = async () => {
    try {
      setState(prev => ({ ...prev, isLoading: true, hasError: false }));

      const settings = await textSizeService.loadSettings();
      setState(prev => ({
        ...prev,
        currentSize: settings.textSize,
        isLoading: false,
      }));
    } catch (error) {
      console.error('Failed to load text size settings:', error);
      setState(prev => ({
        ...prev,
        hasError: true,
        isLoading: false,
        errorMessage: 'Failed to load settings',
      }));
    }
  };

  const handleSizeChange = async (size: TextSizeOption) => {
    try {
      setState(prev => ({ ...prev, hasError: false }));

      await textSizeService.updateTextSize(size);
      setState(prev => ({ ...prev, currentSize: size }));
    } catch (error) {
      console.error('Failed to update text size:', error);
      setState(prev => ({
        ...prev,
        hasError: true,
        errorMessage: 'Failed to update text size',
      }));
    }
  };

  if (state.isLoading) {
    return (
      <div className={`${className}`}>
        <div className="animate-pulse">
          <div className="h-4 bg-gray-300 dark:bg-gray-700 rounded w-24 mb-2"></div>
          <div className="space-y-2">
            <div className="h-12 bg-gray-200 dark:bg-gray-800 rounded"></div>
            <div className="h-12 bg-gray-200 dark:bg-gray-800 rounded"></div>
            <div className="h-12 bg-gray-200 dark:bg-gray-800 rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      {showLabels && (
        <div className="mb-4">
          <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <ALargeSmall className="w-5 h-5" />
            Text Size
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            Choose your preferred text size for the extension interface
          </p>
        </div>
      )}

      {state.hasError && (
        <div className="mb-3 p-3 bg-destructive/10 border border-destructive/20 text-destructive rounded-lg text-sm">
          {state.errorMessage || 'An error occurred'}
        </div>
      )}

      <RadioGroup
        value={state.currentSize}
        onValueChange={(value) => handleSizeChange(value as TextSizeOption)}
        className="space-y-3"
      >
        {Object.entries(TEXT_SIZE_LABELS).map(([size, label]) => {
          const sizeOption = size as TextSizeOption;

          return (
            <div
              key={size}
              className="flex items-start space-x-3 p-3 border border-border rounded-lg hover:bg-accent transition-colors"
            >
              <RadioGroupItem
                value={size}
                id={`text-size-${size}`}
                className="mt-1"
              />
              <Label
                htmlFor={`text-size-${size}`}
                className="flex-1 cursor-pointer space-y-1"
              >
                <div className="font-medium text-gray-900 dark:text-gray-100">
                  {label}
                </div>
                <div
                  id={`text-size-${size}-description`}
                  className="text-sm text-gray-600 dark:text-gray-400"
                >
                  {TEXT_SIZE_DESCRIPTIONS[sizeOption]}
                </div>
              </Label>
            </div>
          );
        })}
      </RadioGroup>
    </div>
  );
};

export default TextSizeSetting;
