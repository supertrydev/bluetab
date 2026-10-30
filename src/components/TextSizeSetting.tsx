/**
 * Text Size Setting Component for BlueTab Extension
 */

import React, { useState, useEffect } from 'react';
import { TextSizeOption, TextSizeState } from '../types/text-size';
import { textSizeService } from '../utils/TextSizeService';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ALargeSmall } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface TextSizeSettingProps {
  className?: string;
  showLabels?: boolean;
}

export const TextSizeSetting: React.FC<TextSizeSettingProps> = ({
  className = '',
  showLabels = true,
}) => {
  const { t } = useTranslation();
  const [state, setState] = useState<TextSizeState>({
    currentSize: 'medium',
    isLoading: true,
    hasError: false,
  });

  useEffect(() => {
    loadCurrentSettings();

    // Listen for storage changes from local/import/sync restore.
    const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
      if (areaName === 'local' && changes.bluetab_text_size_settings) {
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
        errorMessage: t('textSize.loadFailed'),
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
        errorMessage: t('textSize.updateFailed'),
      }));
    }
  };

  const textSizeLabels: Record<TextSizeOption, string> = {
    small: t('textSize.options.small.label'),
    medium: t('textSize.options.medium.label'),
    large: t('textSize.options.large.label'),
  };

  const textSizeDescriptions: Record<TextSizeOption, string> = {
    small: t('textSize.options.small.description'),
    medium: t('textSize.options.medium.description'),
    large: t('textSize.options.large.description'),
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
            {t('textSize.title')}
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            {t('textSize.description')}
          </p>
        </div>
      )}

      {state.hasError && (
        <div className="mb-3 p-3 bg-destructive/10 border border-destructive/20 text-destructive rounded-lg text-sm">
          {state.errorMessage || t('textSize.error')}
        </div>
      )}

      <RadioGroup
        value={state.currentSize}
        onValueChange={(value) => handleSizeChange(value as TextSizeOption)}
        className="space-y-3"
      >
        {Object.entries(textSizeLabels).map(([size, label]) => {
          const sizeOption = size as TextSizeOption;

          return (
            <div
              key={size}
              className="flex items-start gap-3 p-3 border border-border rounded-lg hover:bg-accent transition-colors"
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
                  {textSizeDescriptions[sizeOption]}
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
