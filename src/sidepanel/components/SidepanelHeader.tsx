import React from 'react';
import Logo from '../../components/Logo';
import { Button } from '../../components/ui/button';
import { SquaresExclude, LayoutDashboard } from 'lucide-react';

interface SidepanelHeaderProps {
    onSaveAllTabs: () => void;
    onOpenManager: () => void;
}

export const SidepanelHeader: React.FC<SidepanelHeaderProps> = ({
    onSaveAllTabs,
    onOpenManager,
}) => {
    return (
        <div className="flex flex-col items-center gap-1.5 pb-4">
            <div className="h-20 overflow-hidden flex items-end justify-center -mb-1">
                <Logo
                    size="splash"
                    variant="auto"
                    withClearSpace={false}
                    animated={true}
                />
            </div>
            <div className="flex gap-3 w-full justify-center">
                <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5 h-6 text-xs text-muted-foreground hover:text-primary px-2"
                    onClick={onSaveAllTabs}
                >
                    <SquaresExclude className="w-3 h-3" />
                    Save Current Tabs
                </Button>
                <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5 h-6 text-xs text-muted-foreground hover:text-primary px-2"
                    onClick={onOpenManager}
                >
                    <LayoutDashboard className="w-3 h-3" />
                    Open Manager
                </Button>
            </div>
        </div>
    );
};
