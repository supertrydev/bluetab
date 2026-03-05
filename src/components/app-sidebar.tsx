import * as React from "react"
import {
    Layers,
    Settings2,
    User,
    Zap,
} from "lucide-react"

import { NavActions } from "@/components/nav-actions"
import { NavMain } from "@/components/nav-main"
import { NavProjects } from "@/components/nav-projects"
import { NavUser } from "@/components/nav-user"
import { TeamSwitcher } from "@/components/team-switcher"
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarHeader,
    SidebarRail,
} from "@/components/ui/sidebar"
import type { Project } from '../types/models'

export type ActivePage = "groups" | "flow" | "settings" | "account"

// Bluetab navigation data generator
const getNavData = (activePage: ActivePage, activeProjectId: string | null) => ({
    navMain: [
        {
            title: "Groups",
            url: "#groups",
            icon: Layers,
            isActive: activePage === "groups" && !activeProjectId,
            action: "groups",
        },
        {
            title: "Flow",
            url: "#flow",
            icon: Zap,
            isActive: activePage === "flow",
            action: "flow",
        },
        {
            title: "Settings",
            url: "#settings",
            icon: Settings2,
            isActive: activePage === "settings",
            action: "settings",
        },
        {
            title: "Account",
            url: "#account",
            icon: User,
            isActive: activePage === "account",
            action: "account",
        },
    ],
})

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
    onSaveAllTabs?: () => void
    activePage?: ActivePage
    onNavigateToGroups?: () => void
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
    activePage = "groups",
    onNavigateToGroups,
    projects = [],
    activeProjectId = null,
    onSelectProject = () => {},
    onCreateProject = () => {},
    onEditProject = () => {},
    onDeleteProject = () => {},
    ...props
}: AppSidebarProps) {
    const data = getNavData(activePage, activeProjectId)
    return (
        <Sidebar collapsible="icon" {...props}>
            <SidebarHeader>
                <TeamSwitcher />
            </SidebarHeader>
            <SidebarContent>
                <NavActions onSaveAllTabs={onSaveAllTabs} />
                <NavMain items={data.navMain} onNavigateToGroups={onNavigateToGroups} />
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
