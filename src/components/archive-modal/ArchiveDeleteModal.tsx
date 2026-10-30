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
import { ArchiveService } from '../../services/archive-service';
import { AlertTriangle, Lock, Eye, EyeOff, Loader2, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isolateBidi } from '@/i18n/bidi';

interface ArchiveDeleteModalProps {
    isOpen: boolean;
    onClose: () => void;
    archive: ArchivedGroup | null;
    onDelete: (password?: string) => Promise<void>;
}

export function ArchiveDeleteModal({ isOpen, onClose, archive, onDelete }: ArchiveDeleteModalProps) {
    const { t } = useTranslation();
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isDeleting, setIsDeleting] = useState(false);
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

        if (archive.protection.passwordProtected) {
            if (!password.trim()) {
                setError(t('archive.view.enterPassword'));
                return;
            }

            // Verify password before deleting
            setIsDeleting(true);
            setError('');

            try {
                const result = await ArchiveService.verifyArchivePassword(archive.id, password);
                if (!result.success) {
                    setError(t('archive.view.incorrectPassword'));
                    setIsDeleting(false);
                    return;
                }

                await onDelete(password);
                onClose();
            } catch (err) {
                setError((err as Error).message || t('components.archive.deleteFailed'));
            } finally {
                setIsDeleting(false);
            }
        } else {
            // No password needed
            setIsDeleting(true);
            try {
                await onDelete();
                onClose();
            } catch (err) {
                setError((err as Error).message || t('components.archive.deleteFailed'));
            } finally {
                setIsDeleting(false);
            }
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
                        <Trash2 className="w-5 h-5 text-danger" />
                        {t('archive.item.deleteArchive')}
                    </DialogTitle>
                    <DialogDescription>
                        {t('components.archive.deleteDescription')}
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-0">
                    <div className="px-5 py-4 space-y-4">
                        <div className="rounded-xl border border-danger/20 bg-danger/10 p-4">
                            <div className="flex items-center gap-2 text-danger mb-2">
                                <AlertTriangle className="w-4 h-4" />
                                <span className="font-medium">{t('components.archive.permanentDeletion')}</span>
                            </div>
                            <p className="text-sm text-text-muted">
                                {t('components.archive.permanentConfirm', { name: isolateBidi(groupName, 'auto') })}
                            </p>
                        </div>

                        {isPasswordProtected && (
                            <>
                                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
                                    <div className="flex items-center gap-2 text-amber-700 dark:text-amber-200 mb-2">
                                        <Lock className="w-4 h-4" />
                                        <span className="font-medium">{t('archive.item.passwordProtected')}</span>
                                    </div>
                                    <p className="text-sm text-amber-700 dark:text-amber-200">
                                        {t('components.archive.encryptedDelete')}
                                    </p>
                                    {getPasswordHint(archive.protection.passwordHint) && (
                                        <p className="mt-2 text-sm text-amber-700 dark:text-amber-200">
                                            <strong>{t('components.archive.hint')}</strong> {getPasswordHint(archive.protection.passwordHint)}
                                        </p>
                                    )}
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="delete-password">{t('auth.login.password')}</Label>
                                    <div className="relative">
                                        <Input
                                            id="delete-password"
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
                                            className="absolute end-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                                        >
                                            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                        </button>
                                    </div>
                                </div>
                            </>
                        )}

                        {error && (
                            <p dir="auto" className="text-sm text-red-600 dark:text-red-400">{error}</p>
                        )}
                    </div>

                    <DialogFooter className="px-5 py-4 border-t border-border bg-transparent">
                        <Button type="button" variant="secondary" onClick={onClose}>
                            {t('common.cancel')}
                        </Button>
                        <Button
                            type="submit"
                            variant="danger"
                            disabled={isDeleting || (isPasswordProtected && !password.trim())}
                        >
                            {isDeleting ? (
                                <>
                                    <Loader2 className="w-4 h-4 me-2 animate-spin" />
                                    {t('components.archive.deleting')}
                                </>
                            ) : (
                                <>
                                    <Trash2 className="w-4 h-4 me-2" />
                                    {t('common.delete')}
                                </>
                            )}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
