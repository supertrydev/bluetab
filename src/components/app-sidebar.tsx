import * as React from "react"
import {
    BarChart2,
    BookMarked,
    Gift,
    HelpCircle,
    Layers,
    Rss,
    Settings2,
    User,
    Zap,
} from "lucide-react"

import { NavActions } from "@/components/nav-actions"
import { NavMain } from "@/components/nav-main"
import { NavProjects } from "@/components/nav-projects"
import { NavUser } from "@/components/nav-user"
import { TeamSwitcher } from "@/components/team-switcher"
import { ENABLE_READINGS, ENABLE_WRAPPED } from "@/config/feature-flags"
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarHeader,
    SidebarRail,
} from "@/components/ui/sidebar"
import type { Project } from '../types/models'
import { useTranslation } from 'react-i18next'
import { useDirection } from '@radix-ui/react-direction'

export type ActivePage = "groups" | "flow" | "settings" | "account" | "statistics" | "help" | "feeds" | "wrapped" | "offline-reading"

// Bluetab navigation data generator
const getNavData = (
    activePage: ActivePage,
    activeProjectId: string | null,
    wrappedBadgeVisible: boolean,
    t: (key: string) => string,
) => ({
    navMain: [
        {
            title: t('settings.backup.groups'),
            url: "#groups",
            icon: Layers,
            isActive: activePage === "groups" && !activeProjectId,
            action: "groups",
            badgeActive: false,
        },
        {
            title: t('flow.page.title'),
            url: "#flow",
            icon: Zap,
            isActive: activePage === "flow",
            action: "flow",
            badgeActive: false,
        },
        {
            title: t('options.feedsPage.title'),
            url: "#feeds",
            icon: Rss,
            isActive: activePage === "feeds",
            action: "feeds",
            badgeActive: false,
        },
        ...(ENABLE_READINGS ? [{
            title: t('settingsTabs.readings'),
            url: "#offline-reading",
            icon: BookMarked,
            isActive: activePage === "offline-reading",
            action: "offline-reading",
            badgeActive: false,
        }] : []),
        {
            title: t('settings.page.title'),
            url: "#settings",
            icon: Settings2,
            isActive: activePage === "settings",
            action: "settings",
            badgeActive: false,
        },
        {
            title: t('options.stats.title'),
            url: "#statistics",
            icon: BarChart2,
            isActive: activePage === "statistics",
            action: "statistics",
            badgeActive: false,
        },
        ...(ENABLE_WRAPPED ? [{
            title: t('components.navigation.wrapped'),
            url: "#",
            icon: Gift,
            isActive: false,
            action: "wrapped",
            badgeActive: wrappedBadgeVisible,
        }] : []),
        {
            title: t('components.navigation.help'),
            url: "#help",
            icon: HelpCircle,
            isActive: activePage === "help",
            action: "help",
            badgeActive: false,
        },
        {
            title: t('auth.account.title'),
            url: "#account",
            icon: User,
            isActive: activePage === "account",
            action: "account",
            badgeActive: false,
        },
    ],
})

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
    onSaveAllTabs?: () => void
    onSaveSuspendedTabs?: () => void
    onOrganizeGroups?: () => void
    activePage?: ActivePage
    onNavigateToGroups?: () => void
    onNavigate?: (page: string) => void
    onWrappedClick?: () => void
    wrappedBadgeVisible?: boolean
    // Project props
    projects?: Project[]
    activeProjectId?: string | null
    onSelectProject?: (projectId: string | null) => void
    onCreateProject?: () => void
    onEditProject?: (project: Project) => void
    onDeleteProject?: (projectId: string) => void
}

export function AppSidebar({
    onSaveAllTabs,
    onSaveSuspendedTabs,
    onOrganizeGroups,
    activePage = "groups",
    onNavigateToGroups,
    onNavigate,
    onWrappedClick,
    wrappedBadgeVisible = false,
    projects = [],
    activeProjectId = null,
    onSelectProject = () => {},
    onCreateProject = () => {},
    onEditProject = () => {},
    onDeleteProject = () => {},
    side,
    ...props
}: AppSidebarProps) {
    const { t } = useTranslation();
    const direction = useDirection();
    const translate = (key: string) => t(key as never) as unknown as string;
    const data = getNavData(activePage, activeProjectId, wrappedBadgeVisible, translate)
    return (
        <Sidebar
            collapsible="icon"
            side={side ?? (direction === 'rtl' ? 'right' : 'left')}
            {...props}
        >
            <SidebarHeader>
                <TeamSwitcher />
            </SidebarHeader>
            <SidebarContent>
                <NavActions
                    onSaveAllTabs={onSaveAllTabs}
                    onSaveSuspendedTabs={onSaveSuspendedTabs}
                    onOrganizeGroups={onOrganizeGroups}
                />
                <NavMain
                    items={data.navMain}
                    onNavigateToGroups={onNavigateToGroups}
                    onNavigate={onNavigate}
                    onWrappedClick={onWrappedClick}
                />
                <NavProjects
                    projects={projects}
                    activeProjectId={activeProjectId}
                    onSelectProject={onSelectProject}
                    onCreateProject={onCreateProject}
                    onEditProject={onEditProject}
                    onDeleteProject={onDeleteProject}
                />
            </SidebarContent>
            <SidebarFooter>
                <NavUser />
            </SidebarFooter>
            <SidebarRail />
        </Sidebar>
    )
}
