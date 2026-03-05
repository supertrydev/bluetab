import { useState, useEffect } from "react"
import {
    MoreHorizontal,
    Pencil,
    Trash2,
    Plus,
    Share2,
    type LucideIcon,
} from "lucide-react"

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
    SidebarGroup,
    SidebarGroupLabel,
    SidebarMenu,
    SidebarMenuAction,
    SidebarMenuButton,
    SidebarMenuItem,
    useSidebar,
} from "@/components/ui/sidebar"
import { PROJECT_COLORS, type Project, type ProjectIcon } from '../types/models'
import { PROJECT_ICONS } from './ProjectModal'
import { useAuth } from './auth/useAuth'
import { BluetBridgeService } from '../services/bluet-bridge-service'
import { ToastManager } from './Toast'
import type { BluetSharedRef } from '../types/bluet'

interface NavProjectsProps {
    projects: Project[];
    activeProjectId: string | null;
    onSelectProject: (projectId: string | null) => void;
    onCreateProject: () => void;
    onEditProject: (project: Project) => void;
    onDeleteProject: (projectId: string) => void;
}

export function NavProjects({
    projects,
    activeProjectId,
    onSelectProject,
    onCreateProject,
    onEditProject,
    onDeleteProject,
}: NavProjectsProps) {
    const { isMobile } = useSidebar()
    const { isPro } = useAuth()
    const [sharedRefs, setSharedRefs] = useState<BluetSharedRef[]>([])

    useEffect(() => {
        BluetBridgeService.getSharedRefs().then(setSharedRefs)
    }, [])

    const handleShareProject = async (project: Project) => {
        if (!isPro) return

        const connected = await BluetBridgeService.isConnected()
        if (!connected) {
            ToastManager.getInstance().info('Connect to Bluet first in Account settings')
            return
        }

        const groups = await (await import('../utils/storage')).Storage.get<import('../types/models').TabGroup[]>('groups') || []
        const isAlreadyShared = sharedRefs.some(r => r.id === project.id)
        const result = await BluetBridgeService.shareProject(project, groups)

        if (result.success) {
            const url = result.fullUrl || result.pageUrl || ''
            ToastManager.getInstance().success(
                isAlreadyShared
                    ? `Updated on Bluet: ${url}`
                    : `Shared to Bluet: ${url}`
            )
            if (result.fullUrl) {
                chrome.tabs.create({ url: result.fullUrl })
            }
            setSharedRefs(await BluetBridgeService.getSharedRefs())
        } else {
            ToastManager.getInstance().error(`Share failed: ${result.error}`)
        }
    }

    const sharedProjectIds = sharedRefs.filter(r => r.type === 'project').map(r => r.id)

    return (
        <SidebarGroup className="group-data-[collapsible=icon]:hidden">
            <SidebarGroupLabel className="flex items-center justify-between pr-2">
                <span>Projects</span>
                <button
                    onClick={onCreateProject}
                    className="p-1 rounded hover:bg-sidebar-accent transition-colors"
                    title="New Project"
                >
                    <Plus className="w-4 h-4" />
                </button>
            </SidebarGroupLabel>
            <SidebarMenu>
                {/* Project list */}
                {projects.map((project) => {
                    const IconComponent = PROJECT_ICONS[project.icon] || PROJECT_ICONS.folder;
                    const isActive = activeProjectId === project.id;

                    return (
                        <SidebarMenuItem key={project.id}>
                            <SidebarMenuButton
                                onClick={() => onSelectProject(isActive ? null : project.id)}
                                className={isActive ? 'bg-sidebar-accent' : ''}
                            >
                                <IconComponent
                                    className="w-4 h-4"
                                    style={{ color: PROJECT_COLORS[project.color] }}
                                />
                                <span>{project.name}</span>
                            </SidebarMenuButton>
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <SidebarMenuAction showOnHover>
                                        <MoreHorizontal />
                                        <span className="sr-only">More</span>
                                    </SidebarMenuAction>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent
                                    className="w-48 rounded-lg"
                                    side={isMobile ? "bottom" : "right"}
                                    align={isMobile ? "end" : "start"}
                                >
                                    <DropdownMenuItem onClick={() => onEditProject(project)}>
                                        <Pencil className="text-muted-foreground" />
                                        <span>Edit Project</span>
                                    </DropdownMenuItem>
                                    {isPro && (
                                        <DropdownMenuItem onClick={() => handleShareProject(project)}>
                                            <Share2 className="text-muted-foreground" />
                                            <span>{sharedProjectIds.includes(project.id) ? 'Update on Bluet' : 'Share to Bluet'}</span>
                                        </DropdownMenuItem>
                                    )}
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                        onClick={() => onDeleteProject(project.id)}
                                        className="text-red-600 focus:text-red-600"
                                    >
                                        <Trash2 className="text-red-600" />
                                        <span>Delete Project</span>
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </SidebarMenuItem>
                    );
                })}

                {/* Empty state */}
                {projects.length === 0 && (
                    <SidebarMenuItem>
                        <SidebarMenuButton
                            onClick={onCreateProject}
                            className="text-sidebar-foreground/70"
                        >
                            <Plus className="w-4 h-4" />
                            <span>Create your first project</span>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                )}
            </SidebarMenu>
        </SidebarGroup>
    )
}
