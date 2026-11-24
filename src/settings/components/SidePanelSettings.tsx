import { useTranslation } from 'react-i18next';
import { PanelRight } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useSettingsUpdater, type SettingsSectionProps } from '../hooks/useSettingsUpdater';

export function SidePanelSettings(props: SettingsSectionProps) {
    const { settings } = props;
    const { t } = useTranslation();
    const { updateSetting } = useSettingsUpdater(props);

    return (
        <div className="space-y-8">
            {/* Browser Tabs Settings */}
            <div>
                <h3 className="text-base font-semibold text-text-strong flex items-center gap-2 mb-4">
                    <PanelRight className="w-5 h-5" />
                    {t('settingsTabs.sidePanel')}
                </h3>

                <div className="space-y-4">
                    <div className="flex items-start gap-3 p-3 rounded-md border border-border bg-bg-1">
                        <Switch
                            id="browser-group-border"
                            checked={settings.browserTabsGroupBorder ?? true}
                            onCheckedChange={(checked) => updateSetting('browserTabsGroupBorder', checked)}
                        />
                        <Label htmlFor="browser-group-border" className="flex-1 cursor-pointer space-y-1">
                            <div className="text-sm font-medium text-text-strong">
                                {t('settings.general.browserTabs.groupBorderLabel')}
                            </div>
                            <div className="text-xs text-text-muted">
                                {t('settings.general.browserTabs.groupBorderDescription')}
                            </div>
                        </Label>
                    </div>

                    <div className="flex items-start gap-3 p-3 rounded-md border border-border bg-bg-1">
                        <Switch
                            id="browser-close-on-save"
                            checked={settings.browserTabsCloseOnSave ?? true}
                            onCheckedChange={(checked) => updateSetting('browserTabsCloseOnSave', checked)}
                        />
                        <Label htmlFor="browser-close-on-save" className="flex-1 cursor-pointer space-y-1">
                            <div className="text-sm font-medium text-text-strong">
                                {t('settings.general.browserTabs.closeOnSaveLabel')}
                            </div>
                            <div className="text-xs text-text-muted">
                                {t('settings.general.browserTabs.closeOnSaveDescription')}
                            </div>
                        </Label>
                    </div>

                    <div className="flex items-start gap-3 p-3 rounded-md border border-border bg-bg-1">
                        <Switch
                            id="browser-inactive-indicator"
                            checked={settings.browserTabsShowInactiveIndicator ?? true}
                            onCheckedChange={(checked) => updateSetting('browserTabsShowInactiveIndicator', checked)}
                        />
                        <Label htmlFor="browser-inactive-indicator" className="flex-1 cursor-pointer space-y-1">
                            <div className="text-sm font-medium text-text-strong">
                                {t('settings.general.browserTabs.inactiveIndicatorLabel')}
                            </div>
                            <div className="text-xs text-text-muted">
                                {t('settings.general.browserTabs.inactiveIndicatorDescription')}
                            </div>
                        </Label>
                    </div>
                </div>
            </div>
        </div>
    );
}
