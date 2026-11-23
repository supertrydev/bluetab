import { useEffect, useState } from 'react';
import { Toaster as SonnerToaster, toast as sonnerToast, type ExternalToast } from 'sonner';
import { t } from '@/i18n';
import { DEFAULT_SUPPORT_SETTINGS, getSupportSettings, SUPPORT_SETTINGS_KEY } from '@/utils/support-settings';

export type ToastType = 'success' | 'error' | 'info' | 'warning';
export type FeedbackVisibility = 'user' | 'diagnostic';

export interface TranslationMessageInput {
    key: string;
    fallback?: string;
    values?: Record<string, unknown>;
}

export type ToastMessageInput = string | TranslationMessageInput;

export interface FeedbackOptions extends ExternalToast {
    visibility?: FeedbackVisibility;
}

let diagnosticsVisible = DEFAULT_SUPPORT_SETTINGS.showDiagnostics;

void getSupportSettings().then((settings) => {
    diagnosticsVisible = settings.showDiagnostics;
});

try {
    chrome.storage?.onChanged?.addListener((changes) => {
        if (changes[SUPPORT_SETTINGS_KEY]) {
            diagnosticsVisible = Boolean(changes[SUPPORT_SETTINGS_KEY].newValue?.showDiagnostics);
        }
    });
} catch {
    // Tests and non-extension contexts can skip storage listeners.
}

function canShow(visibility: FeedbackVisibility = 'user'): boolean {
    return visibility === 'user' || diagnosticsVisible;
}

function resolveMessage(message: ToastMessageInput): string {
    if (typeof message === 'string') {
        return message;
    }

    const translated = t(message.key, message.values);
    if (translated && translated !== message.key) {
        return translated;
    }
    return message.fallback ?? message.key;
}

function withVisibility<T extends FeedbackOptions | undefined>(options: T): ExternalToast | undefined {
    if (!options) return undefined;
    const { visibility: _visibility, ...rest } = options;
    return rest;
}

function showToast(
    type: ToastType | 'message' | 'loading',
    message: ToastMessageInput,
    options?: FeedbackOptions,
) {
    if (!canShow(options?.visibility)) {
        return undefined;
    }

    const resolved = resolveMessage(message);
    const sonnerOptions = withVisibility(options);

    switch (type) {
        case 'success':
            return sonnerToast.success(resolved, sonnerOptions);
        case 'error':
            return sonnerToast.error(resolved, sonnerOptions);
        case 'warning':
            return sonnerToast.warning(resolved, sonnerOptions);
        case 'info':
            return sonnerToast.info(resolved, sonnerOptions);
        case 'loading':
            return sonnerToast.loading(resolved, sonnerOptions);
        case 'message':
        default:
            return sonnerToast.message(resolved, sonnerOptions);
    }
}

export interface ToastProps {
    id: string;
    message: ToastMessageInput;
    type: ToastType;
    duration?: number;
    onClose: (id: string) => void;
}

export interface ToastManagerState {
    toasts: (ToastProps & { id: string })[];
}

export class ToastManager {
    private static instance: ToastManager;

    static getInstance(): ToastManager {
        if (!ToastManager.instance) {
            ToastManager.instance = new ToastManager();
        }
        return ToastManager.instance;
    }

    show(message: ToastMessageInput, type: ToastType = 'info', duration?: number, options?: FeedbackOptions) {
        const mergedOptions = duration ? { ...options, duration } : options;
        return showToast(type, message, mergedOptions);
    }

    undo(message: ToastMessageInput, receipt: { expiresAt: number; undo: () => Promise<boolean> }) {
        return sonnerToast.custom(id => <UndoToast id={id} message={message} receipt={receipt} />, {
            duration: Infinity,
        });
    }

    success(message: ToastMessageInput, duration?: number, options?: FeedbackOptions) {
        return this.show(message, 'success', duration, options);
    }

    error(message: ToastMessageInput, duration?: number, options?: FeedbackOptions) {
        return this.show(message, 'error', duration, options);
    }

    warning(message: ToastMessageInput, duration?: number, options?: FeedbackOptions) {
        return this.show(message, 'warning', duration, options);
    }

    info(message: ToastMessageInput, duration?: number, options?: FeedbackOptions) {
        return this.show(message, 'info', duration, options);
    }
}

export const toast = {
    success(message: ToastMessageInput, options?: FeedbackOptions) {
        return showToast('success', message, options);
    },
    error(message: ToastMessageInput, options?: FeedbackOptions) {
        return showToast('error', message, options);
    },
    warning(message: ToastMessageInput, options?: FeedbackOptions) {
        return showToast('warning', message, options);
    },
    info(message: ToastMessageInput, options?: FeedbackOptions) {
        return showToast('info', message, options);
    },
    message(message: ToastMessageInput, options?: FeedbackOptions) {
        return showToast('message', message, options);
    },
    loading(message: ToastMessageInput, options?: FeedbackOptions) {
        return showToast('loading', message, options);
    },
    dismiss(id?: string | number) {
        return sonnerToast.dismiss(id);
    },
};

export const Toaster = SonnerToaster;

// Legacy component for backward compatibility
export function Toast() {
    return null;
}

// Legacy component for backward compatibility
export function ToastContainer() {
    return null;
}

function UndoToast({ id, message, receipt }: {
    id: string | number;
    message: ToastMessageInput;
    receipt: { expiresAt: number; undo: () => Promise<boolean> };
}) {
    const [remaining, setRemaining] = useState(Math.max(0, Math.ceil((receipt.expiresAt - Date.now()) / 1000)));
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        const tick = () => {
            const seconds = Math.max(0, Math.ceil((receipt.expiresAt - Date.now()) / 1000));
            setRemaining(seconds);
            if (seconds === 0) sonnerToast.dismiss(id);
        };
        const interval = setInterval(tick, 250);
        tick();
        return () => clearInterval(interval);
    }, [id, receipt.expiresAt]);
    return <div role="status" className="flex items-center gap-3 rounded-lg border border-border bg-bg-1 p-4 text-sm text-foreground shadow-lg">
        <span>{resolveMessage(message)}</span>
        <button className="font-medium text-primary" disabled={busy || remaining === 0} onClick={async () => {
            setBusy(true);
            try {
                await receipt.undo();
                sonnerToast.dismiss(id);
            } catch {
                setBusy(false);
                toast.error({ key: 'dataSafety.undoFailed' });
            }
        }}>{t('dataSafety.undo')}</button>
        <span className="text-xs text-muted-foreground">{t('dataSafety.seconds', { count: remaining })}</span>
    </div>;
}
