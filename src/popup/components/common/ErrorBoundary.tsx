import React, { Component, ErrorInfo, ReactNode } from 'react';

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
                <div className="error-boundary-container bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-6 m-4">
                    <div className="flex items-start gap-3">
                        <i className="fas fa-exclamation-triangle text-red-500 text-xl mt-1"></i>
                        <div className="flex-1">
                            <h3 className="text-lg font-semibold text-red-800 dark:text-red-200 mb-2">
                                Something went wrong
                            </h3>
                            <p className="text-sm text-red-700 dark:text-red-300 mb-4">
                                An unexpected error occurred while using the archive feature.
                                This might be a temporary issue.
                            </p>

                            {/* Error Details (collapsed by default) */}
                            <details className="mb-4">
                                <summary className="text-sm text-red-600 dark:text-red-400 cursor-pointer hover:underline">
                                    Show technical details
                                </summary>
                                <div className="mt-2 p-3 bg-red-100 dark:bg-red-900/30 border border-red-200 dark:border-red-700 rounded text-xs font-mono text-red-800 dark:text-red-200 overflow-auto max-h-40">
                                    <div className="font-semibold mb-2">Error:</div>
                                    <div className="mb-3">{this.state.error?.toString()}</div>

                                    {this.state.errorInfo && (
                                        <>
                                            <div className="font-semibold mb-2">Component Stack:</div>
                                            <div className="whitespace-pre-wrap">{this.state.errorInfo.componentStack}</div>
                                        </>
                                    )}
                                </div>
                            </details>

                            {/* Action Buttons */}
                            <div className="flex gap-3">
                                <button
                                    onClick={this.handleRetry}
                                    className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm font-medium"
                                >
                                    Try Again
                                </button>
                                <button
                                    onClick={() => window.location.reload()}
                                    className="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors text-sm font-medium"
                                >
                                    Reload Page
                                </button>
                                <button
                                    onClick={() => {
                                        // Copy error details to clipboard
                                        const errorText = `Error: ${this.state.error?.toString()}\n\nStack: ${this.state.error?.stack}\n\nComponent Stack: ${this.state.errorInfo?.componentStack}`;
                                        navigator.clipboard?.writeText(errorText).then(() => {
                                            alert('Error details copied to clipboard');
                                        });
                                    }}
                                    className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors text-sm font-medium"
                                >
                                    Copy Error
                                </button>
                            </div>

                            {/* Support Information */}
                            <div className="mt-4 pt-4 border-t border-red-200 dark:border-red-700">
                                <p className="text-xs text-red-600 dark:text-red-400">
                                    If this problem persists, please report it at{' '}
                                    <a
                                        href="https://github.com/anthropics/claude-code/issues"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="underline hover:no-underline"
                                    >
                                        our GitHub issues page
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
        <div className="fixed bottom-4 right-4 z-50 max-w-sm bg-red-600 text-white rounded-lg shadow-lg animate-in slide-in-from-bottom-2 duration-300">
            <div className="p-4">
                <div className="flex items-start gap-3">
                    <i className="fas fa-exclamation-circle text-white flex-shrink-0 mt-0.5"></i>
                    <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium mb-1">Error</div>
                        <div className="text-sm opacity-90">{error}</div>
                    </div>
                    <button
                        onClick={onDismiss}
                        className="text-white/70 hover:text-white transition-colors p-1"
                    >
                        <i className="fas fa-times text-sm"></i>
                    </button>
                </div>

                {onRetry && (
                    <div className="mt-3 flex gap-2">
                        <button
                            onClick={onRetry}
                            className="px-3 py-1 bg-white/20 hover:bg-white/30 rounded text-sm font-medium transition-colors"
                        >
                            Retry
                        </button>
                        <button
                            onClick={onDismiss}
                            className="px-3 py-1 bg-white/10 hover:bg-white/20 rounded text-sm transition-colors"
                        >
                            Dismiss
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
                    container: 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800',
                    icon: 'fas fa-exclamation-triangle text-yellow-500',
                    text: 'text-yellow-800 dark:text-yellow-200',
                    button: 'bg-yellow-600 hover:bg-yellow-700'
                };
            case 'info':
                return {
                    container: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',
                    icon: 'fas fa-info-circle text-blue-500',
                    text: 'text-blue-800 dark:text-blue-200',
                    button: 'bg-blue-600 hover:bg-blue-700'
                };
            default:
                return {
                    container: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',
                    icon: 'fas fa-exclamation-circle text-red-500',
                    text: 'text-red-800 dark:text-red-200',
                    button: 'bg-red-600 hover:bg-red-700'
                };
        }
    };

    const styles = getTypeStyles();

    return (
        <div className={`border rounded-lg p-4 ${styles.container} ${className}`}>
            <div className="flex items-start gap-3">
                <i className={styles.icon}></i>
                <div className="flex-1">
                    <h4 className={`font-medium mb-1 ${styles.text}`}>{title}</h4>
                    <p className={`text-sm ${styles.text}`}>{message}</p>

                    {(onRetry || onDismiss) && (
                        <div className="mt-3 flex gap-2">
                            {onRetry && (
                                <button
                                    onClick={onRetry}
                                    className={`px-3 py-1 text-white rounded text-sm font-medium transition-colors ${styles.button}`}
                                >
                                    Try Again
                                </button>
                            )}
                            {onDismiss && (
                                <button
                                    onClick={onDismiss}
                                    className="px-3 py-1 bg-gray-500 hover:bg-gray-600 text-white rounded text-sm font-medium transition-colors"
                                >
                                    Dismiss
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}