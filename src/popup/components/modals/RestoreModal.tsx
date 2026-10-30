import { useState, useEffect, useCallback } from 'react';
import { Archive, Lock, Lightbulb, Loader2, AlertCircle, AlertTriangle } from 'lucide-react';
import { ModalWrapper } from './ModalWrapper';
import { PasswordInput } from '../common/PasswordInput';
import { ArchivedGroup, RestoreOptions } from '../../../types/archive';
import { TabGroup } from '../../../types/models';
import { getLocaleTag } from '@/i18n';
import { isolateBidi } from '@/i18n/bidi';
import { useTranslation } from 'react-i18next';

interface RestoreModalProps {
    isOpen: boolean;
    onClose: () => void;
    onRestore: (options: RestoreOptions) => Promise<void>;
    archive: ArchivedGroup | null;
}

interface PreviewData {
    groupName: string;
    tabCount: number;
    tabs: Array<{
        title: string;
        url: string;
        favicon?: string;
    }>;
    duplicateWarnings: Array<{
        title: string;
        url: string;
        reason: string;
    }>;
}

export function RestoreModal({
    isOpen,
    onClose,
    onRestore,
    archive
}: RestoreModalProps) {
    const { t } = useTranslation();
    const [password, setPassword] = useState('');
    const [passwordError, setPasswordError] = useState('');
    const [conflictStrategy, setConflictStrategy] = useState<RestoreOptions['handleConflicts']>('skip');
    const [restoreToActive, setRestoreToActive] = useState(true);
    const [isRestoring, setIsRestoring] = useState(false);
    const [previewData, setPreviewData] = useState<PreviewData | null>(null);
    const [isLoadingPreview, setIsLoadingPreview] = useState(false);
    const [previewError, setPreviewError] = useState('');

    const loadPreview = useCallback(async () => {
        if (!archive) return;

        setIsLoadingPreview(true);
        setPreviewError('');

        try {
            // Handle password-protected archives
            if (archive.protection.passwordProtected && typeof archive.originalGroup === 'string') {
                // For password-protected archives, we can't show preview without password
                setPreviewData({
                    groupName: t('popup.restoreModal.protectedArchiveName'),
                    tabCount: 0,
                    tabs: [],
                    duplicateWarnings: []
                });
                return;
            }

            // For unprotected archives, extract preview data
            if (typeof archive.originalGroup === 'object') {
                const group = archive.originalGroup as TabGroup;

                // TODO: Replace with actual duplicate detection service
                // const restorationService = new RestorationService();
                // const duplicates = await restorationService.checkForDuplicates(group.tabs);

                setPreviewData({
                    groupName: group.name,
                    tabCount: group.tabs.length,
                    tabs: group.tabs.slice(0, 20), // Show first 20 tabs
                    duplicateWarnings: [] // Mock: no duplicates for now
                });
            }
        } catch (error) {
            setPreviewError(error instanceof Error ? error.message : t('popup.restoreModal.errors.loadPreview'));
        } finally {
            setIsLoadingPreview(false);
        }
    }, [archive, t]);

    // Reset form when modal opens/closes or archive changes
    useEffect(() => {
        if (isOpen && archive) {
            setPassword('');
            setPasswordError('');
            setConflictStrategy('skip');
            setRestoreToActive(true);
            setIsRestoring(false);
            setPreviewData(null);
            setPreviewError('');
            void loadPreview();
        }
    }, [isOpen, archive, loadPreview]);

    const loadPreviewWithPassword = async () => {
        if (!archive || !password) return;

        setIsLoadingPreview(true);
        setPasswordError('');
        setPreviewError('');

        try {
            // TODO: Replace with actual decryption service
            // const restorationService = new RestorationService();
            // const decryptedGroup = await restorationService.decryptArchive(archive, password);

            // Mock successful decryption
            setPreviewData({
                groupName: t('popup.restoreModal.decryptedArchiveName'),
                tabCount: 5, // Mock count
                tabs: [
                    { title: t('components.restoreModal.exampleTab1'), url: 'https://example.com/1', favicon: '/icons/default-favicon.png' },
                    { title: t('components.restoreModal.exampleTab2'), url: 'https://example.com/2', favicon: '/icons/default-favicon.png' }
                ],
                duplicateWarnings: []
            });
        } catch (error) {
            if (error instanceof Error && error.message.includes('password')) {
                setPasswordError(t('popup.restoreModal.errors.incorrectPassword'));
            } else {
                setPreviewError(error instanceof Error ? error.message : t('popup.restoreModal.errors.decrypt'));
            }
        } finally {
            setIsLoadingPreview(false);
        }
    };

    const handleRestore = async () => {
        if (!archive) return;

        setIsRestoring(true);
        try {
            await onRestore({
                password: archive.protection.passwordProtected ? password : undefined,
                handleConflicts: conflictStrategy,
                restoreToActive
            });
            onClose();
        } catch (error) {
            if (error instanceof Error && error.message.includes('password')) {
                setPasswordError(t('popup.restoreModal.errors.incorrectPassword'));
            } else {
                setPreviewError(error instanceof Error ? error.message : t('popup.restoreModal.errors.restore'));
            }
        } finally {
            setIsRestoring(false);
        }
    };

    if (!archive) return null;

    const isPasswordRequired = archive.protection.passwordProtected && !previewData;
    const canRestore = !isPasswordRequired || (password && previewData);

    return (
        <ModalWrapper
            isOpen={isOpen}
            onClose={onClose}
            title={t('popup.restoreModal.title')}
            size="lg"
        >
            <div className="space-y-4">
                {/* Archive Info */}
                <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
                    <div className="flex items-center gap-3 mb-2">
                        <Archive className="w-5 h-5 text-blue-500" />
                        <div>
                            <h3 className="font-medium text-gray-900 dark:text-gray-100">
                                {t('popup.restoreModal.archiveId', { id: isolateBidi(archive.id.slice(0, 8), 'ltr') })}
                            </h3>
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                                {t('popup.restoreModal.createdAt', {
                                    date: isolateBidi(new Date(archive.metadata.archivedDate).toLocaleString(getLocaleTag()), 'ltr'),
                                })}
                            </p>
                        </div>
                        {archive.protection.passwordProtected && (
                            <Lock className="w-4 h-4 text-yellow-500" aria-label={t('popup.restoreModal.passwordProtectedAria')} />
                        )}
                    </div>
                    {archive.metadata.archiveReason && (
                        <p className="text-sm text-gray-600 dark:text-gray-300 italic">
                            <bdi dir="auto">"{archive.metadata.archiveReason}"</bdi>
                        </p>
                    )}
                </div>

                {/* Password Input for Protected Archives */}
                {archive.protection.passwordProtected && !previewData && (
                    <div className="space-y-3">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                {t('popup.restoreModal.enterPassword')}
                            </label>
                            <PasswordInput
                                value={password}
                                onChange={setPassword}
                                placeholder={t('popup.restoreModal.passwordPlaceholder')}
                                showStrengthMeter={false}
                                autoFocus
                            />
                            {passwordError && (
                                <p className="mt-1 text-sm text-red-600 dark:text-red-400">{passwordError}</p>
                            )}
                        </div>

                        {archive.protection.passwordHint && (
                            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                                <div className="flex items-start gap-2">
                                    <Lightbulb className="w-4 h-4 text-blue-500" />
                                    <div>
                                        <div className="text-sm font-medium text-blue-800 dark:text-blue-200">{t('popup.restoreModal.passwordHint')}</div>
                                        <div dir="auto" className="text-sm text-blue-700 dark:text-blue-300">{archive.protection.passwordHint}</div>
                                    </div>
                                </div>
                            </div>
                        )}

                        <button
                            onClick={loadPreviewWithPassword}
                            disabled={!password || isLoadingPreview}
                            className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                            {isLoadingPreview && <Loader2 className="w-4 h-4 animate-spin" />}
                            {isLoadingPreview ? t('popup.restoreModal.decrypting') : t('popup.restoreModal.decryptAndPreview')}
                        </button>
                    </div>
                )}

                {/* Loading State */}
                {isLoadingPreview && !archive.protection.passwordProtected && (
                    <div className="flex items-center justify-center py-8">
                        <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span>{t('popup.restoreModal.loadingPreview')}</span>
                        </div>
                    </div>
                )}

                {/* Preview Error */}
                {previewError && (
                    <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
                        <div className="flex items-center gap-2 text-red-800 dark:text-red-200">
                            <AlertCircle className="w-4 h-4" />
                            <span dir="auto" className="text-sm">{previewError}</span>
                        </div>
                    </div>
                )}

                {/* Preview Content */}
                {previewData && (
                    <div className="space-y-4">
                        {/* Group Info */}
                        <div className="border border-border rounded-lg p-4">
                            <h4 className="font-medium text-gray-900 dark:text-gray-100 mb-2">
                                {t('popup.restoreModal.previewTitle', { name: isolateBidi(previewData.groupName) })}
                            </h4>
                            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                                {t('popup.restoreModal.tabsWillBeRestored', { count: previewData.tabCount })}
                            </p>

                            {/* Duplicate Warnings */}
                            {previewData.duplicateWarnings.length > 0 && (
                                <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3 mb-3">
                                    <div className="flex items-start gap-2">
                                        <AlertTriangle className="w-4 h-4 text-yellow-600 dark:text-yellow-400" />
                                        <div>
                                            <div className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
                                                {t('popup.restoreModal.potentialDuplicates')}
                                            </div>
                                            <div className="text-sm text-yellow-700 dark:text-yellow-300 mt-1">
                                                {t('popup.restoreModal.duplicatesMayBeOpen', { count: previewData.duplicateWarnings.length })}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Tab Preview */}
                            {previewData.tabs.length > 0 && (
                                <div className="space-y-2 max-h-40 overflow-y-auto">
                                    {previewData.tabs.map((tab, index) => (
                                        <div key={index} className="flex items-center gap-3 p-2 bg-gray-50 dark:bg-gray-700 rounded">
                                            <img
                                                src={tab.favicon || '/icons/default-favicon.png'}
                                                alt=""
                                                className="w-4 h-4 flex-shrink-0"
                                                onError={(e) => {
                                                    e.currentTarget.src = '/icons/default-favicon.png';
                                                }}
                                            />
                                            <div className="flex-1 min-w-0">
                                                <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                                                    <bdi dir="auto">{tab.title}</bdi>
                                                </div>
                                                <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                                                    <bdi dir="ltr">{tab.url}</bdi>
                                                </div>
                                            </div>
                                        </div>
                                    ))}

                                    {previewData.tabCount > previewData.tabs.length && (
                                        <div className="text-center text-sm text-gray-500 dark:text-gray-400 py-2">
                                            {t('popup.restoreModal.moreTabs', {
                                                count: previewData.tabCount - previewData.tabs.length
                                            })}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Restore Options */}
                        <div className="space-y-3">
                            <h4 className="font-medium text-gray-900 dark:text-gray-100">{t('popup.restoreModal.optionsTitle')}</h4>

                            {/* Conflict Handling */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                    {t('popup.restoreModal.handleDuplicates')}
                                </label>
                                <select
                                    value={conflictStrategy}
                                    onChange={(e) => setConflictStrategy(e.target.value as RestoreOptions['handleConflicts'])}
                                    className="w-full px-3 py-2 text-sm border border-border rounded-md bg-bg-1/60 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                                >
                                    <option value="skip">{t('popup.restoreModal.conflictStrategies.skip')}</option>
                                    <option value="replace">{t('popup.restoreModal.conflictStrategies.replace')}</option>
                                    <option value="rename">{t('popup.restoreModal.conflictStrategies.rename')}</option>
                                </select>
                            </div>

                            {/* Restore Location */}
                            <div className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    id="restore-active"
                                    checked={restoreToActive}
                                    onChange={(e) => setRestoreToActive(e.target.checked)}
                                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                />
                                <label htmlFor="restore-active" className="text-sm text-gray-700 dark:text-gray-300">
                                    {t('popup.restoreModal.restoreToActive')}
                                </label>
                            </div>
                        </div>
                    </div>
                )}

                {/* Actions */}
                <div className="flex justify-end gap-3 pt-4 border-t border-border">
                    <button
                        onClick={onClose}
                        disabled={isRestoring}
                        className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors disabled:opacity-50"
                    >
                        {t('common.cancel')}
                    </button>
                    <button
                        onClick={handleRestore}
                        disabled={!canRestore || isRestoring}
                        className="px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                        {isRestoring && <Loader2 className="w-4 h-4 animate-spin" />}
                        {isRestoring ? t('popup.restoreModal.restoring') : t('popup.restoreModal.restoreArchive')}
                    </button>
                </div>
            </div>
        </ModalWrapper>
    );
}
