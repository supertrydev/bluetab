import React, { useState, useEffect, useRef } from 'react';

interface PasswordInputProps {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    id?: string;
    name?: string;
    className?: string;
    disabled?: boolean;
    autoFocus?: boolean;
    required?: boolean;
    showStrengthMeter?: boolean;
    showToggleVisibility?: boolean;
    minLength?: number;
    maxLength?: number;
    onValidationChange?: (isValid: boolean, errors: string[]) => void;
}

interface PasswordStrength {
    score: number;
    label: string;
    color: string;
    suggestions: string[];
}

export function PasswordInput({
    value,
    onChange,
    placeholder = "Enter password",
    id,
    name,
    className = "",
    disabled = false,
    autoFocus = false,
    required = false,
    showStrengthMeter = true,
    showToggleVisibility = true,
    minLength = 8,
    maxLength = 128,
    onValidationChange
}: PasswordInputProps) {
    const [isVisible, setIsVisible] = useState(false);
    const [isFocused, setIsFocused] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    // Clear password from memory when component unmounts
    useEffect(() => {
        return () => {
            if (inputRef.current) {
                inputRef.current.value = '';
            }
        };
    }, []);

    const getPasswordStrength = (password: string): PasswordStrength => {
        if (!password) {
            return {
                score: 0,
                label: 'No password',
                color: 'gray',
                suggestions: ['Enter a password']
            };
        }

        let score = 0;
        const suggestions: string[] = [];

        // Length check
        if (password.length >= minLength) {
            score++;
        } else {
            suggestions.push(`Use at least ${minLength} characters`);
        }

        if (password.length >= 12) {
            score++;
        } else if (password.length >= minLength) {
            suggestions.push('Use 12+ characters for better security');
        }

        // Character type checks
        if (/[a-z]/.test(password)) {
            score++;
        } else {
            suggestions.push('Add lowercase letters');
        }

        if (/[A-Z]/.test(password)) {
            score++;
        } else {
            suggestions.push('Add uppercase letters');
        }

        if (/[0-9]/.test(password)) {
            score++;
        } else {
            suggestions.push('Add numbers');
        }

        if (/[^A-Za-z0-9]/.test(password)) {
            score++;
        } else {
            suggestions.push('Add special characters (!@#$%^&*)');
        }

        // Common password patterns (reduce score)
        const commonPatterns = [
            /(.)\1{2,}/, // Repeated characters
            /123|abc|qwe|asd/i, // Sequential patterns
            /password|123456|admin/i // Common words
        ];

        for (const pattern of commonPatterns) {
            if (pattern.test(password)) {
                score = Math.max(0, score - 1);
                suggestions.push('Avoid common patterns and words');
                break;
            }
        }

        // Determine strength level
        if (score <= 2) {
            return { score, label: 'Weak', color: 'red', suggestions };
        } else if (score <= 4) {
            return { score, label: 'Medium', color: 'yellow', suggestions };
        } else {
            return { score, label: 'Strong', color: 'green', suggestions: [] };
        }
    };

    const validatePassword = (password: string): { isValid: boolean; errors: string[] } => {
        const errors: string[] = [];

        if (required && !password) {
            errors.push('Password is required');
        }

        if (password && password.length < minLength) {
            errors.push(`Password must be at least ${minLength} characters`);
        }

        if (password && password.length > maxLength) {
            errors.push(`Password must be no more than ${maxLength} characters`);
        }

        const isValid = errors.length === 0;
        return { isValid, errors };
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newValue = e.target.value;
        onChange(newValue);

        // Validate and notify parent component
        if (onValidationChange) {
            const validation = validatePassword(newValue);
            onValidationChange(validation.isValid, validation.errors);
        }
    };

    const toggleVisibility = () => {
        setIsVisible(!isVisible);
    };

    const passwordStrength = getPasswordStrength(value);
    const validation = validatePassword(value);

    const baseInputClasses = `
        w-full pr-10 px-3 py-2 text-sm border rounded-md transition-colors
        bg-bg-1
        text-gray-900 dark:text-gray-100
        focus:ring-2 focus:ring-blue-500 focus:border-blue-500
        disabled:bg-gray-100 dark:disabled:bg-gray-700 disabled:cursor-not-allowed
        ${validation.errors.length > 0 && value
            ? 'border-red-300 dark:border-red-600'
            : 'border-gray-300 dark:border-gray-600'
        }
    `;

    return (
        <div className="password-input-container">
            {/* Main Input Field */}
            <div className="relative">
                <input
                    ref={inputRef}
                    type={isVisible ? 'text' : 'password'}
                    value={value}
                    onChange={handleChange}
                    onFocus={() => setIsFocused(true)}
                    onBlur={() => setIsFocused(false)}
                    placeholder={placeholder}
                    id={id}
                    name={name}
                    className={`${baseInputClasses} ${className}`.trim()}
                    disabled={disabled}
                    autoFocus={autoFocus}
                    required={required}
                    minLength={minLength}
                    maxLength={maxLength}
                    autoComplete="new-password"
                    spellCheck={false}
                />

                {/* Toggle Visibility Button */}
                {showToggleVisibility && (
                    <button
                        type="button"
                        onClick={toggleVisibility}
                        className="absolute right-3 top-1/2 transform -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                        title={isVisible ? 'Hide password' : 'Show password'}
                        tabIndex={-1}
                    >
                        <i className={`fas ${isVisible ? 'fa-eye-slash' : 'fa-eye'} text-sm`}></i>
                    </button>
                )}
            </div>

            {/* Password Strength Meter */}
            {showStrengthMeter && value && (isFocused || passwordStrength.score > 0) && (
                <div className="mt-2 space-y-2">
                    {/* Strength Bar */}
                    <div className="flex items-center gap-2">
                        <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                            <div
                                className={`h-2 rounded-full transition-all duration-300 ${
                                    passwordStrength.color === 'red' ? 'bg-red-500' :
                                    passwordStrength.color === 'yellow' ? 'bg-yellow-500' :
                                    passwordStrength.color === 'green' ? 'bg-green-500' :
                                    'bg-gray-400'
                                }`}
                                style={{ width: `${(passwordStrength.score / 6) * 100}%` }}
                            />
                        </div>
                        <span className={`text-xs font-medium ${
                            passwordStrength.color === 'red' ? 'text-red-600 dark:text-red-400' :
                            passwordStrength.color === 'yellow' ? 'text-yellow-600 dark:text-yellow-400' :
                            passwordStrength.color === 'green' ? 'text-green-600 dark:text-green-400' :
                            'text-gray-600 dark:text-gray-400'
                        }`}>
                            {passwordStrength.label}
                        </span>
                    </div>

                    {/* Suggestions */}
                    {passwordStrength.suggestions.length > 0 && (
                        <div className="space-y-1">
                            {passwordStrength.suggestions.slice(0, 3).map((suggestion, index) => (
                                <div key={index} className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                                    <i className="fas fa-circle text-xs opacity-50"></i>
                                    <span>{suggestion}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Validation Errors */}
            {validation.errors.length > 0 && value && (
                <div className="mt-1 space-y-1">
                    {validation.errors.map((error, index) => (
                        <p key={index} className="text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
                            <i className="fas fa-exclamation-circle text-xs"></i>
                            {error}
                        </p>
                    ))}
                </div>
            )}

            {/* Security Recommendations */}
            {isFocused && !value && (
                <div className="mt-2 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                    <div className="text-sm text-blue-800 dark:text-blue-200 space-y-1">
                        <div className="font-medium mb-2">Password Security Tips:</div>
                        <div className="text-xs space-y-1">
                            <div>• Use at least {minLength} characters</div>
                            <div>• Mix uppercase and lowercase letters</div>
                            <div>• Include numbers and special characters</div>
                            <div>• Avoid common words and patterns</div>
                            <div>• Consider using a passphrase</div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}