import { useCallback, useEffect, useState } from 'react';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { ToastManager } from '@/components/Toast';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { applyLanguagePreference, getLocaleTag, setTimeFormatPreference, type LanguagePreference } from '@/i18n';
import { formatTime } from '@/i18n/format';

/** 13:30 sample used to preview each time format option. */
const TIME_FORMAT_SAMPLE = new Date(2000, 0, 1, 13, 30);
import { isolateBidi } from '@/i18n/bidi';
import { Storage } from '@/utils/storage';
import {
    FLOATING_BUTTON_HOST_ORIGINS,
    hasFloatingButtonHostAccess,
    requestFloatingButtonHostAccess,
} from '@/services/floating-button-content-script';
import type { Settings } from '@/types/models';
import { AUTO_ARCHIVE_DAY_OPTIONS, resolveAutoArchiveDays } from '@/config/auto-archive';
import {
    AppWindow,
    Layers,
    Pin,
    Rocket,
    Globe,
    MousePointer,
    AlertTriangle,
    Undo2,
    Save,
    Link,
    StickyNote,
    Brain,
    CirclePlus,
    Copy,
    Archive,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface GeneralSettingsProps {
    settings: Settings;
    onSettingsChange: (updated: Settings) => void;
}

export function GeneralSettings({ settings, onSettingsChange }: GeneralSettingsProps) {
    const { t } = useTranslation();
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

    const updateSetting = async <K extends keyof Settings>(key: K, value: Settings[K], successMsg?: string) => {
        try {
            const updatedSettings = { ...settings, [key]: value };
            await Storage.set('settings', updatedSettings);
            onSettingsChange(updatedSettings);
            if (successMsg) {
                ToastManager.getInstance().success(successMsg);
            }
        } catch (error) {
            ToastManager.getInstance().error({
                key: 'feedback.settingSaveFailed',
                values: { message: isolateBidi((error as Error).message) },
            });
        }
    };

    const updateAutoArchive = async (
        change: Pick<Settings, 'autoArchiveInactiveGroups'> | Pick<Settings, 'autoArchiveInactiveDays'>,
    ) => {
        try {
            const next: Settings = { ...settings, ...change };
            const enabled = next.autoArchiveInactiveGroups === true;
            // Turning it on or changing the days restarts the countdown, so a
            // shorter window never archives a batch of groups at once.
            const restartCountdown = enabled && (
                settings.autoArchiveInactiveGroups !== true
                || resolveAutoArchiveDays(next.autoArchiveInactiveDays) !== resolveAutoArchiveDays(settings.autoArchiveInactiveDays)
            );
            const updatedSettings: Settings = {
                ...next,
                autoArchiveEnabledAt: restartCountdown ? Date.now() : settings.autoArchiveEnabledAt,
            };
            await Storage.set('settings', updatedSettings);
            onSettingsChange(updatedSettings);
        } catch (error) {
            ToastManager.getInstance().error({
                key: 'feedback.settingSaveFailed',
                values: { message: isolateBidi((error as Error).message) },
            });
        }
    };

    const updateSettingWithNotify = async <K extends keyof Settings>(key: K, value: Settings[K]) => {
        try {
            const updatedSettings = { ...settings, [key]: value };
            await Storage.set('settings', updatedSettings);
            onSettingsChange(updatedSettings);
            await syncFloatingButtonRegistration(updatedSettings);
            notifyFloatingButtonTabs(updatedSettings);
        } catch (error) {
            ToastManager.getInstance().error({
                key: 'feedback.settingSaveFailed',
                values: { message: isolateBidi((error as Error).message) },
            });
        }
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

    const handleLanguageChange = async (value: LanguagePreference) => {
        const updatedSettings = { ...settings, language: value };
        try {
            await Storage.set('settings', updatedSettings);
            onSettingsChange(updatedSettings);
            await applyLanguagePreference(value);
            ToastManager.getInstance().success({ key: 'language.updated' });
        } catch (error) {
            ToastManager.getInstance().error({
                key: 'feedback.settingSaveFailed',
                values: { message: isolateBidi((error as Error).message) },
            });
        }
    };

    return (
        <div className="space-y-8">
            <div>
                <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2 mb-4">
                    <Globe className="w-5 h-5" />
                    {t('language.title')}
                </h3>

                <div className="rounded-lg border border-border p-4 space-y-3">
                    <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                            {t('settings.general.languageTitle')}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                            {t('settings.general.languageDescription')}
                        </p>
                    </div>

                    <Select
                        value={settings.language || 'system'}
                        onValueChange={(value) => handleLanguageChange(value as LanguagePreference)}
                    >
                        <SelectTrigger className="w-full sm:w-64">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="system">{t('common.browserDefault')}</SelectItem>
                            <SelectItem value="en">{t('common.english')}</SelectItem>
                            <SelectItem value="tr">{t('common.turkish')}</SelectItem>
                            <SelectItem value="es">{t('common.spanish')}</SelectItem>
                            <SelectItem value="pt-BR">{t('common.brazilianPortuguese')}</SelectItem>
                            <SelectItem value="id">{t('common.indonesian')}</SelectItem>
                            <SelectItem value="ar">{t('common.arabic')}</SelectItem>
                        </SelectContent>
                    </Select>

                    <div className="pt-2">
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                            {t('settings.general.timeFormat.title')}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                            {t('settings.general.timeFormat.description')}
                        </p>
                    </div>

                    <Select
                        value={settings.timeFormat ?? 'system'}
                        onValueChange={(value) => {
                            // Applied right away in this page; other pages follow via the storage listener.
                            setTimeFormatPreference(value);
                            void updateSetting('timeFormat', value as Settings['timeFormat']);
                        }}
                    >
                        <SelectTrigger className="w-full sm:w-64" aria-label={t('settings.general.timeFormat.title')}>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="system">
                                {t('settings.general.timeFormat.system', { example: new Intl.DateTimeFormat(getLocaleTag(), { hour: 'numeric', minute: '2-digit' }).format(TIME_FORMAT_SAMPLE) })}
                            </SelectItem>
                            <SelectItem value="12h">
                                {t('settings.general.timeFormat.twelve', { example: formatTime(TIME_FORMAT_SAMPLE, { hour: 'numeric', minute: '2-digit', hour12: true }) })}
                            </SelectItem>
                            <SelectItem value="24h">
                                {t('settings.general.timeFormat.twentyFour', { example: formatTime(TIME_FORMAT_SAMPLE, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) })}
                            </SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>

            {/* Tab Restore Settings */}
            <div>
                <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2 mb-4">
                    <AppWindow className="w-5 h-5" />
                    {t('settings.general.tabRestoration.title')}
                </h3>

                <div className="space-y-4">
                    <div>
                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3 block">
                            {t('settings.general.tabRestoration.description')}
                        </label>
                        <RadioGroup
                            value={settings.restoreMode}
                            onValueChange={(value) => updateSetting('restoreMode', value as 'smart' | 'newWindow' | 'currentWindow')}
                            className="space-y-3"
                        >
                            <div className="flex items-start gap-3 p-3 border border-border rounded-lg">
                                <RadioGroupItem value="smart" id="restore-smart" className="mt-1" />
                                <Label htmlFor="restore-smart" className="flex-1 cursor-pointer space-y-1">
                                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                        {t('settings.general.tabRestoration.options.smart.title')}
                                    </div>
                                    <div className="text-xs text-gray-500 dark:text-gray-400">
                                        {t('settings.general.tabRestoration.options.smart.description')}
                                    </div>
                                </Label>
                            </div>
                            <div className="flex items-start gap-3 p-3 border border-border rounded-lg">
                                <RadioGroupItem value="newWindow" id="restore-new" className="mt-1" />
                                <Label htmlFor="restore-new" className="flex-1 cursor-pointer space-y-1">
                                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                        {t('settings.general.tabRestoration.options.newWindow.title')}
                                    </div>
                                    <div className="text-xs text-gray-500 dark:text-gray-400">
                                        {t('settings.general.tabRestoration.options.newWindow.description')}
                                    </div>
                                </Label>
                            </div>
                            <div className="flex items-start gap-3 p-3 border border-border rounded-lg">
                                <RadioGroupItem value="currentWindow" id="restore-current" className="mt-1" />
                                <Label htmlFor="restore-current" className="flex-1 cursor-pointer space-y-1">
                                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                        {t('settings.general.tabRestoration.options.currentWindow.title')}
                                    </div>
                                    <div className="text-xs text-gray-500 dark:text-gray-400">
                                        {t('settings.general.tabRestoration.options.currentWindow.description')}
                                    </div>
                                </Label>
                            </div>
                        </RadioGroup>
                    </div>
                </div>
            </div>

            {/* Tab Group Restore Mode */}
            <div>
                <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2 mb-4">
                    <Layers className="w-5 h-5" />
                    {t('settings.general.tabGroupRestoreMode.title')}
                </h3>

                <div className="space-y-4">
                    <div>
                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3 block">
                            {t('settings.general.tabGroupRestoreMode.description')}
                        </label>
                        <RadioGroup
                            value={settings.tabGroupRestoreMode || 'normal'}
                            onValueChange={(value) => updateSetting(
                                'tabGroupRestoreMode',
                                value as 'normal' | 'browserGroups',
                                t('settings.general.tabGroupRestoreMode.updated'),
                            )}
                            className="space-y-3"
                        >
                            <div className="flex items-start gap-3 p-3 border border-border rounded-lg">
                                <RadioGroupItem value="normal" id="tab-group-normal" className="mt-1" />
                                <Label htmlFor="tab-group-normal" className="flex-1 cursor-pointer space-y-1">
                                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                        {t('settings.general.tabGroupRestoreMode.options.normal.title')}
                                    </div>
                                    <div className="text-xs text-gray-500 dark:text-gray-400">
                                        {t('settings.general.tabGroupRestoreMode.options.normal.description')}
                                    </div>
                                </Label>
                            </div>
                            <div className="flex items-start gap-3 p-3 border border-border rounded-lg">
                                <RadioGroupItem value="browserGroups" id="tab-group-browser" className="mt-1" />
                                <Label htmlFor="tab-group-browser" className="flex-1 cursor-pointer space-y-1">
                                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                        {t('settings.general.tabGroupRestoreMode.options.browserGroups.title')}
                                    </div>
                                    <div className="text-xs text-gray-500 dark:text-gray-400">
                                        {t('settings.general.tabGroupRestoreMode.options.browserGroups.description')}
                                    </div>
                                </Label>
                            </div>
                        </RadioGroup>
                    </div>
                </div>
            </div>

            {/* Pinned Tabs Settings */}
            <div>
                <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2 mb-4">
                    <Pin className="w-5 h-5" />
                    {t('settings.general.pinnedTabs.title')}
                </h3>

                <div className="space-y-4">
                    <div>
                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3 block">
                            {t('settings.general.pinnedTabs.description')}
                        </label>
                        <RadioGroup
                            value={settings.pinnedTabsMode}
                            onValueChange={(value) => updateSetting('pinnedTabsMode', value as 'exclude' | 'include')}
                            className="space-y-3"
                        >
                            <div className="flex items-start gap-3 p-3 border border-border rounded-lg">
                                <RadioGroupItem value="exclude" id="pinned-exclude" className="mt-1" />
                                <Label htmlFor="pinned-exclude" className="flex-1 cursor-pointer space-y-1">
                                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                        {t('settings.general.pinnedTabs.options.exclude.title')}
                                    </div>
                                    <div className="text-xs text-gray-500 dark:text-gray-400">
                                        {t('settings.general.pinnedTabs.options.exclude.description')}
                                    </div>
                                </Label>
                            </div>
                            <div className="flex items-start gap-3 p-3 border border-border rounded-lg">
                                <RadioGroupItem value="include" id="pinned-include" className="mt-1" />
                                <Label htmlFor="pinned-include" className="flex-1 cursor-pointer space-y-1">
                                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                        {t('settings.general.pinnedTabs.options.include.title')}
                                    </div>
                                    <div className="text-xs text-gray-500 dark:text-gray-400">
                                        {t('settings.general.pinnedTabs.options.include.description')}
                                    </div>
                                </Label>
                            </div>
                        </RadioGroup>
                    </div>
                </div>
            </div>

            {/* Startup Behavior Settings */}
            <div>
                <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2 mb-4">
                    <Rocket className="w-5 h-5" />
                    {t('settings.general.startupBehavior.title')}
                </h3>

                <div className="space-y-4">
                    <div>
                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3 block">
                            {t('settings.general.startupBehavior.description')}
                        </label>
                        <RadioGroup
                            value={settings.startupBehavior}
                            onValueChange={(value) => updateSetting('startupBehavior', value as 'show' | 'manual')}
                            className="space-y-3"
                        >
                            <div className="flex items-start gap-3 p-3 border border-border rounded-lg">
                                <RadioGroupItem value="show" id="startup-show" className="mt-1" />
                                <Label htmlFor="startup-show" className="flex-1 cursor-pointer space-y-1">
                                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                        {t('settings.general.startupBehavior.options.show.title')}
                                    </div>
                                </Label>
                            </div>
                            <div className="flex items-start gap-3 p-3 border border-border rounded-lg">
                                <RadioGroupItem value="manual" id="startup-manual" className="mt-1" />
                                <Label htmlFor="startup-manual" className="flex-1 cursor-pointer space-y-1">
                                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                        {t('settings.general.startupBehavior.options.manual.title')}
                                    </div>
                                    <div className="text-xs text-gray-500 dark:text-gray-400">
                                        {t('settings.general.startupBehavior.options.manual.description')}
                                    </div>
                                </Label>
                            </div>
                        </RadioGroup>
                    </div>
                </div>
            </div>

            {/* Custom New Tab Page Settings */}
            <div>
                <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2 mb-4">
                    <Globe className="w-5 h-5" />
                    {t('settings.general.customNewTab.title')}
                </h3>

                <div className="space-y-4">
                    <div className="flex items-center justify-between p-4 border border-border rounded-lg">
                        <div className="flex-1">
                            <label className="text-sm font-medium text-gray-900 dark:text-gray-100 block">
                                {t('settings.general.customNewTab.enableLabel')}
                            </label>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                {t('settings.general.customNewTab.enableDescription')}
                            </p>
                        </div>
                        <Switch
                            checked={settings.customNewTabEnabled || false}
                            onCheckedChange={(checked) => updateSetting(
                                'customNewTabEnabled',
                                checked,
                                checked
                                    ? t('settings.general.customNewTab.enabled')
                                    : t('settings.general.customNewTab.disabled'),
                            )}
                        />
                    </div>
                </div>
            </div>

            {/* Context Menu Settings */}
            <div>
                <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2 mb-4">
                    <MousePointer className="w-5 h-5" />
                    {t('settings.general.contextMenu.title')}
                </h3>

                <div className="space-y-4">
                    <div className="p-4 border border-border rounded-lg">
                        <div className="flex items-center justify-between mb-3">
                            <div className="flex-1">
                                <label className="text-sm font-medium text-gray-900 dark:text-gray-100 block">
                                    {t('settings.general.contextMenu.groupLimitLabel')}
                                </label>
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                    {t('settings.general.contextMenu.groupLimitDescription')}
                                </p>
                            </div>
                            <div className="flex items-center gap-3">
                                <span dir="ltr" className="text-lg font-semibold text-primary min-w-[40px] text-end">
                                    {settings.contextMenuGroupLimit || 25}
                                </span>
                            </div>
                        </div>
                        <div className="space-y-3">
                            <input
                                type="range"
                                dir="ltr"
                                min="5"
                                max="50"
                                step="5"
                                value={settings.contextMenuGroupLimit || 25}
                                onChange={(e) => {
                                    const count = parseInt(e.target.value, 10);
                                    void updateSetting(
                                        'contextMenuGroupLimit',
                                        count,
                                        t('settings.general.contextMenu.groupLimitUpdated', { count }),
                                    );
                                }}
                                className="settings-range w-full"
                            />
                            <div dir="ltr" className="flex justify-between text-xs text-gray-400">
                                <span>5</span>
                                <span>25</span>
                                <span>50</span>
                            </div>
                        </div>
                        {(settings.contextMenuGroupLimit || 25) > 30 && (
                            <div className="mt-3 p-3 bg-warning-muted border-warning/30 rounded-lg flex items-start gap-2">
                                <AlertTriangle className="w-4 h-4 text-warning flex-shrink-0 mt-0.5" />
                                <p className="text-xs text-warning">
                                    {t('settings.general.contextMenu.performanceWarning')}
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Tab Restore Behavior Settings */}
            <div>
                <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2 mb-4">
                    <Undo2 className="w-5 h-5" />
                    {t('settings.general.restoreBehavior.title')}
                </h3>

                <div className="space-y-4">
                    <div>
                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3 block">
                            {t('settings.general.restoreBehavior.description')}
                        </label>
                        <RadioGroup
                            value={settings.restoreBehavior}
                            onValueChange={(value) => updateSetting('restoreBehavior', value as 'removeFromList' | 'keepInList')}
                            className="space-y-3"
                        >
                            <div className="flex items-start gap-3 p-3 border border-border rounded-lg">
                                <RadioGroupItem value="removeFromList" id="behavior-remove" className="mt-1" />
                                <Label htmlFor="behavior-remove" className="flex-1 cursor-pointer space-y-1">
                                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                        {t('settings.general.restoreBehavior.options.removeFromList.title')}
                                    </div>
                                    <div className="text-xs text-gray-500 dark:text-gray-400">
                                        {t('settings.general.restoreBehavior.options.removeFromList.description')}
                                    </div>
                                </Label>
                            </div>
                            <div className="flex items-start gap-3 p-3 border border-border rounded-lg">
                                <RadioGroupItem value="keepInList" id="behavior-keep" className="mt-1" />
                                <Label htmlFor="behavior-keep" className="flex-1 cursor-pointer space-y-1">
                                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                        {t('settings.general.restoreBehavior.options.keepInList.title')}
                                    </div>
                                    <div className="text-xs text-gray-500 dark:text-gray-400">
                                        {t('settings.general.restoreBehavior.options.keepInList.description')}
                                    </div>
                                </Label>
                            </div>
                        </RadioGroup>
                    </div>
                </div>
            </div>

            {/* Save Behavior Settings */}
            <div>
                <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2 mb-4">
                    <Save className="w-5 h-5" />
                    {t('settings.general.saveBehavior.title')}
                </h3>

                <div className="space-y-4">
                    <div className="flex items-start gap-3 p-3 border border-border rounded-lg">
                        <Switch
                            id="open-manager-after-save"
                            checked={settings.openManagerAfterSave ?? true}
                            onCheckedChange={(checked) => updateSetting('openManagerAfterSave', checked)}
                        />
                        <Label htmlFor="open-manager-after-save" className="flex-1 cursor-pointer space-y-1">
                            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                {t('settings.general.saveBehavior.openAfterSaveLabel')}
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                                {t('settings.general.saveBehavior.openAfterSaveDescription')}
                            </div>
                        </Label>
                    </div>
                </div>
            </div>

            {/* Tab URL Display */}
            <div>
                <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2 mb-4">
                    <Link className="w-5 h-5" />
                    {t('settings.general.tabUrlDisplay.title')}
                </h3>

                <div className="space-y-4">
                    <div>
                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3 block">
                            {t('settings.general.tabUrlDisplay.description')}
                        </label>
                        <RadioGroup
                            value={settings.tabUrlDisplay ?? 'full'}
                            onValueChange={(value) => updateSetting('tabUrlDisplay', value as 'full' | 'hostname')}
                            className="space-y-3"
                        >
                            <div className="flex items-start gap-3 p-3 border border-border rounded-lg">
                                <RadioGroupItem value="hostname" id="tab-url-hostname" className="mt-1" />
                                <Label htmlFor="tab-url-hostname" className="flex-1 cursor-pointer space-y-1">
                                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                        {t('settings.general.tabUrlDisplay.options.hostname.title')}
                                    </div>
                                    <div className="text-xs text-gray-500 dark:text-gray-400">
                                        {t('settings.general.tabUrlDisplay.options.hostname.description')}
                                    </div>
                                </Label>
                            </div>
                            <div className="flex items-start gap-3 p-3 border border-border rounded-lg">
                                <RadioGroupItem value="full" id="tab-url-full" className="mt-1" />
                                <Label htmlFor="tab-url-full" className="flex-1 cursor-pointer space-y-1">
                                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                        {t('settings.general.tabUrlDisplay.options.full.title')}
                                    </div>
                                    <div className="text-xs text-gray-500 dark:text-gray-400">
                                        {t('settings.general.tabUrlDisplay.options.full.description')}
                                    </div>
                                </Label>
                            </div>
                        </RadioGroup>
                    </div>
                </div>
            </div>

            {/* Group Notes Display */}
            <div>
                <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2 mb-4">
                    <StickyNote className="w-5 h-5" />
                    {t('settings.general.groupNotesDisplay.title')}
                </h3>

                <div className="space-y-4">
                    <div>
                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3 block">
                            {t('settings.general.groupNotesDisplay.description')}
                        </label>
                        <RadioGroup
                            value={settings.groupNotesDisplay ?? 'preview'}
                            onValueChange={(value) => updateSetting('groupNotesDisplay', value as 'full' | 'preview')}
                            className="space-y-3"
                        >
                            <div className="flex items-start gap-3 p-3 border border-border rounded-lg">
                                <RadioGroupItem value="preview" id="notes-preview" className="mt-1" />
                                <Label htmlFor="notes-preview" className="flex-1 cursor-pointer space-y-1">
                                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                        {t('settings.general.groupNotesDisplay.options.preview.title')}
                                    </div>
                                    <div className="text-xs text-gray-500 dark:text-gray-400">
                                        {t('settings.general.groupNotesDisplay.options.preview.description')}
                                    </div>
                                </Label>
                            </div>
                            <div className="flex items-start gap-3 p-3 border border-border rounded-lg">
                                <RadioGroupItem value="full" id="notes-full" className="mt-1" />
                                <Label htmlFor="notes-full" className="flex-1 cursor-pointer space-y-1">
                                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                        {t('settings.general.groupNotesDisplay.options.full.title')}
                                    </div>
                                    <div className="text-xs text-gray-500 dark:text-gray-400">
                                        {t('settings.general.groupNotesDisplay.options.full.description')}
                                    </div>
                                </Label>
                            </div>
                        </RadioGroup>
                    </div>
                </div>
            </div>

            {/* Browser Tabs Settings */}
            <div>
                <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2 mb-4">
                    <AppWindow className="w-5 h-5" />
                    {t('settings.general.browserTabs.title')}
                </h3>

                <div className="space-y-4">
                    <div className="flex items-start gap-3 p-3 border border-border rounded-lg">
                        <Switch
                            id="browser-group-border"
                            checked={settings.browserTabsGroupBorder ?? true}
                            onCheckedChange={(checked) => updateSetting('browserTabsGroupBorder', checked)}
                        />
                        <Label htmlFor="browser-group-border" className="flex-1 cursor-pointer space-y-1">
                            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                {t('settings.general.browserTabs.groupBorderLabel')}
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                                {t('settings.general.browserTabs.groupBorderDescription')}
                            </div>
                        </Label>
                    </div>

                    <div className="flex items-start gap-3 p-3 border border-border rounded-lg">
                        <Switch
                            id="browser-close-on-save"
                            checked={settings.browserTabsCloseOnSave ?? true}
                            onCheckedChange={(checked) => updateSetting('browserTabsCloseOnSave', checked)}
                        />
                        <Label htmlFor="browser-close-on-save" className="flex-1 cursor-pointer space-y-1">
                            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                {t('settings.general.browserTabs.closeOnSaveLabel')}
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                                {t('settings.general.browserTabs.closeOnSaveDescription')}
                            </div>
                        </Label>
                    </div>

                    <div className="flex items-start gap-3 p-3 border border-border rounded-lg">
                        <Switch
                            id="browser-inactive-indicator"
                            checked={settings.browserTabsShowInactiveIndicator ?? true}
                            onCheckedChange={(checked) => updateSetting('browserTabsShowInactiveIndicator', checked)}
                        />
                        <Label htmlFor="browser-inactive-indicator" className="flex-1 cursor-pointer space-y-1">
                            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                {t('settings.general.browserTabs.inactiveIndicatorLabel')}
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                                {t('settings.general.browserTabs.inactiveIndicatorDescription')}
                            </div>
                        </Label>
                    </div>
                </div>
            </div>

            {/* Auto-archive Settings */}
            <div>
                <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2 mb-4">
                    <Archive className="w-5 h-5" />
                    {t('settings.general.autoArchive.title')}
                </h3>

                <div className="space-y-3 p-3 border border-border rounded-lg">
                    <div className="flex items-start gap-3">
                        <Switch
                            id="auto-archive-inactive"
                            checked={settings.autoArchiveInactiveGroups ?? false}
                            onCheckedChange={(checked) => { void updateAutoArchive({ autoArchiveInactiveGroups: checked }); }}
                        />
                        <Label htmlFor="auto-archive-inactive" className="flex-1 cursor-pointer space-y-1">
                            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                {t('settings.general.autoArchive.label')}
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                                {t('settings.general.autoArchive.description')}
                            </div>
                        </Label>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 ps-12">
                        <Label htmlFor="auto-archive-days" className="text-sm text-gray-700 dark:text-gray-300">
                            {t('settings.general.autoArchive.daysLabel')}
                        </Label>
                        <Select
                            value={String(resolveAutoArchiveDays(settings.autoArchiveInactiveDays))}
                            onValueChange={(value) => { void updateAutoArchive({ autoArchiveInactiveDays: Number(value) }); }}
                            disabled={!settings.autoArchiveInactiveGroups}
                        >
                            <SelectTrigger id="auto-archive-days" className="w-36">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {AUTO_ARCHIVE_DAY_OPTIONS.map((days) => (
                                    <SelectItem key={days} value={String(days)}>
                                        {t('settings.general.autoArchive.days', { count: days })}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>
            </div>

            {/* Group Memory Settings */}
            <div>
                <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2 mb-4">
                    <Brain className="w-5 h-5" />
                    {t('settings.general.groupMemory.title')}
                </h3>

                <div className="space-y-4">
                    <div className="flex items-start gap-3 p-3 border border-border rounded-lg">
                        <Switch
                            id="memory-enabled"
                            checked={settings.groupMemoryEnabled ?? true}
                            onCheckedChange={(checked) => updateSetting('groupMemoryEnabled', checked)}
                        />
                        <Label htmlFor="memory-enabled" className="flex-1 cursor-pointer space-y-1">
                            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                {t('settings.general.groupMemory.enableLabel')}
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                                {t('settings.general.groupMemory.enableDescription')}
                            </div>
                        </Label>
                    </div>

                    {(settings.groupMemoryEnabled ?? true) && (
                        <div className="flex items-start gap-3 p-3 border border-border rounded-lg ms-4">
                            <Switch
                                id="memory-auto"
                                checked={settings.groupMemoryAutoRemember ?? true}
                                onCheckedChange={(checked) => updateSetting('groupMemoryAutoRemember', checked)}
                            />
                            <Label htmlFor="memory-auto" className="flex-1 cursor-pointer space-y-1">
                                <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                    {t('settings.general.groupMemory.autoRememberLabel')}
                                </div>
                                <div className="text-xs text-gray-500 dark:text-gray-400">
                                    {t('settings.general.groupMemory.autoRememberDescription')}
                                </div>
                            </Label>
                        </div>
                    )}
                </div>
            </div>

            {/* Floating Button Settings */}
            <div>
                <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2 mb-4">
                    <CirclePlus className="w-5 h-5" />
                    {t('settings.general.floatingButton.title')}
                </h3>

                <div className="space-y-4">
                    <div className="flex items-start gap-3 p-3 border border-border rounded-lg">
                        <Switch
                            id="floating-enabled"
                            checked={settings.floatingButtonEnabled ?? true}
                            onCheckedChange={(checked) => updateSettingWithNotify('floatingButtonEnabled', checked)}
                        />
                        <Label htmlFor="floating-enabled" className="flex-1 cursor-pointer space-y-1">
                            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                {t('settings.general.floatingButton.showLabel')}
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                                {t('settings.general.floatingButton.showDescription')}
                            </div>
                        </Label>
                    </div>

                    {(settings.floatingButtonEnabled ?? true) && (
                        <>
                            {!floatingButtonSiteAccess && (
                                <div className="ms-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                                    <div className="flex items-start gap-3">
                                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                                        <div className="min-w-0 flex-1 space-y-2">
                                            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                                {t('settings.general.floatingButton.siteAccessRequired')}
                                            </div>
                                            <div className="text-xs text-gray-600 dark:text-gray-400">
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

                            <div className="p-3 border border-border rounded-lg ms-4">
                                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3 block">
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

                            <div className="flex items-start gap-3 p-3 border border-border rounded-lg ms-4">
                                <Switch
                                    id="floating-confirm"
                                    checked={settings.floatingButtonConfirmSaveAll ?? true}
                                    onCheckedChange={(checked) => updateSettingWithNotify('floatingButtonConfirmSaveAll', checked)}
                                />
                                <Label htmlFor="floating-confirm" className="flex-1 cursor-pointer space-y-1">
                                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                        {t('settings.general.floatingButton.confirmSaveAllLabel')}
                                    </div>
                                    <div className="text-xs text-gray-500 dark:text-gray-400">
                                        {t('settings.general.floatingButton.confirmSaveAllDescription')}
                                    </div>
                                </Label>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* Duplicate Handling Settings */}
            <div>
                <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2 mb-4">
                    <Copy className="w-5 h-5" />
                    {t('settings.general.duplicates.title')}
                </h3>

                <div className="space-y-4">
                    <div>
                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3 block">
                            {t('settings.general.duplicates.handlingLabel')}
                        </label>
                        <RadioGroup
                            value={settings.duplicateHandling}
                            onValueChange={(value) => updateSetting('duplicateHandling', value as 'allow' | 'reject')}
                            className="space-y-3"
                        >
                            <div className="flex items-start gap-3 p-3 border border-border rounded-lg">
                                <RadioGroupItem value="allow" id="duplicate-allow" className="mt-1" />
                                <Label htmlFor="duplicate-allow" className="flex-1 cursor-pointer space-y-1">
                                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                        {t('settings.general.duplicates.allow')}
                                    </div>
                                </Label>
                            </div>
                            <div className="flex items-start gap-3 p-3 border border-border rounded-lg">
                                <RadioGroupItem value="reject" id="duplicate-reject" className="mt-1" />
                                <Label htmlFor="duplicate-reject" className="flex-1 cursor-pointer space-y-1">
                                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                        {t('settings.general.duplicates.reject')}
                                    </div>
                                    <div className="text-xs text-gray-500 dark:text-gray-400">
                                        {t('settings.general.duplicates.rejectDescription')}
                                    </div>
                                </Label>
                            </div>
                        </RadioGroup>
                    </div>
                </div>
            </div>
        </div>
    );
}
