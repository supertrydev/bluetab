import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GROUP_MEMORY_NOTICE_EVENT, GROUP_MEMORY_NOTICE_MS } from '@/services/group-memory-notice';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

export function GroupMemoryNotice() {
    const { t } = useTranslation();
    const [deadline, setDeadline] = useState<number | null>(null);
    const [seconds, setSeconds] = useState(30);
    useEffect(() => {
        const show = () => {
            setSeconds(30);
            setDeadline(Date.now() + GROUP_MEMORY_NOTICE_MS);
        };
        window.addEventListener(GROUP_MEMORY_NOTICE_EVENT, show);
        return () => window.removeEventListener(GROUP_MEMORY_NOTICE_EVENT, show);
    }, []);
    useEffect(() => {
        if (deadline === null) return;
        const tick = () => {
            const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
            setSeconds(remaining);
            if (remaining === 0) setDeadline(null);
        };
        const interval = setInterval(tick, 250);
        return () => clearInterval(interval);
    }, [deadline]);
    return <Dialog open={deadline !== null} onOpenChange={open => { if (!open) setDeadline(null); }}>
        <DialogContent className="max-w-sm">
            <DialogHeader>
                <DialogTitle>{t('dataSafety.memoryNoticeTitle')}</DialogTitle>
                <DialogDescription>{t('dataSafety.memoryNoticeBody')}</DialogDescription>
            </DialogHeader>
            <p className="text-xs text-muted-foreground">{t('dataSafety.closesIn', { count: seconds })}</p>
        </DialogContent>
    </Dialog>;
}
