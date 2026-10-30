import React, { useState, useEffect } from 'react';
import { Lock, Eye, EyeOff, Loader2, StickyNote } from 'lucide-react';
import { ArchivedGroup } from '../../../types/archive';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatDateTime } from '@/i18n/format';
import { ArchiveService } from '../../../services/archive-service';
import { useTranslation } from 'react-i18next';

interface ArchiveViewModalProps {
    isOpen: boolean;
    onClose: () => void;
    archive: ArchivedGroup | null;
}

export function ArchiveViewModal({ isOpen, onClose, archive }: ArchiveViewModalProps) {
    const { t } = useTranslation();
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isVerifying, setIsVerifying] = useState(false);
    const [decryptedArchive, setDecryptedArchive] = useState<ArchivedGroup | null>(null);
    const [showPassword, setShowPassword] = useState(false);

    useEffect(() => {
        if (!isOpen) {
            setPassword('');
            setError('');
            setDecryptedArchive(null);
            setShowPassword(false);
        } else if (archive) {
            // If not password protected, show directly
            if (!archive.protection.passwordProtected) {
                setDecryptedArchive(archive);
            }
        }
    }, [isOpen, archive]);

    const handlePasswordSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!archive || !password.trim()) {
            setError(t('archive.view.enterPassword'));
            return;
        }

        setIsVerifying(true);
        setError('');

        try {
            const result = await ArchiveService.verifyArchivePassword(archive.id, password);
            if (result.success && result.decryptedArchive) {
                setDecryptedArchive(result.decryptedArchive);
                setPassword('');
            } else {
                setError(result.error || t('archive.view.incorrectPassword'));
            }
        } catch (err) {
            setError(t('archive.view.verifyFailed'));
        } finally {
            setIsVerifying(false);
        }
    };

    const formatDate = (timestamp: number) => {
        return formatDateTime(timestamp);
    };

    const isPasswordProtected = archive?.protection.passwordProtected;
    const shouldShowPassword = isPasswordProtected && !decryptedArchive;

    // Helper to safely display hint (handle both encrypted and plain text hints)
    const getPasswordHint = (hint: string | undefined): string | null => {
        if (!hint) return null;

        // Check if hint is encrypted JSON
        try {
            const parsed = JSON.parse(hint);
            if (parsed.data && parsed.iv && parsed.salt) {
                // This is an encrypted hint from old archives, don't show it
                return null;
            }
        } catch {
            // Not JSON, plain text hint
        }

        return hint;
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="w-auto min-w-[320px] sm:min-w-[500px] max-w-[90vw] max-h-[85vh] overflow-y-auto scrollbar-transparent">
                <DialogHeader className="mb-2">
                    <DialogTitle className="text-xl text-gray-900 dark:text-gray-100">
                        <bdi dir="auto">
                            {decryptedArchive
                                ? (typeof decryptedArchive.originalGroup === 'string' ? t('archive.item.protectedArchive') : decryptedArchive.originalGroup.name)
                                : t('archive.view.viewArchive')}
                        </bdi>
                    </DialogTitle>
                </DialogHeader>

                {shouldShowPassword ? (
                    // Password Form
                    <form onSubmit={handlePasswordSubmit} className="space-y-4">
                        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
                            <div className="flex items-center gap-2 text-amber-700 dark:text-amber-200 mb-2">
                                <Lock className="w-4 h-4" />
                                <span className="font-medium">{t('archive.view.passwordProtected')}</span>
                            </div>
                            <p className="text-sm text-amber-700 dark:text-amber-200">
                                {t('archive.view.encryptedDescription')}
                            </p>
                            {getPasswordHint(archive.protection.passwordHint) && (
                                <p className="mt-2 text-sm text-amber-700 dark:text-amber-200">
                                    <strong>{t('archive.view.hint')}:</strong>{' '}
                                    <bdi dir="auto">{getPasswordHint(archive.protection.passwordHint)}</bdi>
                                </p>
                            )}
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="password" className="text-gray-900 dark:text-gray-100">{t('archive.view.password')}</Label>
                            <div className="relative">
                                <Input
                                    id="password"
                                    type={showPassword ? 'text' : 'password'}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder={t('archive.view.passwordPlaceholder')}
                                    className="pe-10 bg-bg-0 text-text-strong placeholder:text-gray-400 focus-visible:ring-primary/50 focus-visible:ring-offset-0"
                                    dir="ltr"
                                    autoFocus
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute end-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                                >
                                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                </button>
                            </div>
                            {error && (
                                <p dir="auto" className="text-sm text-red-600 dark:text-red-400">{error}</p>
                            )}
                        </div>

                        <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 sm:gap-3">
                            <Button type="button" variant="secondary" onClick={onClose} className="w-full sm:w-auto">
                                {t('common.cancel')}
                            </Button>
                            <Button type="submit" disabled={isVerifying || !password.trim()} className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700 text-white">
                                {isVerifying ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin me-2" />
                                        {t('archive.view.verifying')}
                                    </>
                                ) : (
                                    t('archive.view.unlock')
                                )}
                            </Button>
                        </div>
                    </form>
                ) : decryptedArchive && typeof decryptedArchive.originalGroup !== 'string' ? (
                    // Archive Content
                    <div className="space-y-4">
                        {/* Archive Info */}
                        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                                <div>
                                    <span className="text-gray-500 dark:text-gray-400">{t('archive.view.archived')}</span>
                                    <span dir="ltr" className="ms-2 text-gray-900 dark:text-gray-100">
                                        {formatDate(decryptedArchive.metadata.archivedDate)}
                                    </span>
                                </div>
                                {decryptedArchive.metadata.archiveReason && (
                                    <div className="col-span-2">
                                        <span className="text-gray-500 dark:text-gray-400">{t('archive.view.reason')}</span>
                                        <span className="ms-2 text-gray-900 dark:text-gray-100 italic">
                                            <bdi dir="auto">"{decryptedArchive.metadata.archiveReason}"</bdi>
                                        </span>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Notes */}
                        {decryptedArchive.originalGroup.notes && (
                            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
                                <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mb-1">
                                    <StickyNote className="w-4 h-4" />
                                    <span>{t('archive.view.note')}</span>
                                </div>
                                <p dir="auto" className="text-sm text-gray-900 dark:text-gray-100 whitespace-pre-wrap break-words">
                                    {decryptedArchive.originalGroup.notes}
                                </p>
                            </div>
                        )}

                        {/* Tabs List */}
                        <div>
                            <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-3">
                                {t('archive.view.tabsTitle', { count: decryptedArchive.originalGroup.tabs.length })}
                            </h3>
                            <div className="space-y-2 max-h-[400px] overflow-y-auto scrollbar-transparent">
                                {decryptedArchive.originalGroup.tabs.map((tab, index) => (
                                    <div
                                        key={index}
                                        className="flex items-start gap-2 sm:gap-3 p-3 sm:p-4 bg-bg-1 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                                    >
                                        <img
                                            src={tab.favicon || '/icons/default-favicon.png'}
                                            alt=""
                                            className="w-4 h-4 flex-shrink-0 mt-0.5"
                                            onError={(e) => {
                                                e.currentTarget.src = '/icons/default-favicon.png';
                                            }}
                                        />
                                        <div className="flex-1 min-w-0">
                                            <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                                                <bdi dir="auto">{tab.title}</bdi>
                                            </div>
                                            <a
                                                href={tab.url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-xs text-blue-600 dark:text-blue-400 hover:underline truncate block"
                                            >
                                                <bdi dir="ltr">{tab.url}</bdi>
                                            </a>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="flex justify-end">
                            <Button variant="secondary" onClick={onClose} className="w-full sm:w-auto">
                                {t('common.close')}
                            </Button>
                        </div>
                    </div>
                ) : null}
            </DialogContent>
        </Dialog>
    );
}
