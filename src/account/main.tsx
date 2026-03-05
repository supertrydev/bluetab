import { StrictMode, useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { AppSidebar } from '../components/app-sidebar';
import {
    SidebarProvider,
    SidebarInset,
    SidebarTrigger,
} from '../components/ui/sidebar';
import { Separator } from '../components/ui/separator';
import { AccountSection } from '../components/auth/AccountSection';
import { Toaster } from 'sonner';
import { Storage } from '../utils/storage';
import type { Project } from '../types/models';
import '../styles/tailwind.css';

function AccountPage() {
    const [sidebarOpen, setSidebarOpen] = useState(() => {
        const saved = localStorage.getItem('bluetab_sidebar_open');
        return saved !== null ? saved === 'true' : true;
    });
    const [projects, setProjects] = useState<Project[]>([]);

    useEffect(() => {
        loadProjects();
    }, []);

    const loadProjects = async () => {
        const storedProjects = await Storage.getProjects();
        setProjects(storedProjects);
    };

    const handleSidebarOpenChange = (open: boolean) => {
        setSidebarOpen(open);
        localStorage.setItem('bluetab_sidebar_open', String(open));
    };

    // Navigate to options page with project filter
    const handleSelectProject = (projectId: string | null) => {
        if (projectId) {
            window.location.href = chrome.runtime.getURL(`src/options/index.html#project=${projectId}`);
        } else {
            window.location.href = chrome.runtime.getURL('src/options/index.html');
        }
    };

    return (
        <SidebarProvider open={sidebarOpen} onOpenChange={handleSidebarOpenChange}>
            <AppSidebar
                activePage="account"
                projects={projects}
                onSelectProject={handleSelectProject}
            />
            <SidebarInset>
                <header className="flex h-16 shrink-0 items-center gap-2 border-b border-border px-4 bg-bg-1">
                    <SidebarTrigger className="-ml-1" />
                    <Separator orientation="vertical" className="mr-2 h-4" />
                    <div>
                        <h1 className="text-lg font-semibold text-text-strong">Account</h1>
                        <p className="text-xs text-text-muted">Manage your account and subscription</p>
                    </div>
                </header>
                <div className="flex flex-1 flex-col gap-4 p-4 bg-bg-0">
                    <div className="max-w-2xl mx-auto w-full">
                        <AccountSection />
                    </div>
                </div>
                <Toaster richColors position="bottom-right" />
            </SidebarInset>
        </SidebarProvider>
    );
}

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(
    <StrictMode>
        <AccountPage />
    </StrictMode>
);
