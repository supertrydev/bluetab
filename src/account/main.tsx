import { StrictMode, useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { AppSidebar } from '../components/app-sidebar';
import {
    SidebarProvider,
    SidebarInset,
    SidebarTrigger,
} from '../components/ui/sidebar';
import { Separator } from '../components/ui/separator';
import { User } from 'lucide-react';
import { AccountSection } from '../components/auth/AccountSection';
import { Toaster } from '@/components/Toast';
import { LocaleDirectionProvider } from '@/components/LocaleDirectionProvider';
import { initI18n, setDocumentTitle } from '@/i18n';
import { Storage } from '../utils/storage';
import { textSizeService } from '../utils/TextSizeService';
import { useTranslation } from 'react-i18next';
import { useDirection } from '@radix-ui/react-direction';
import type { Project } from '../types/models';
import '../styles/tailwind.css';

function AccountPage() {
    const { t } = useTranslation();
    const direction = useDirection();
    const [sidebarOpen, setSidebarOpen] = useState<boolean | null>(null);
    const [projects, setProjects] = useState<Project[]>([]);

    useEffect(() => {
        loadProjects();
        Storage.get<boolean>('bluetab_sidebar_open').then((saved) => {
            setSidebarOpen(saved ?? true);
        });
    }, []);

    const loadProjects = async () => {
        const storedProjects = await Storage.getProjects();
        setProjects(storedProjects);
    };

    // Save sidebar state to chrome.storage.local
    const handleSidebarOpenChange = (open: boolean) => {
        setSidebarOpen(open);
        Storage.set('bluetab_sidebar_open', open);
    };

    // Navigate to options page with project filter
    const handleSelectProject = (projectId: string | null) => {
        if (projectId) {
            window.location.href = chrome.runtime.getURL(`src/options/index.html#project=${projectId}`);
        } else {
            window.location.href = chrome.runtime.getURL('src/options/index.html');
        }
    };

    if (sidebarOpen === null) return null;

    return (
        <SidebarProvider open={sidebarOpen} onOpenChange={handleSidebarOpenChange}>
            <AppSidebar
                activePage="account"
                projects={projects}
                onSelectProject={handleSelectProject}
                onCreateProject={() => {
                    window.location.href = chrome.runtime.getURL('src/options/index.html#action=create-project');
                }}
            />
            <SidebarInset>
                <header className="sticky top-0 z-50 flex h-16 shrink-0 items-center gap-2 border-b border-border-glass px-4 bg-glass-bg backdrop-blur-md">
                    <SidebarTrigger className="-ms-1" />
                    <Separator orientation="vertical" className="me-2 h-4" />
                    <div className="flex items-center gap-2">
                        <User className="h-5 w-5 text-primary" />
                        <div>
                            <h1 className="text-lg font-semibold text-text-strong">{t('auth.account.title')}</h1>
                            <p className="text-xs text-text-muted">{t('components.account.subtitle')}</p>
                        </div>
                    </div>
                </header>
                <div className="flex flex-1 flex-col gap-4 p-4 bg-bg-0">
                    <div className="max-w-2xl mx-auto w-full">
                        <AccountSection />
                    </div>
                </div>
                <Toaster richColors position={direction === 'rtl' ? 'bottom-left' : 'bottom-right'} />
            </SidebarInset>
        </SidebarProvider>
    );
}

async function mountAccountPage(): Promise<void> {
    await initI18n();
    setDocumentTitle('document.accountTitle');

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
                <AccountPage />
            </LocaleDirectionProvider>
        </StrictMode>
    );
}

void mountAccountPage();
