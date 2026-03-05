import { toast as sonnerToast } from "sonner"

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ToastProps {
    id: string;
    message: string;
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

    show(message: string, type: ToastType = 'info', duration?: number) {
        const options = duration ? { duration } : undefined;

        switch (type) {
            case 'success':
                sonnerToast.success(message, options);
                break;
            case 'error':
                sonnerToast.error(message, options);
                break;
            case 'warning':
                sonnerToast.warning(message, options);
                break;
            case 'info':
                sonnerToast.info(message, options);
                break;
            default:
                sonnerToast(message, options);
        }
    }

    success(message: string, duration?: number) {
        this.show(message, 'success', duration);
    }

    error(message: string, duration?: number) {
        this.show(message, 'error', duration);
    }

    warning(message: string, duration?: number) {
        this.show(message, 'warning', duration);
    }

    info(message: string, duration?: number) {
        this.show(message, 'info', duration);
    }
}

// Legacy component for backward compatibility
export function Toast() {
    return null;
}

// Legacy component for backward compatibility
export function ToastContainer() {
    return null;
}
