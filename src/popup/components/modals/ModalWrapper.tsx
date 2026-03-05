import React, { useEffect, ReactNode } from 'react';

interface ModalWrapperProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    subtitle?: string;
    size?: 'sm' | 'md' | 'lg' | 'xl';
    children: ReactNode;
    showCloseButton?: boolean;
}

export function ModalWrapper({
    isOpen,
    onClose,
    title,
    subtitle,
    size = 'md',
    children,
    showCloseButton = true
}: ModalWrapperProps) {
    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            }
        };

        if (isOpen) {
            document.addEventListener('keydown', handleEscape);
            document.body.style.overflow = 'hidden';
        }

        return () => {
            document.removeEventListener('keydown', handleEscape);
            document.body.style.overflow = 'unset';
        };
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    const getSizeClasses = () => {
        switch (size) {
            case 'sm':
                return 'max-w-sm';
            case 'md':
                return 'max-w-md';
            case 'lg':
                return 'max-w-lg';
            case 'xl':
                return 'max-w-xl';
            default:
                return 'max-w-md';
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/50 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* Modal */}
            <div className={`relative bg-bg-1 rounded-xl shadow-xl ${getSizeClasses()} w-full max-h-[90vh] flex flex-col animate-in zoom-in-95 duration-200`}>
                {/* Header */}
                <div className="flex items-start justify-between p-4 border-b border-border flex-shrink-0">
                    <div>
                        <h3 className="text-lg font-semibold text-text-strong">
                            {title}
                        </h3>
                        {subtitle && (
                            <p className="text-sm text-text-muted mt-0.5">
                                {subtitle}
                            </p>
                        )}
                    </div>
                    {showCloseButton && (
                        <button
                            onClick={onClose}
                            className="p-1.5 hover:bg-bg-2 rounded-lg transition-colors ml-4"
                            title="Close"
                        >
                            <i className="fas fa-times text-text-muted"></i>
                        </button>
                    )}
                </div>

                {/* Content - Scrollable with transparent scrollbar */}
                <div className="p-4 overflow-y-auto flex-1 scrollbar-transparent">
                    {children}
                </div>
            </div>
        </div>
    );
}

// Hook for modal state management
export function useModal(initialState = false) {
    const [isOpen, setIsOpen] = React.useState(initialState);

    const openModal = () => setIsOpen(true);
    const closeModal = () => setIsOpen(false);
    const toggleModal = () => setIsOpen(!isOpen);

    return {
        isOpen,
        openModal,
        closeModal,
        toggleModal
    };
}