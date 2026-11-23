import { matchesSearch, normalizeForSearch } from '@/utils/search-text';
import { StrictMode, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeManager } from '../utils/theme';
import { Storage } from '../utils/storage';
import { getDefaultSettings } from '../utils/sorting';
import type { Settings, TabGroup, Project } from '../types/models';
import { textSizeService } from '../utils/TextSizeService';
import { Toaster } from '@/components/Toast';
import { LocaleDirectionProvider } from '@/components/LocaleDirectionProvider';
import { getLanguageDirection, initI18n, setDocumentTitle } from '@/i18n';
import { AppSidebar } from '../components/app-sidebar';
import { SidebarProvider, SidebarInset, SidebarTrigger } from '../components/ui/sidebar';
import { Separator } from '../components/ui/separator';
import { AboutSettings } from './components/AboutSettings';
import { Info, Palette, Cloud, Timer, Shield, Sparkles, BarChart2, Bell, Rss, HardDrive, Settings2, Menu, Download, Search, X, Brain, BookMarked, Server, Plug2, StickyNote } from 'lucide-react';
import { useAuth } from '../components/auth/useAuth';
import { ThemeSettings } from './components/ThemeSettings';
import { TextSizeSettings } from './components/TextSizeSettings';
import { SyncSettingsSection } from './components/SyncSettingsSection';
import { GroupMenuSettings } from './components/GroupMenuSettings';
import { BackupSettings } from './components/BackupSettings';
import { PomodoroSettings } from './components/PomodoroSettings';
import { FocusSettings } from './components/FocusSettings';
import { AISettings } from './components/AISettings';
import { StatsSettings } from './components/StatsSettings';
import { ReminderSettings } from './components/ReminderSettings';
import { RSSNotificationSettings } from './components/RSSNotificationSettings';
import { SessionBackupSettings } from './components/SessionBackupSettings';
import { GeneralSettings } from './components/GeneralSettings';
import { ADHDSettings } from './components/ADHDSettings';
import { BrainDumpSettings } from './components/BrainDumpSettings';
import { ReadingsSettings } from './components/ReadingsSettings';
import { MCPServerSection } from './components/MCPServerSection';
import { IntegrationsSection } from './components/integrations/IntegrationsSection';
import { useSimplifyMode } from '@/hooks/useSimplifyMode';
import { ENABLE_READINGS } from '@/config/feature-flags';
import { useTranslation } from 'react-i18next';
import '../styles/tailwind.css';

function buildSettingsTabs(t: (key: string, options?: Record<string, unknown>) => string) {
    return [
        { id: 'appearance', label: t('settingsTabs.appearance'), icon: Palette, keywords: 'theme color dark light appearance gorunum text size font zoom' },
        { id: 'general', label: t('settingsTabs.general'), icon: Settings2, keywords: 'general genel tab restore pinned startup new tab context menu save url notes memory floating duplicate language dil archive auto-archive inactive arsiv time format clock 12 24 hour saat' },
        { id: 'pomodoro', label: t('settingsTabs.pomodoro'), icon: Timer, keywords: 'pomodoro timer focus work break session odak mola' },
        { id: 'focus', label: t('settingsTabs.focus'), icon: Shield, keywords: 'focus block distraction sites domain odak engel site' },
        { id: 'brain-dump', label: t('settingsTabs.brainDump'), icon: StickyNote, keywords: 'brain dump capture thought inbox shortcut quick note dusunce not' },
        { id: 'adhd', label: t('settingsTabs.adhd'), icon: Brain, keywords: 'adhd accessibility simplify visual time auto-suspend suspend calm focus dikkat' },
        ...(ENABLE_READINGS ? [{ id: 'readings', label: t('settingsTabs.readings'), icon: BookMarked, keywords: 'readings offline reading storage quota article cache clear okumalar' }] : []),
        { id: 'rss', label: t('settingsTabs.rss'), icon: Rss, keywords: 'rss feed notification sound category filter bildirim' },
        { id: 'reminders', label: t('settingsTabs.reminders'), icon: Bell, keywords: 'reminder notification alert hatirlatici bildirim' },
        { id: 'ai', label: t('settingsTabs.ai'), icon: Sparkles, keywords: 'ai assistant suggestion smart yapay zeka asistan' },
        { id: 'stats', label: t('settingsTabs.stats'), icon: BarChart2, keywords: 'statistics tracking usage analytics istatistik' },
        { id: 'group-menu', label: t('settingsTabs.groupMenu'), icon: Menu, keywords: 'group menu right click context grup menu' },
        { id: 'sync', label: t('settingsTabs.sync'), icon: Cloud, keywords: 'sync cloud backup device senkronizasyon bulut' },
        { id: 'mcp', label: t('settingsTabs.mcp'), icon: Server, keywords: 'mcp server client external ai agent tools' },
        { id: 'integrations', label: t('settingsTabs.integrations'), icon: Plug2, keywords: 'integrations entegrasyonlar notion linear todoist github calendar slack discord gitlab outlook readwise jira trello asana mirror auto-sync send to' },
        { id: 'backup-sessions', label: t('settingsTabs.backupSessions'), icon: HardDrive, keywords: 'session backup auto restore oturum yedegi' },
        { id: 'backup', label: t('settingsTabs.backup'), icon: Download, keywords: 'backup restore export import data yedek geri yukle' },
        { id: 'about', label: t('settingsTabs.about'), icon: Info, keywords: 'about hakkinda version info surum' },
    ] as const;
}

type SettingsTabId = ReturnType<typeof buildSettingsTabs>[number]['id'];

function SettingsPage() {
    const { t, i18n } = useTranslation();
    const direction = getLanguageDirection(i18n.resolvedLanguage ?? i18n.language);
    const translateTab = useCallback(
        (key: string, options?: Record<string, unknown>) => t(key as never, options as never) as unknown as string,
        [t],
    );
    // Phase 9 Plan 09-04 — Simplify Mode attribute wiring for Settings shell.
    useSimplifyMode();

    const { isPro } = useAuth();
    const settingsTabs = useMemo(() => buildSettingsTabs(translateTab), [translateTab]);
    const [settings, setSettings] = useState<Settings>(getDefaultSettings());
    const [groups, setGroups] = useState<TabGroup[]>([]);
    const [projects, setProjects] = useState<Project[]>([]);
    const [sidebarOpen, setSidebarOpen] = useState<boolean | null>(null);
    const [activeTab, setActiveTab] = useState<SettingsTabId>('appearance');
    const [searchQuery, setSearchQuery] = useState('');

    const sectionRefs = useRef<Map<string, HTMLDivElement>>(new Map());
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const contentCardRef = useRef<HTMLDivElement>(null);
    const isScrollingToRef = useRef(false);
    const scrollAnimationFrameRef = useRef<number | null>(null);
    const [sectionSearchIndex, setSectionSearchIndex] = useState<Record<string, string>>({});

    useEffect(() => {
        Storage.get<boolean>('bluetab_sidebar_open').then((saved) => {
            setSidebarOpen(saved ?? true);
        });
    }, []);

    useEffect(() => {
        initializeSettings();
        const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }) => {
            if (changes.groups) {
                setGroups(changes.groups.newValue || []);
            }
            if (changes.settings) {
                setSettings(changes.settings.newValue || getDefaultSettings());
            }
        };

        chrome.storage.onChanged.addListener(handleStorageChange);
        return () => chrome.storage.onChanged.removeListener(handleStorageChange);
    }, []);

    const initializeSettings = async () => {
        try {
            const storedSettings = await Storage.get<Partial<Settings>>('settings');
            const defaultSettings = getDefaultSettings();
            const mergedSettings = { ...defaultSettings, ...(storedSettings || {}) };
            const storedGroups = await Storage.get<TabGroup[]>('groups') || [];

            try { await textSizeService.initialize(); } catch (error) {
                console.error('Failed to initialize text size service:', error);
            }

            setSettings(mergedSettings);
            setGroups(storedGroups as TabGroup[]);
            setProjects(await Storage.getProjects());

            if (JSON.stringify(storedSettings) !== JSON.stringify(mergedSettings)) {
                await Storage.set('settings', mergedSettings);
            }
            ThemeManager.applyTheme(mergedSettings.theme);
        } catch (error) {
            console.error('Failed to load settings:', error);
        }
    };

    const handleSelectProject = (projectId: string | null) => {
        const base = chrome.runtime.getURL('src/options/index.html');
        window.location.href = projectId ? `${base}#project=${projectId}` : base;
    };

    const handleSidebarOpenChange = (open: boolean) => {
        setSidebarOpen(open);
        Storage.set('bluetab_sidebar_open', open);
    };

    const rebuildSectionSearchIndex = useCallback(() => {
        const nextIndex: Record<string, string> = {};

        settingsTabs.forEach((tab) => {
            const section = sectionRefs.current.get(tab.id);
            const textContent = normalizeForSearch(section?.textContent ?? '');
            nextIndex[tab.id] = textContent.replace(/\s+/g, ' ').trim();
        });

        setSectionSearchIndex((prev) => {
            const prevKeys = Object.keys(prev);
            const nextKeys = Object.keys(nextIndex);

            if (prevKeys.length === nextKeys.length && nextKeys.every((key) => prev[key] === nextIndex[key])) {
                return prev;
            }

            return nextIndex;
        });
    }, [settingsTabs]);

    // Scroll to section when tab clicked
    const scrollToSection = useCallback((tabId: string) => {
        const el = sectionRefs.current.get(tabId);
        const container = scrollContainerRef.current;
        if (!el || !container) return;

        if (scrollAnimationFrameRef.current !== null) {
            cancelAnimationFrame(scrollAnimationFrameRef.current);
            scrollAnimationFrameRef.current = null;
        }

        isScrollingToRef.current = true;
        setActiveTab(tabId as SettingsTabId);

        const containerRect = container.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        const startTop = container.scrollTop;
        const targetTop = startTop + elRect.top - containerRect.top;
        const distance = targetTop - startTop;
        const prefersReducedMotion = typeof window !== 'undefined'
            && typeof window.matchMedia === 'function'
            && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        if (prefersReducedMotion || Math.abs(distance) < 4) {
            container.scrollTop = targetTop;
            isScrollingToRef.current = false;
            return;
        }

        const durationMs = 320;
        const startTime = performance.now();
        const easeOutCubic = (progress: number) => 1 - Math.pow(1 - progress, 3);

        const animate = (now: number) => {
            const elapsed = now - startTime;
            const progress = Math.min(elapsed / durationMs, 1);
            container.scrollTop = startTop + (distance * easeOutCubic(progress));

            if (progress < 1) {
                scrollAnimationFrameRef.current = requestAnimationFrame(animate);
                return;
            }

            scrollAnimationFrameRef.current = null;
            isScrollingToRef.current = false;
        };

        scrollAnimationFrameRef.current = requestAnimationFrame(animate);
    }, []);

    const showSyncSetup = useCallback(() => {
        if (searchQuery) {
            setSearchQuery('');
            setTimeout(() => scrollToSection('sync'), 50);
            return;
        }
        scrollToSection('sync');
    }, [searchQuery, scrollToSection]);

    useEffect(() => {
        const hash = window.location.hash.replace(/^#/, '');
        if (!hash || !settingsTabs.some((tab) => tab.id === hash)) return;
        const timer = setTimeout(() => scrollToSection(hash), 150);
        return () => clearTimeout(timer);
    }, [scrollToSection, settingsTabs]);

    useEffect(() => {
        return () => {
            if (scrollAnimationFrameRef.current !== null) {
                cancelAnimationFrame(scrollAnimationFrameRef.current);
            }
        };
    }, []);

    // Scrollspy: use IntersectionObserver on the actual scroll container
    // Waits for refs to populate via a short delay after mount
    useEffect(() => {
        if (searchQuery) return;

        let observer: IntersectionObserver | null = null;

        const setup = () => {
            const container = scrollContainerRef.current;
            if (!container) return;

            observer = new IntersectionObserver(
                (entries) => {
                    if (isScrollingToRef.current) return;
                    // Find the entry closest to the top of the container that is intersecting
                    const visible = entries
                        .filter(e => e.isIntersecting)
                        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
                    if (visible.length > 0) {
                        const id = visible[0].target.getAttribute('data-section-id');
                        if (id) setActiveTab(id as SettingsTabId);
                    }
                },
                {
                    root: container,
                    rootMargin: '0px 0px -70% 0px',
                    threshold: 0,
                }
            );

            sectionRefs.current.forEach((el) => observer!.observe(el));
        };

        // Delay to ensure refs are populated after render
        const timer = setTimeout(setup, 100);

        return () => {
            clearTimeout(timer);
            observer?.disconnect();
        };
    }, [searchQuery]);

    useEffect(() => {
        const contentCard = contentCardRef.current;
        if (!contentCard) return;

        rebuildSectionSearchIndex();

        const observer = new MutationObserver(() => {
            rebuildSectionSearchIndex();
        });

        observer.observe(contentCard, {
            childList: true,
            subtree: true,
            characterData: true,
        });

        return () => observer.disconnect();
    }, [rebuildSectionSearchIndex]);

    // Filter tabs by search query
    const q = normalizeForSearch(searchQuery);
    const visibleTabs = q
        ? settingsTabs.filter(tab => {
            const indexedContent = sectionSearchIndex[tab.id] ?? '';
            return matchesSearch(tab.label, q)
                || matchesSearch(tab.keywords, q)
                || indexedContent.includes(q);
        })
        : settingsTabs;
    const visibleTabIds = new Set(visibleTabs.map((tab) => tab.id));

    const setSectionRef = useCallback((id: string, el: HTMLDivElement | null) => {
        if (el) sectionRefs.current.set(id, el);
        else sectionRefs.current.delete(id);
    }, []);

    const renderSection = (tabId: string) => {
        switch (tabId) {
            case 'appearance': return (
                <div className="space-y-8">
                    <ThemeSettings settings={settings} onSettingsChange={setSettings} />
                    <TextSizeSettings />
                </div>
            );
            case 'sync': return <SyncSettingsSection />;
            case 'mcp': return <MCPServerSection />;
            case 'integrations': return <IntegrationsSection onSetUpSync={showSyncSetup} />;
            case 'pomodoro': return <PomodoroSettings />;
            case 'focus': return <FocusSettings />;
            case 'brain-dump': return <BrainDumpSettings />;
            case 'adhd': return <ADHDSettings />;
            case 'readings': return ENABLE_READINGS ? <ReadingsSettings /> : null;
            case 'ai': return <AISettings />;
            case 'stats': return <StatsSettings />;
            case 'reminders': return <ReminderSettings />;
            case 'rss': return <RSSNotificationSettings />;
            case 'backup-sessions': return <SessionBackupSettings />;
            case 'general': return <GeneralSettings settings={settings} onSettingsChange={setSettings} />;
            case 'group-menu': return <GroupMenuSettings settings={settings} isPro={isPro} onSettingsChange={setSettings} />;
            case 'backup': return <BackupSettings settings={settings} groups={groups} onSettingsChange={setSettings} onGroupsChange={setGroups} />;
            case 'about': return <AboutSettings />;
            default: return null;
        }
    };

    if (sidebarOpen === null) return null;

    return (
        <SidebarProvider open={sidebarOpen} onOpenChange={handleSidebarOpenChange}>
            <AppSidebar
                activePage="settings"
                projects={projects}
                onSelectProject={handleSelectProject}
                onCreateProject={() => {
                    window.location.href = chrome.runtime.getURL('src/options/index.html#action=create-project');
                }}
            />
            <SidebarInset style={{ overflow: 'hidden', height: '100vh' }}>
                <header className="flex h-16 shrink-0 items-center gap-2 border-b border-border-glass px-4 bg-glass-bg">
                    <SidebarTrigger className="-ms-1" />
                    <Separator orientation="vertical" className="me-2 h-4" />
                    <div className="flex items-center gap-2">
                        <Settings2 className="h-5 w-5 text-primary" />
                        <div>
                            <h1 className="text-lg font-semibold text-text-strong">{t('settings.page.title')}</h1>
                            <p className="text-xs text-text-muted">{t('settings.page.description')}</p>
                        </div>
                    </div>
                </header>
                <div className="flex flex-col md:flex-row flex-1 bg-bg-0 min-h-0">
                    {/* Mobile: search + horizontal tab bar */}
                    <div className="md:hidden shrink-0 border-b border-border px-3 pt-2 pb-1 bg-bg-0">
                        <div className="relative mb-2">
                            <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                            <input
                                type="text"
                                dir="auto"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder={t('settings.page.searchPlaceholder')}
                                className="w-full h-8 ps-8 pe-8 text-xs rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                            {searchQuery && (
                                <button onClick={() => setSearchQuery('')} className="absolute end-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-muted">
                                    <X className="w-3 h-3 text-muted-foreground" />
                                </button>
                            )}
                        </div>
                        <div className="flex gap-1 overflow-x-auto scrollbar-transparent pb-1">
                            {(q ? visibleTabs : settingsTabs).map((tab) => {
                                const Icon = tab.icon;
                                const isActive = activeTab === tab.id;
                                return (
                                    <button
                                        key={tab.id}
                                        onClick={() => {
                                            if (q) { setSearchQuery(''); setTimeout(() => scrollToSection(tab.id), 50); }
                                            else scrollToSection(tab.id);
                                        }}
                                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                                            isActive && !q ? 'bg-primary/10 text-primary' : 'text-text-muted hover:text-text-strong hover:bg-bg-2'
                                        }`}
                                    >
                                        <Icon className="w-3.5 h-3.5 shrink-0" />
                                        {tab.label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div ref={scrollContainerRef} className="flex-1 min-h-0 overflow-y-auto scrollbar-transparent">
                        <div className="max-w-5xl mx-auto w-full flex gap-6 px-4 min-h-full">
                            {/* Desktop: inline-start tab navigation — fixed, never scrolls */}
                            <nav className="hidden md:block w-[220px] shrink-0 py-3 sticky top-0 self-start">
                            <div className="relative mb-3">
                                <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                                <input
                                    type="text"
                                    dir="auto"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder={t('settings.page.searchPlaceholder')}
                                    className="w-full h-8 ps-8 pe-8 text-xs rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                                />
                                {searchQuery && (
                                    <button onClick={() => setSearchQuery('')} className="absolute end-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-muted">
                                        <X className="w-3 h-3 text-muted-foreground" />
                                    </button>
                                )}
                            </div>

                            <div className="flex flex-col gap-0.5">
                                {(q ? visibleTabs : settingsTabs).map((tab) => {
                                    const Icon = tab.icon;
                                    const isActive = activeTab === tab.id;
                                    return (
                                        <button
                                            key={tab.id}
                                            onClick={() => {
                                                if (q) { setSearchQuery(''); setTimeout(() => scrollToSection(tab.id), 50); }
                                                else scrollToSection(tab.id);
                                            }}
                                            className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-start w-full ${
                                                isActive && !q ? 'bg-primary/10 text-primary' : 'text-text-muted hover:text-text-strong hover:bg-bg-2'
                                            }`}
                                        >
                                            <Icon className="w-4 h-4 shrink-0" />
                                            {tab.label}
                                        </button>
                                    );
                                })}
                                {q && visibleTabs.length === 0 && (
                                    <p className="text-xs text-muted-foreground px-3 py-4 text-center">{t('settings.page.noResults')}</p>
                                )}
                            </div>
                        </nav>

                            {/* Content area */}
                            <div className="flex-1 min-w-0 min-h-0 py-3 pb-[50vh]">
                                <div ref={contentCardRef} className="space-y-4">
                                    {settingsTabs.map((tab) => {
                                        const isVisible = !q || visibleTabIds.has(tab.id);
                                        return (
                                            <div
                                                key={tab.id}
                                                ref={(el) => setSectionRef(tab.id, el)}
                                                data-section-id={tab.id}
                                                hidden={!isVisible}
                                                className="scroll-mt-[5rem] rounded-lg border border-border bg-bg-1 p-4 shadow-sm sm:p-6 [&>*:first-child]:border-t-0 [&>*:first-child]:pt-0"
                                            >
                                                {renderSection(tab.id)}
                                            </div>
                                        );
                                    })}
                                    {q && visibleTabs.length === 0 && (
                                        <div className="rounded-lg border border-border bg-bg-1 p-6 text-center text-sm text-muted-foreground shadow-sm">
                                            {t('settings.page.noResults')}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <Toaster richColors position={direction === 'rtl' ? 'bottom-left' : 'bottom-right'} />
            </SidebarInset>
        </SidebarProvider>
    );
}

async function mountSettingsPage(): Promise<void> {
    await initI18n();
    setDocumentTitle('document.settingsTitle');

    const container = document.getElementById('root');
    if (!container) {
        return;
    }

    const root = createRoot(container);
    root.render(
        <StrictMode>
            <LocaleDirectionProvider>
                <SettingsPage />
            </LocaleDirectionProvider>
        </StrictMode>
    );
}

void mountSettingsPage();
