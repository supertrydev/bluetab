import { useTranslation } from 'react-i18next';
import { BrainCircuit } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useSettingsUpdater, type SettingsSectionProps } from '../hooks/useSettingsUpdater';

export function GroupMemorySettings(props: SettingsSectionProps) {
    const { settings } = props;
    const { t } = useTranslation();
    const { updateSetting } = useSettingsUpdater(props);

    return (
        <div className="space-y-8">
            {/* Group Memory Settings */}
            <div>
                <h3 className="text-base font-semibold text-text-strong flex items-center gap-2 mb-4">
                    <BrainCircuit className="w-5 h-5" />
                    {t('settings.general.groupMemory.title')}
                </h3>

                <div className="space-y-4">
                    <div className="flex items-start gap-3 p-3 rounded-md border border-border bg-bg-1">
                        <Switch
                            id="memory-enabled"
                            checked={settings.groupMemoryEnabled ?? true}
                            onCheckedChange={(checked) => updateSetting('groupMemoryEnabled', checked)}
                        />
                        <Label htmlFor="memory-enabled" className="flex-1 cursor-pointer space-y-1">
                            <div className="text-sm font-medium text-text-strong">
                                {t('settings.general.groupMemory.enableLabel')}
                            </div>
                            <div className="text-xs text-text-muted">
                                {t('settings.general.groupMemory.enableDescription')}
                            </div>
                        </Label>
                    </div>

                    {(settings.groupMemoryEnabled ?? true) && (
                        <div className="flex items-start gap-3 p-3 rounded-md border border-border bg-bg-1 ms-4">
                            <Switch
                                id="memory-auto"
                                checked={settings.groupMemoryAutoRemember ?? true}
                                onCheckedChange={(checked) => updateSetting('groupMemoryAutoRemember', checked)}
                            />
                            <Label htmlFor="memory-auto" className="flex-1 cursor-pointer space-y-1">
                                <div className="text-sm font-medium text-text-strong">
                                    {t('settings.general.groupMemory.autoRememberLabel')}
                                </div>
                                <div className="text-xs text-text-muted">
                                    {t('settings.general.groupMemory.autoRememberDescription')}
                                </div>
                            </Label>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
