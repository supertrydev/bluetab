import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CirclePlus } from 'lucide-react';
import { ToastManager } from '@/components/Toast';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { isolateBidi } from '@/i18n/bidi';
import {
    FLOATING_BUTTON_HOST_ORIGINS,
    hasFloatingButtonHostAccess,
    requestFloatingButtonHostAccess,
} from '@/services/floating-button-content-script';
import type { Settings } from '@/types/models';
import { useSettingsUpdater, type SettingsSectionProps } from '../hooks/useSettingsUpdater';

export function FloatingButtonSettings(props: SettingsSectionProps) {
    const { settings } = props;
    const { t } = useTranslation();
    const { saveSettings } = useSettingsUpdater(props);
    const [floatingButtonSiteAccess, setFloatingButtonSiteAccess] = useState(false);
    const [floatingButtonAccessLoading, setFloatingButtonAccessLoading] = useState(false);

    const refreshFloatingButtonSiteAccess = useCallback(async () => {
        const hasAccess = await hasFloatingButtonHostAccess();
        setFloatingButtonSiteAccess(hasAccess);
    }, []);

    useEffect(() => {
        void refreshFloatingButtonSiteAccess();
    }, [refreshFloatingButtonSiteAccess]);

    const syncFloatingButtonRegistration = useCallback(async (nextSettings: Settings) => {
        await chrome.runtime
            .sendMessage({ type: 'FLOATING_BUTTON_SYNC_CONTENT_SCRIPT', settings: nextSettings })
            .catch(() => {});
    }, []);

    const notifyFloatingButtonTabs = useCallback((nextSettings: Settings) => {
        chrome.tabs.query({}, (tabs) => {
            tabs.forEach(tab => {
                if (tab.id) {
                    chrome.tabs.sendMessage(tab.id, {
                        type: 'FLOATING_BUTTON_SETTINGS_CHANGED',
                        settings: nextSettings
                    }).catch(() => {});
                }
            });
        });
    }, []);

    const updateSettingWithNotify = async <K extends keyof Settings>(key: K, value: Settings[K]) => {
        const updatedSettings = { ...settings, [key]: value };
        if (!await saveSettings(updatedSettings)) return;
        await syncFloatingButtonRegistration(updatedSettings);
        notifyFloatingButtonTabs(updatedSettings);
    };

    const handleEnableFloatingButtonSiteAccess = async () => {
        setFloatingButtonAccessLoading(true);
        try {
            const granted = await requestFloatingButtonHostAccess();
            setFloatingButtonSiteAccess(granted);
            if (!granted) {
                ToastManager.getInstance().error({ key: 'feedback.siteAccessNotGranted' });
                return;
            }
            await syncFloatingButtonRegistration(settings);
            notifyFloatingButtonTabs(settings);
            ToastManager.getInstance().success({ key: 'feedback.floatingButtonAccessEnabled' });
        } catch (error) {
            ToastManager.getInstance().error({
                key: 'feedback.siteAccessRequestFailed',
                values: { message: isolateBidi((error as Error).message) },
            });
        } finally {
            setFloatingButtonAccessLoading(false);
        }
    };

    return (
        <div className="space-y-8">
            {/* Floating Button Settings */}
            <div>
                <h3 className="text-base font-semibold text-text-strong flex items-center gap-2 mb-4">
                    <CirclePlus className="w-5 h-5" />
                    {t('settings.general.floatingButton.title')}
                </h3>

                <div className="space-y-4">
                    <div className="flex items-start gap-3 p-3 rounded-md border border-border bg-bg-1">
                        <Switch
                            id="floating-enabled"
                            checked={settings.floatingButtonEnabled ?? true}
                            onCheckedChange={(checked) => updateSettingWithNotify('floatingButtonEnabled', checked)}
                        />
                        <Label htmlFor="floating-enabled" className="flex-1 cursor-pointer space-y-1">
                            <div className="text-sm font-medium text-text-strong">
                                {t('settings.general.floatingButton.showLabel')}
                            </div>
                            <div className="text-xs text-text-muted">
                                {t('settings.general.floatingButton.showDescription')}
                            </div>
                        </Label>
                    </div>

                    {(settings.floatingButtonEnabled ?? true) && (
                        <>
                            {!floatingButtonSiteAccess && (
                                <div className="ms-4 rounded-lg border border-warning/30 bg-warning-muted p-3">
                                    <div className="flex items-start gap-3">
                                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                                        <div className="min-w-0 flex-1 space-y-2">
                                            <div className="text-sm font-medium text-text-strong">
                                                {t('settings.general.floatingButton.siteAccessRequired')}
                                            </div>
                                            <div className="text-xs text-text-muted">
                                                {t('settings.general.floatingButton.siteAccessDescription', {
                                                    origins: FLOATING_BUTTON_HOST_ORIGINS
                                                        .map((origin) => isolateBidi(origin, 'ltr'))
                                                        .join(` ${t('settings.general.joinerAnd')} `),
                                                })}
                                            </div>
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="outline"
                                                onClick={handleEnableFloatingButtonSiteAccess}
                                                disabled={floatingButtonAccessLoading}
                                            >
                                                {floatingButtonAccessLoading
                                                    ? t('settings.general.floatingButton.requesting')
                                                    : t('settings.general.floatingButton.enableSiteAccess')}
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div className="p-3 rounded-md bg-muted ms-4">
                                <label className="text-sm font-medium text-text-strong mb-3 block">
                                    {t('settings.general.floatingButton.positionLabel')}
                                </label>
                                <RadioGroup
                                    value={settings.floatingButtonPosition ?? 'bottom-right'}
                                    onValueChange={(value) => updateSettingWithNotify('floatingButtonPosition', value as any)}
                                    className="grid grid-cols-2 gap-2"
                                >
                                    <div className="flex items-center gap-2 p-2 border border-border rounded">
                                        <RadioGroupItem value="top-left" id="pos-tl" />
                                        <Label htmlFor="pos-tl" className="text-sm cursor-pointer">{t('settings.general.floatingButton.positions.topLeft')}</Label>
                                    </div>
                                    <div className="flex items-center gap-2 p-2 border border-border rounded">
                                        <RadioGroupItem value="top-right" id="pos-tr" />
                                        <Label htmlFor="pos-tr" className="text-sm cursor-pointer">{t('settings.general.floatingButton.positions.topRight')}</Label>
                                    </div>
                                    <div className="flex items-center gap-2 p-2 border border-border rounded">
                                        <RadioGroupItem value="bottom-left" id="pos-bl" />
                                        <Label htmlFor="pos-bl" className="text-sm cursor-pointer">{t('settings.general.floatingButton.positions.bottomLeft')}</Label>
                                    </div>
                                    <div className="flex items-center gap-2 p-2 border border-border rounded">
                                        <RadioGroupItem value="bottom-right" id="pos-br" />
                                        <Label htmlFor="pos-br" className="text-sm cursor-pointer">{t('settings.general.floatingButton.positions.bottomRight')}</Label>
                                    </div>
                                </RadioGroup>
                            </div>

                            <div className="flex items-start gap-3 p-3 rounded-md border border-border bg-bg-1 ms-4">
                                <Switch
                                    id="floating-confirm"
                                    checked={settings.floatingButtonConfirmSaveAll ?? true}
                                    onCheckedChange={(checked) => updateSettingWithNotify('floatingButtonConfirmSaveAll', checked)}
                                />
                                <Label htmlFor="floating-confirm" className="flex-1 cursor-pointer space-y-1">
                                    <div className="text-sm font-medium text-text-strong">
                                        {t('settings.general.floatingButton.confirmSaveAllLabel')}
                                    </div>
                                    <div className="text-xs text-text-muted">
                                        {t('settings.general.floatingButton.confirmSaveAllDescription')}
                                    </div>
                                </Label>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
