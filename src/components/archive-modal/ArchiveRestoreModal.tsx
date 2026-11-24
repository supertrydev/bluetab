import React, { useState, useEffect } from 'react';
import { ArchivedGroup } from '../../types/archive';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RotateCcw, Lock, Eye, EyeOff, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isolateBidi } from '@/i18n/bidi';

interface ArchiveRestoreModalProps {
    isOpen: boolean;
    onClose: () => void;
    archive: ArchivedGroup | null;
    onRestore: (password?: string) => Promise<void>;
}

export function ArchiveRestoreModal({ isOpen, onClose, archive, onRestore }: ArchiveRestoreModalProps) {
    const { t } = useTranslation();
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isRestoring, setIsRestoring] = useState(false);
    const [showPassword, setShowPassword] = useState(false);

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

    useEffect(() => {
        if (!isOpen) {
            setPassword('');
            setError('');
            setShowPassword(false);
        }
    }, [isOpen]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!archive) return;

        if (archive.protection.passwordProtected && !password.trim()) {
            setError(t('archive.view.enterPassword'));
            return;
        }

        setIsRestoring(true);
        setError('');

        try {
            await onRestore(archive.protection.passwordProtected ? password : undefined);
            onClose();
        } catch (err) {
            setError((err as Error).message || t('components.archive.restoreFailed'));
        } finally {
            setIsRestoring(false);
        }
    };

    if (!archive) return null;

    const isPasswordProtected = archive.protection.passwordProtected;
    const groupName = typeof archive.originalGroup === 'string'
        ? t('components.archive.protectedArchive')
        : archive.originalGroup.name;

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="w-[min(32rem,calc(100vw-2rem))] p-0 gap-0 overflow-hidden">
                <DialogHeader className="px-5 pt-5 pb-4 border-b border-border pe-12">
                    <DialogTitle className="flex items-center gap-2">
                        <RotateCcw className="w-5 h-5 text-primary" />
                        {t('archive.item.restoreArchive')}
                    </DialogTitle>
                    <DialogDescription>
                        {t('components.archive.restoreDescription')}
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-0">
                    <div className="px-5 py-4 space-y-4">
                        {!isPasswordProtected && (
                            <p className="text-sm text-text-muted">
                                {t('components.archive.restoreConfirm', { name: isolateBidi(groupName, 'auto') })}
                            </p>
                        )}

                        {isPasswordProtected && (
                            <>
                                <div className="rounded-md bg-warning-muted p-4">
                                    <div className="flex items-center gap-2 text-warning mb-2">
                                        <Lock className="w-4 h-4" />
                                        <span className="font-medium">{t('archive.item.passwordProtected')}</span>
                                    </div>
                                    <p className="text-sm text-warning">
                                        {t('components.archive.encryptedRestore')}
                                    </p>
                                    {getPasswordHint(archive.protection.passwordHint) && (
                                        <p className="mt-2 text-sm text-warning">
                                            <strong>{t('components.archive.hint')}</strong> {getPasswordHint(archive.protection.passwordHint)}
                                        </p>
                                    )}
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="restore-password">{t('auth.login.password')}</Label>
                                    <div className="relative">
                                        <Input
                                            id="restore-password"
                                            type={showPassword ? 'text' : 'password'}
                                            dir="ltr"
                                            value={password}
                                            onChange={(e) => setPassword(e.target.value)}
                                            placeholder={t('archive.view.passwordPlaceholder')}
                                            className="pe-10"
                                            autoFocus
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowPassword(!showPassword)}
                                            className="absolute end-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-strong"
                                        >
                                            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                        </button>
                                    </div>
                                </div>
                            </>
                        )}

                        {error && (
                            <p dir="auto" className="text-sm text-danger">{error}</p>
                        )}
                    </div>

                    <DialogFooter className="px-5 py-4 border-t border-border bg-transparent">
                        <Button type="button" variant="secondary" onClick={onClose}>
                            {t('common.cancel')}
                        </Button>
                        <Button
                            type="submit"
                            disabled={isRestoring || (isPasswordProtected && !password.trim())}
                        >
                            {isRestoring ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    {t('popup.restoreModal.restoring')}
                                </>
                            ) : (
                                <>
                                    <RotateCcw className="w-4 h-4" />
                                    {t('common.restore')}
                                </>
                            )}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
