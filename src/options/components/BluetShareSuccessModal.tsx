import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
    CheckCircle, Copy, ExternalLink, Mail,
} from 'lucide-react';
import { ShareBrandIcon } from '@/components/icons/ShareBrandIcon';
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
                        <CheckCircle className="h-10 w-10 text-success" />
                        <DialogTitle className="text-center text-text-strong">
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
                        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted text-sm text-primary hover:bg-accent transition-colors truncate"
                    >
                        <ExternalLink className="w-4 h-4 flex-shrink-0" />
                        <span className="truncate"><bdi dir="ltr">{bluetUrl}</bdi></span>
                    </a>

                    {/* Share buttons */}
                    <div className="space-y-2">
                        <p className="text-sm text-text-muted text-center">{t('options.bluetShareSuccess.shareTo')}</p>
                        <div className="grid grid-cols-2 gap-2">
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => handleShare('x')}
                                className="flex items-center gap-2"
                            >
                                <ShareBrandIcon id="x" className="w-4 h-4" />
                                X
                            </Button>
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => handleShare('whatsapp')}
                                className="flex items-center gap-2"
                            >
                                <ShareBrandIcon id="whatsapp" className="w-4 h-4" />
                                WhatsApp
                            </Button>
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => handleShare('telegram')}
                                className="flex items-center gap-2"
                            >
                                <ShareBrandIcon id="telegram" className="w-4 h-4" />
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
                                <ShareBrandIcon id="linkedin" className="w-4 h-4" />
                                LinkedIn
                            </Button>
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => handleShare('reddit')}
                                className="flex items-center gap-2"
                            >
                                <ShareBrandIcon id="reddit" className="w-4 h-4" />
                                Reddit
                            </Button>
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => handleShare('facebook')}
                                className="flex items-center gap-2"
                            >
                                <ShareBrandIcon id="facebook" className="w-4 h-4" />
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
