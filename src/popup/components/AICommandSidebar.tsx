import { useState } from 'react';
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface AICommandSidebarProps {
    isOpen: boolean;
    onClose: () => void;
}

export function AICommandSidebar({ isOpen, onClose }: AICommandSidebarProps) {
    const [command, setCommand] = useState('');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!command.trim()) return;

        // TODO: AI command processing will be implemented here
        console.log('AI Command:', command);
        setCommand('');
    };

    const exampleCommands = [
        {
            command: 'Archive all tabs older than 7 days',
            icon: 'fa-archive',
        },
        {
            command: 'Group tabs by domain',
            icon: 'fa-layer-group',
        },
        {
            command: 'Delete duplicate tabs',
            icon: 'fa-clone',
        },
        {
            command: 'Create group from selected tabs',
            icon: 'fa-plus-circle',
        },
    ];

    return (
        <Sheet open={isOpen} onOpenChange={onClose}>
            <SheetContent side="right" className="w-80 sm:max-w-md">
                <SheetHeader>
                    <SheetTitle className="flex items-center gap-2">
                        <i className="fas fa-robot text-blue-600 dark:text-blue-400"></i>
                        AI Command
                    </SheetTitle>
                    <SheetDescription>
                        Use AI to manage your tabs efficiently
                    </SheetDescription>
                </SheetHeader>

                <div className="mt-6 space-y-4">
                    {/* Command Input */}
                    <form onSubmit={handleSubmit} className="space-y-3">
                        <div>
                            <Input
                                type="text"
                                value={command}
                                onChange={(e) => setCommand(e.target.value)}
                                placeholder="Type a command..."
                                className="w-full"
                                autoFocus
                            />
                        </div>
                        <Button type="submit" className="w-full" disabled={!command.trim()}>
                            <i className="fas fa-paper-plane mr-2"></i>
                            Execute Command
                        </Button>
                    </form>

                    {/* Example Commands */}
                    <div className="space-y-2">
                        <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">
                            Example Commands
                        </h3>
                        <div className="space-y-2">
                            {exampleCommands.map((example, index) => (
                                <button
                                    key={index}
                                    onClick={() => setCommand(example.command)}
                                    className="w-full text-left p-3 rounded-lg border border-border hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                                >
                                    <div className="flex items-start gap-2">
                                        <i className={`fas ${example.icon} text-blue-600 dark:text-blue-400 mt-1`}></i>
                                        <span className="text-sm text-gray-700 dark:text-gray-300">
                                            {example.command}
                                        </span>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Info Box */}
                    <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                        <div className="flex items-start gap-2">
                            <i className="fas fa-info-circle text-blue-600 dark:text-blue-400 mt-0.5"></i>
                            <div className="text-xs text-blue-700 dark:text-blue-300">
                                <p className="font-medium mb-1">Coming Soon</p>
                                <p>AI command processing will be available in the next update.</p>
                            </div>
                        </div>
                    </div>
                </div>
            </SheetContent>
        </Sheet>
    );
}
