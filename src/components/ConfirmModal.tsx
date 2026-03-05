import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { AlertCircle, AlertTriangle, Info } from "lucide-react"

interface ConfirmModalProps {
    isOpen: boolean;
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    onConfirm: () => void;
    onCancel: () => void;
    type?: 'danger' | 'warning' | 'info';
}

export function ConfirmModal({
    isOpen,
    title,
    message,
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    onConfirm,
    onCancel,
    type = 'danger'
}: ConfirmModalProps) {
    const getTypeConfig = () => {
        switch (type) {
            case 'danger':
                return {
                    Icon: AlertCircle,
                    iconColor: 'text-red-500',
                    variant: 'danger' as const
                };
            case 'warning':
                return {
                    Icon: AlertTriangle,
                    iconColor: 'text-yellow-500',
                    variant: 'primary' as const
                };
            case 'info':
                return {
                    Icon: Info,
                    iconColor: 'text-blue-500',
                    variant: 'primary' as const
                };
            default:
                return {
                    Icon: Info,
                    iconColor: 'text-gray-500',
                    variant: 'primary' as const
                };
        }
    };

    const { Icon, iconColor, variant } = getTypeConfig();

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onCancel()}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <div className="flex items-start gap-4">
                        <div className={`flex-shrink-0 ${iconColor}`}>
                            <Icon className="h-6 w-6" />
                        </div>
                        <div className="flex-1 min-w-0 space-y-2">
                            <DialogTitle className="text-gray-900 dark:text-gray-100">{title}</DialogTitle>
                            <DialogDescription className="text-sm leading-relaxed text-gray-700 dark:text-gray-300">
                                {message}
                            </DialogDescription>
                        </div>
                    </div>
                </DialogHeader>
                <DialogFooter className="flex flex-col-reverse sm:flex-row justify-end gap-2 sm:gap-3 mt-6">
                    <Button
                        type="button"
                        variant="secondary"
                        onClick={onCancel}
                        className="w-full sm:w-auto"
                    >
                        {cancelText}
                    </Button>
                    <Button
                        type="button"
                        variant={variant}
                        onClick={onConfirm}
                        className="w-full sm:w-auto"
                    >
                        {confirmText}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
