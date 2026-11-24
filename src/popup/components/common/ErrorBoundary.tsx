import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, AlertCircle, Info, X } from 'lucide-react';
import { ToastManager } from '@/components/Toast';
import { t as translate } from '@/i18n';

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
    onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
    hasError: boolean;
    error: Error | null;
    errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = {
            hasError: false,
            error: null,
            errorInfo: null
        };
    }

    static getDerivedStateFromError(error: Error): State {
        return {
            hasError: true,
            error,
            errorInfo: null
        };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        this.setState({
            error,
            errorInfo
        });

        // Log error to console for debugging
        console.error('ErrorBoundary caught an error:', error, errorInfo);

        // Call custom error handler if provided
        if (this.props.onError) {
            this.props.onError(error, errorInfo);
        }
    }

    handleRetry = () => {
        this.setState({
            hasError: false,
            error: null,
            errorInfo: null
        });
    };

    render() {
        if (this.state.hasError) {
            // Custom fallback UI
            if (this.props.fallback) {
                return this.props.fallback;
            }

            // Default error UI
            return (
                <div className="error-boundary-container bg-danger-muted border border-danger/30 rounded-lg p-6 m-4">
                    <div className="flex items-start gap-3">
                        <AlertTriangle className="w-5 h-5 text-danger mt-1 flex-shrink-0" />
                        <div className="flex-1">
                            <h3 className="text-lg font-semibold text-danger mb-2">
                                {translate('popup.errorBoundary.somethingWentWrong')}
                            </h3>
                            <p className="text-sm text-danger mb-4">
                                {translate('popup.errorBoundary.unexpectedArchiveError')}
                            </p>

                            {/* Error Details (collapsed by default) */}
                            <details className="mb-4">
                                <summary className="text-sm text-danger cursor-pointer hover:underline">
                                    {translate('popup.errorBoundary.showTechnicalDetails')}
                                </summary>
                                <div className="mt-2 p-3 bg-danger-muted border border-danger/30 rounded text-xs font-mono text-danger overflow-auto max-h-40">
                                    <div className="font-semibold mb-2">{translate('popup.errorBoundary.errorLabel')}</div>
                                    <div className="mb-3">{this.state.error?.toString()}</div>

                                    {this.state.errorInfo && (
                                        <>
                                            <div className="font-semibold mb-2">{translate('popup.errorBoundary.componentStack')}</div>
                                            <div className="whitespace-pre-wrap">{this.state.errorInfo.componentStack}</div>
                                        </>
                                    )}
                                </div>
                            </details>

                            {/* Action Buttons */}
                            <div className="flex gap-3">
                                <button
                                    onClick={this.handleRetry}
                                    className="px-4 py-2 bg-danger text-white rounded-full hover:bg-danger transition-colors text-sm font-medium"
                                >
                                    {translate('popup.errorBoundary.tryAgain')}
                                </button>
                                <button
                                    onClick={() => window.location.reload()}
                                    className="px-4 py-2 bg-muted text-text-strong rounded-full hover:bg-accent transition-colors text-sm font-medium"
                                >
                                    {translate('popup.errorBoundary.reloadPage')}
                                </button>
                                <button
                                    onClick={() => {
                                        // Copy error details to clipboard
                                        const errorText = `Error: ${this.state.error?.toString()}\n\nStack: ${this.state.error?.stack}\n\nComponent Stack: ${this.state.errorInfo?.componentStack}`;
                                        navigator.clipboard?.writeText(errorText).then(() => {
                                            ToastManager.getInstance().success({ key: 'feedback.copiedErrorDetails' });
                                        });
                                    }}
                                    className="px-4 py-2 bg-primary text-white rounded-full hover:bg-primary-hover transition-colors text-sm font-medium"
                                >
                                    {translate('popup.errorBoundary.copyError')}
                                </button>
                            </div>

                            {/* Support Information */}
                            <div className="mt-4 pt-4 border-t border-danger/30">
                                <p className="text-xs text-danger">
                                    {translate('popup.errorBoundary.reportPrefix')}{' '}
                                    <a
                                        href="https://github.com/anthropics/claude-code/issues"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="underline hover:no-underline"
                                    >
                                        {translate('popup.errorBoundary.githubIssues')}
                                    </a>.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

// Error Toast Component for runtime errors
interface ErrorToastProps {
    error: string;
    onDismiss: () => void;
    onRetry?: () => void;
    autoHide?: boolean;
    duration?: number;
}

export function ErrorToast({
    error,
    onDismiss,
    onRetry,
    autoHide = true,
    duration = 5000
}: ErrorToastProps) {
    React.useEffect(() => {
        if (autoHide) {
            const timer = setTimeout(onDismiss, duration);
            return () => clearTimeout(timer);
        }
    }, [autoHide, duration, onDismiss]);

    return (
        <div className="fixed bottom-4 end-4 z-50 max-w-sm bg-danger text-white rounded-lg shadow-lg animate-in slide-in-from-bottom-2 duration-300">
            <div className="p-4">
                <div className="flex items-start gap-3">
                    <AlertCircle className="w-4 h-4 text-white flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium mb-1">{translate('popup.errorBoundary.errorShort')}</div>
                        <div dir="auto" className="text-sm opacity-90">{error}</div>
                    </div>
                    <button
                        onClick={onDismiss}
                        className="text-white/70 hover:text-white transition-colors p-1"
                    >
                        <X className="w-3.5 h-3.5" />
                    </button>
                </div>

                {onRetry && (
                    <div className="mt-3 flex gap-2">
                        <button
                            onClick={onRetry}
                            className="px-3 py-1 bg-white/20 hover:bg-white/30 rounded-full text-sm font-medium transition-colors"
                        >
                            {translate('popup.errorBoundary.retry')}
                        </button>
                        <button
                            onClick={onDismiss}
                            className="px-3 py-1 bg-white/10 hover:bg-white/20 rounded-full text-sm transition-colors"
                        >
                            {translate('popup.errorBoundary.dismiss')}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

// Hook for managing error states
export function useErrorHandler() {
    const [error, setError] = React.useState<string | null>(null);

    const handleError = React.useCallback((error: Error | string) => {
        const errorMessage = error instanceof Error ? error.message : error;
        setError(errorMessage);
        console.error('Error handled:', error);
    }, []);

    const clearError = React.useCallback(() => {
        setError(null);
    }, []);

    const retryOperation = React.useCallback((operation: () => Promise<void> | void) => {
        return async () => {
            try {
                clearError();
                await operation();
            } catch (error) {
                handleError(error instanceof Error ? error : new Error(String(error)));
            }
        };
    }, [handleError, clearError]);

    return {
        error,
        handleError,
        clearError,
        retryOperation,
        hasError: !!error
    };
}

// Generic Error Message Component
interface ErrorMessageProps {
    title?: string;
    message: string;
    onRetry?: () => void;
    onDismiss?: () => void;
    type?: 'error' | 'warning' | 'info';
    className?: string;
}

export function ErrorMessage({
    title = 'Error',
    message,
    onRetry,
    onDismiss,
    type = 'error',
    className = ''
}: ErrorMessageProps) {
    const getTypeStyles = () => {
        switch (type) {
            case 'warning':
                return {
                    container: 'bg-warning-muted border-warning/30',
                    iconElement: <AlertTriangle className="w-4 h-4 text-warning flex-shrink-0" />,
                    text: 'text-warning',
                    button: 'bg-warning hover:bg-warning'
                };
            case 'info':
                return {
                    container: 'bg-primary-muted border-primary/30',
                    iconElement: <Info className="w-4 h-4 text-primary flex-shrink-0" />,
                    text: 'text-primary',
                    button: 'bg-primary hover:bg-primary-hover'
                };
            default:
                return {
                    container: 'bg-danger-muted border-danger/30',
                    iconElement: <AlertCircle className="w-4 h-4 text-danger flex-shrink-0" />,
                    text: 'text-danger',
                    button: 'bg-danger hover:bg-danger'
                };
        }
    };

    const styles = getTypeStyles();

    return (
        <div className={`border rounded-lg p-4 ${styles.container} ${className}`}>
            <div className="flex items-start gap-3">
                {styles.iconElement}
                <div className="flex-1">
                    <h4 dir="auto" className={`font-medium mb-1 ${styles.text}`}>{title}</h4>
                    <p dir="auto" className={`text-sm ${styles.text}`}>{message}</p>

                    {(onRetry || onDismiss) && (
                        <div className="mt-3 flex gap-2">
                            {onRetry && (
                                <button
                                    onClick={onRetry}
                                    className={`px-3 py-1 text-white rounded text-sm font-medium transition-colors ${styles.button}`}
                                >
                                    {translate('popup.errorBoundary.tryAgain')}
                                </button>
                            )}
                            {onDismiss && (
                                <button
                                    onClick={onDismiss}
                                    className="px-3 py-1 bg-muted hover:bg-accent text-text-strong rounded-full text-sm font-medium transition-colors"
                                >
                                    {translate('popup.errorBoundary.dismiss')}
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
