import { StrictMode, useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeManager } from '../utils/theme';
import { Storage } from '../utils/storage';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import { TabsPanel } from './components/TabsPanel';
import { SidepanelHeader } from './components/SidepanelHeader';
import { GroupsPanel } from './components/GroupsPanel';
import { PanelTop, Layers, Sparkles } from 'lucide-react';
import '../styles/pin-indicators.css';
import '../styles/tailwind.css';

const SIDEPANEL_TAB_KEY = 'sidepanelActiveTab';

function SidePanel() {
    const [activeTab, setActiveTab] = useState<string>('tabs');

    // Load persisted tab on mount
    useEffect(() => {
        const loadActiveTab = async () => {
            const savedTab = await Storage.get<string>(SIDEPANEL_TAB_KEY);
            if (savedTab) {
                setActiveTab(savedTab);
            }
        };
        loadActiveTab();
    }, []);

    // Listen for theme changes from settings
    useEffect(() => {
        const listener = (changes: { [key: string]: chrome.storage.StorageChange }) => {
            if (changes.settings) {
                const newSettings = changes.settings.newValue;
                if (newSettings?.theme) {
                    ThemeManager.applyTheme(newSettings.theme);
                }
            }
        };
        chrome.storage.local.onChanged.addListener(listener);
        return () => chrome.storage.local.onChanged.removeListener(listener);
    }, []);

    // Save tab when it changes
    const handleTabChange = async (value: string) => {
        setActiveTab(value);
        await Storage.set(SIDEPANEL_TAB_KEY, value);
    };

    const handleSaveAllTabs = async () => {
        try {
            const tabs = await chrome.tabs.query({ currentWindow: true });
            const tabItems = tabs
                .filter((t) => t.url && !t.url.startsWith('chrome://') && !t.url.startsWith('chrome-extension://'))
                .map((t) => ({
                    id: crypto.randomUUID(),
                    url: t.url || '',
                    title: t.title || t.url || '',
                    favIconUrl: t.favIconUrl || '',
                }));

            if (tabItems.length === 0) return;

            const { tabGroups = [] } = await chrome.storage.local.get('tabGroups');
            const newGroup = {
                id: crypto.randomUUID(),
                name: `Saved ${new Date().toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`,
                tabs: tabItems,
                createdAt: Date.now(),
                updatedAt: Date.now(),
            };
            await chrome.storage.local.set({ tabGroups: [newGroup, ...tabGroups] });
        } catch (err) {
            console.error('Failed to save tabs:', err);
        }
    };

    const handleOpenManager = () => {
        chrome.runtime.sendMessage({ type: 'OPEN_BLUETAB_PAGE', page: 'options' });
    };

    return (
        <div className="h-screen bg-background text-foreground flex flex-col overflow-hidden">
            {/* Header with Logo + Actions + Tabs */}
            <div className="sticky top-0 z-10 bg-background border-b border-border px-3 py-2">
                <SidepanelHeader
                    onSaveAllTabs={handleSaveAllTabs}
                    onOpenManager={handleOpenManager}
                />
                <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
                    <TabsList className="w-full">
                        <TabsTrigger value="tabs" className="flex-1 gap-1.5">
                            <PanelTop className="w-4 h-4" />
                            <span>Tabs</span>
                        </TabsTrigger>
                        <TabsTrigger value="groups" className="flex-1 gap-1.5">
                            <Layers className="w-4 h-4" />
                            <span>Groups</span>
                        </TabsTrigger>
                        <TabsTrigger value="ai" className="flex-1 gap-1.5">
                            <Sparkles className="w-4 h-4" />
                            <span>AI</span>
                        </TabsTrigger>
                    </TabsList>
                </Tabs>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-hidden">
                <Tabs value={activeTab} className="h-full">
                    <TabsContent value="tabs" className="mt-0 h-full p-2">
                        <TabsPanel />
                    </TabsContent>
                    <TabsContent value="groups" className="mt-0 h-full">
                        <GroupsPanel />
                    </TabsContent>
                    <TabsContent value="ai" className="mt-0 h-full p-4">
                        <div className="flex flex-col items-center justify-center h-64 space-y-4">
                            <Sparkles className="w-12 h-12 text-muted-foreground" />
                            <p className="text-sm text-muted-foreground">AI features coming soon</p>
                        </div>
                    </TabsContent>
                </Tabs>
            </div>
        </div>
    );
}

// Initialize theme
ThemeManager.initializeTheme();

const root = document.getElementById('root');
if (root) {
    createRoot(root).render(
        <StrictMode>
            <SidePanel />
        </StrictMode>
    );
}
