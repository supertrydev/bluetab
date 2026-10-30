import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { CheckCircle, X, MessageCircle, Linkedin, Copy, ExternalLink, Send, Mail, Globe2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { buildShareText, openShareUrl } from '@/utils/social-share';
import type { SharePlatformId } from '@/utils/social-share';
import type { TabGroup } from '@/types/models';

export interface BluetShareSuccessModalProps {
    isOpen: boolean;
    onClose: () => void;
    group: TabGroup | null;
    bluetUrl: string;
    isUpdate: boolean;
}

export function BluetShareSuccessModal({
    isOpen,
    onClose,
    group,
    bluetUrl,
    isUpdate,
}: BluetShareSuccessModalProps) {
    const { t } = useTranslation();
    if (!group) return null;

    const tabData = group.tabs.map(t => ({ title: t.title, url: t.url }));
    const shareText = buildShareText(group.name, group.tabs.length, undefined, tabData, group.notes);

    const handleShare = (platform: SharePlatformId) => {
        openShareUrl(platform, shareText, bluetUrl);
        if (platform !== 'clipboard') {
            onClose();
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-sm">
                <DialogHeader>
                    <div className="flex flex-col items-center gap-3 pt-2">
                        <CheckCircle className="h-10 w-10 text-green-500" />
                        <DialogTitle className="text-center text-gray-900 dark:text-gray-100">
                            {isUpdate ? t('options.bluetShareSuccess.updated') : t('options.bluetShareSuccess.shared')}
                        </DialogTitle>
                    </div>
                </DialogHeader>

                <div className="flex flex-col gap-4 mt-2">
                    {/* Bluet URL */}
                    <a
                        href={bluetUrl}
                        onClick={(e) => {
                            e.preventDefault();
                            chrome.tabs.create({ url: bluetUrl, active: true });
                            onClose();
                        }}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-800 text-sm text-blue-600 dark:text-blue-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors truncate"
                    >
                        <ExternalLink className="w-4 h-4 flex-shrink-0" />
                        <span className="truncate"><bdi dir="ltr">{bluetUrl}</bdi></span>
                    </a>

                    {/* Share buttons */}
                    <div className="space-y-2">
                        <p className="text-sm text-gray-500 dark:text-gray-400 text-center">{t('options.bluetShareSuccess.shareTo')}</p>
                        <div className="grid grid-cols-2 gap-2">
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => handleShare('x')}
                                className="flex items-center gap-2"
                            >
                                <X className="w-4 h-4" />
                                X
                            </Button>
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => handleShare('whatsapp')}
                                className="flex items-center gap-2"
                            >
                                <MessageCircle className="w-4 h-4" />
                                WhatsApp
                            </Button>
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => handleShare('telegram')}
                                className="flex items-center gap-2"
                            >
                                <Send className="w-4 h-4" />
                                Telegram
                            </Button>
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => handleShare('email')}
                                className="flex items-center gap-2"
                            >
                                <Mail className="w-4 h-4" />
                                {t('auth.login.email')}
                            </Button>
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => handleShare('linkedin')}
                                className="flex items-center gap-2"
                            >
                                <Linkedin className="w-4 h-4" />
                                LinkedIn
                            </Button>
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => handleShare('reddit')}
                                className="flex items-center gap-2"
                            >
                                <MessageCircle className="w-4 h-4" />
                                Reddit
                            </Button>
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => handleShare('facebook')}
                                className="flex items-center gap-2"
                            >
                                <Globe2 className="w-4 h-4" />
                                Facebook
                            </Button>
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => handleShare('clipboard')}
                                className="flex items-center gap-2"
                            >
                                <Copy className="w-4 h-4" />
                                {t('options.bluetShareSuccess.copyLink')}
                            </Button>
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
