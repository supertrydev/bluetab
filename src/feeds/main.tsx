import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppSidebar } from '../components/app-sidebar';
import {
    SidebarProvider,
    SidebarInset,
    SidebarTrigger,
} from '../components/ui/sidebar';
import { Separator } from '../components/ui/separator';
import { Toaster } from '@/components/Toast';
import { LocaleDirectionProvider } from '@/components/LocaleDirectionProvider';
import { initI18n, setDocumentTitle } from '@/i18n';
import { Storage } from '../utils/storage';
import { textSizeService } from '../utils/TextSizeService';
import { FeedsPage } from '../options/components/FeedsPage';
import type { ActivePage } from '../components/app-sidebar';
import type { Project } from '../types/models';
import { useDirection } from '@radix-ui/react-direction';
import '../styles/tailwind.css';
import '../styles/pin-indicators.css';
import '../styles/options-layout.css';

function FeedsStandalonePage() {
    const direction = useDirection();
    const [sidebarOpen, setSidebarOpen] = useState<boolean | null>(null);
    const [projects, setProjects] = useState<Project[]>([]);

    useEffect(() => {
        void Storage.getProjects().then(setProjects);
        Storage.get<boolean>('bluetab_sidebar_open').then((saved) => {
            setSidebarOpen(saved ?? true);
        });
    }, []);

    const handleSidebarOpenChange = (open: boolean) => {
        setSidebarOpen(open);
        void Storage.set('bluetab_sidebar_open', open);
    };

    const navigateToOptionsPage = (page: ActivePage = 'groups') => {
        if (page === 'groups') {
            window.location.href = chrome.runtime.getURL('src/options/index.html');
            return;
        }

        window.location.href = chrome.runtime.getURL(`src/options/index.html#${page}`);
    };

    const handleSelectProject = (projectId: string | null) => {
        if (projectId) {
            window.location.href = chrome.runtime.getURL(`src/options/index.html#project=${projectId}`);
            return;
        }

        navigateToOptionsPage('groups');
    };

    if (sidebarOpen === null) return null;

    return (
        <SidebarProvider open={sidebarOpen} onOpenChange={handleSidebarOpenChange}>
            <AppSidebar
                activePage="feeds"
                onNavigateToGroups={() => navigateToOptionsPage('groups')}
                onNavigate={(page) => {
                    if (page === 'feeds') return;
                    navigateToOptionsPage(page as ActivePage);
                }}
                projects={projects}
                onSelectProject={handleSelectProject}
                onCreateProject={() => {
                    window.location.href = chrome.runtime.getURL('src/options/index.html#action=create-project');
                }}
            />
            <SidebarInset>
                <div className="min-h-screen bg-background text-foreground">
                    <FeedsPage
                        sidebarTrigger={<><SidebarTrigger className="-ms-1" /><Separator orientation="vertical" className="me-2 h-4" /></>}
                    />
                    <Toaster richColors position={direction === 'rtl' ? 'bottom-left' : 'bottom-right'} />
                </div>
            </SidebarInset>
        </SidebarProvider>
    );
}

async function mountFeedsPage(): Promise<void> {
    await initI18n();
    setDocumentTitle('components.feeds.documentTitle');

    try {
        await textSizeService.initialize();
    } catch (error) {
        console.error('Failed to initialize text size service:', error);
    }

    const container = document.getElementById('root');
    if (!container) {
        return;
    }

    createRoot(container).render(
        <StrictMode>
            <LocaleDirectionProvider>
                <FeedsStandalonePage />
            </LocaleDirectionProvider>
        </StrictMode>
    );
}

void mountFeedsPage();
