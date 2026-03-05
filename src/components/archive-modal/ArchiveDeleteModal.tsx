import React, { useState, useEffect } from 'react';
import { ArchivedGroup } from '../../types/archive';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArchiveService } from '../../services/archive-service';
import { AlertTriangle, Lock, Eye, EyeOff, Loader2, Trash2 } from 'lucide-react';

interface ArchiveDeleteModalProps {
    isOpen: boolean;
    onClose: () => void;
    archive: ArchivedGroup | null;
    onDelete: (password?: string) => Promise<void>;
}

export function ArchiveDeleteModal({ isOpen, onClose, archive, onDelete }: ArchiveDeleteModalProps) {
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
                setError('Please enter a password');
                return;
            }

            // Verify password before deleting
            setIsDeleting(true);
            setError('');

            try {
                const result = await ArchiveService.verifyArchivePassword(archive.id, password);
                if (!result.success) {
                    setError('Incorrect password');
                    setIsDeleting(false);
                    return;
                }

                await onDelete(password);
                onClose();
            } catch (err) {
                setError((err as Error).message || 'Failed to delete archive');
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
                setError((err as Error).message || 'Failed to delete archive');
            } finally {
                setIsDeleting(false);
            }
        }
    };

    if (!archive) return null;

    const isPasswordProtected = archive.protection.passwordProtected;
    const groupName = typeof archive.originalGroup === 'string'
        ? 'Protected Archive'
        : archive.originalGroup.name;

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="w-auto min-w-[450px] max-w-[90vw]">
                <DialogHeader>
                    <DialogTitle className="text-xl text-gray-900 dark:text-gray-100">
                        Delete Archive
                    </DialogTitle>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-4">
                    {/* Warning */}
                    <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
                        <div className="flex items-center gap-2 text-red-800 dark:text-red-200 mb-2">
                            <AlertTriangle className="w-4 h-4" />
                            <span className="font-medium">Permanent Deletion</span>
                        </div>
                        <p className="text-sm text-red-700 dark:text-red-300">
                            "{groupName}" will be permanently deleted. This action cannot be undone.
                        </p>
                    </div>

                    {isPasswordProtected && (
                        <>
                            {/* Password Protection Notice */}
                            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
                                <div className="flex items-center gap-2 text-yellow-800 dark:text-yellow-200 mb-2">
                                    <Lock className="w-4 h-4" />
                                    <span className="font-medium">Password Protected</span>
                                </div>
                                <p className="text-sm text-yellow-700 dark:text-yellow-300">
                                    This archive is encrypted. Enter the password to delete it.
                                </p>
                                {getPasswordHint(archive.protection.passwordHint) && (
                                    <p className="text-sm text-yellow-600 dark:text-yellow-400 mt-2">
                                        <strong>Hint:</strong> {getPasswordHint(archive.protection.passwordHint)}
                                    </p>
                                )}
                            </div>

                            {/* Password Input */}
                            <div className="space-y-2">
                                <Label htmlFor="delete-password" className="text-gray-900 dark:text-gray-100">Password</Label>
                                <div className="relative">
                                    <Input
                                        id="delete-password"
                                        type={showPassword ? 'text' : 'password'}
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        placeholder="Enter password"
                                        className="pr-10"
                                        autoFocus
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                                    >
                                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                    </button>
                                </div>
                                {error && (
                                    <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
                                )}
                            </div>
                        </>
                    )}

                    {/* Action Buttons */}
                    <div className="flex justify-end gap-2">
                        <Button type="button" variant="secondary" onClick={onClose}>
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            disabled={isDeleting || (isPasswordProtected && !password.trim())}
                            className="bg-red-600 hover:bg-red-700 text-white"
                        >
                            {isDeleting ? (
                                <>
                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                    Deleting...
                                </>
                            ) : (
                                <>
                                    <Trash2 className="w-4 h-4 mr-2" />
                                    Delete
                                </>
                            )}
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    );
}
