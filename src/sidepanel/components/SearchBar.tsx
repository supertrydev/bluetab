import { Search, X } from 'lucide-react';
import { Input } from '../../components/ui/input';

interface SearchBarProps {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
}

export function SearchBar({ value, onChange, placeholder = 'Search tabs...' }: SearchBarProps) {
    const handleClear = () => {
        onChange('');
    };

    return (
        <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
                type="text"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                className="pl-8 pr-8 h-8 text-xs"
            />
            {value && (
                <button
                    onClick={handleClear}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-muted"
                >
                    <X className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
            )}
        </div>
    );
}
