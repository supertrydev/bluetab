import { useRef, useEffect } from 'react';
import { Search, X } from 'lucide-react';
import { Input } from '../../components/ui/input';
import { useTranslation } from 'react-i18next';

interface SearchBarProps {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    autoFocus?: boolean;
    ariaLabel?: string;
    clearLabel?: string;
}

export function SearchBar({
    value,
    onChange,
    placeholder,
    autoFocus,
    ariaLabel,
    clearLabel,
}: SearchBarProps) {
    const { t } = useTranslation();
    const resolvedPlaceholder = placeholder ?? t('popup.searchPlaceholder');
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (autoFocus) {
            const timer = setTimeout(() => inputRef.current?.focus(), 50);
            return () => clearTimeout(timer);
        }
    }, [autoFocus]);

    const handleClear = () => {
        onChange('');
    };

    return (
        <div className="relative">
            <Search aria-hidden="true" className="absolute start-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
                ref={inputRef}
                type="text"
                dir="auto"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={resolvedPlaceholder}
                aria-label={ariaLabel ?? resolvedPlaceholder}
                className="ps-8 pe-8 h-9 text-sm"
            />
            {value && (
                <button
                    type="button"
                    onClick={handleClear}
                    aria-label={clearLabel ?? t('options.feedsPage.clearSearch')}
                    className="absolute end-2 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-full hover:bg-accent"
                >
                    <X className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
            )}
        </div>
    );
}
