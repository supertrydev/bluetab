import React from 'react';
import '../styles/navbar/logo.css';

interface LogoProps {
    className?: string;
    size?: 'navbar' | 'header' | 'splash' | 'popup' | 'hero' | 'brand';
    variant?: 'auto' | 'light' | 'dark';
    animated?: boolean;
    withClearSpace?: boolean | 'comfortable' | 'generous';
}

const Logo: React.FC<LogoProps> = ({
    className = '',
    size = 'navbar',
    variant = 'auto',
    animated = false,
    withClearSpace = false
}) => {
    const sizeClasses = {
        navbar: 'logo-navbar',
        header: 'logo-header',
        splash: 'logo-splash',
        popup: 'logo-popup',
        hero: 'logo-hero',
        brand: 'logo-brand'
    };

    const getClearSpaceClass = () => {
        if (!withClearSpace) return '';
        if (withClearSpace === 'comfortable') return 'logo-with-clearspace comfortable';
        if (withClearSpace === 'generous') return 'logo-with-clearspace generous';
        return 'logo-with-clearspace';
    };

    const containerClasses = [
        'logo-container',
        getClearSpaceClass(),
        animated ? 'logo-animated' : '',
        className
    ].filter(Boolean).join(' ');

    const imageClasses = [
        'logo-image',
        sizeClasses[size]
    ].filter(Boolean).join(' ');

    if (variant === 'light') {
        return (
            <div className={containerClasses}>
                <img
                    src={new URL('../assets/logo-light.svg', import.meta.url).href}
                    alt="BlueTab"
                    className={imageClasses}
                />
            </div>
        );
    }

    if (variant === 'dark') {
        return (
            <div className={containerClasses}>
                <img
                    src={new URL('../assets/logo-dark.svg', import.meta.url).href}
                    alt="BlueTab"
                    className={imageClasses}
                />
            </div>
        );
    }

    return (
        <div className={containerClasses}>
            {/* Light mode logo */}
            <img
                src={new URL('../assets/logo-light.svg', import.meta.url).href}
                alt="BlueTab"
                className={`${imageClasses} logo-light`}
            />
            {/* Dark mode logo */}
            <img
                src={new URL('../assets/logo-dark.svg', import.meta.url).href}
                alt="BlueTab"
                className={`${imageClasses} logo-dark`}
            />
        </div>
    );
};

export default Logo;