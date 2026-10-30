import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderPlus, SquaresExclude } from 'lucide-react';
import { ProjectModal, getProjectBackgroundColor } from '@/components/ProjectModal';
import { AddGroupToProjectModal } from '@/components/AddGroupToProjectModal';
import { Storage } from '@/utils/storage';
import { ToastManager } from '@/components/Toast';
import { isolateBidi } from '@/i18n/bidi';
import { PROJECT_COLORS } from '@/types/models';
import type { TabGroup, Project } from '@/types/models';

export interface UseProjectPanelOptions {
    groups: TabGroup[];
    setGroups: React.Dispatch<React.SetStateAction<TabGroup[]>>;
    projects: Project[];
    setProjects: React.Dispatch<React.SetStateAction<Project[]>>;
    activeProjectId: string | null;
    setActiveProjectId: React.Dispatch<React.SetStateAction<string | null>>;
    saveAllTabs: (projectId?: string | null) => Promise<void>;
}

/**
 * Custom hook that owns project modal state and renders project modals.
 */
export function useProjectPanel({
    groups,
    setGroups,
    projects,
    setProjects: _setProjects,
    activeProjectId,
    setActiveProjectId,
    saveAllTabs,
}: UseProjectPanelOptions) {
    const { t } = useTranslation();
    const [showProjectModal, setShowProjectModal] = useState(false);
    const [editingProject, setEditingProject] = useState<Project | undefined>(undefined);
    const [showAddGroupToProjectModal, setShowAddGroupToProjectModal] = useState(false);

    // Check URL hash for action triggers
    useEffect(() => {
        const hash = window.location.hash;
        if (hash === '#action=create-project') {
            setEditingProject(undefined);
            setShowProjectModal(true);
            history.replaceState(null, '', window.location.pathname);
        }
    }, []);

    const handleCreateProject = async (projectData: Omit<Project, 'id' | 'created' | 'modified'>) => {
        const newProject: Project = {
            id: crypto.randomUUID(),
            ...projectData,
            created: Date.now(),
            modified: Date.now(),
        };
        await Storage.addProject(newProject);
        ToastManager.getInstance().success(t('options.projectPanel.projectCreated', { name: isolateBidi(newProject.name) }));
    };

    const handleEditProject = async (projectData: Omit<Project, 'id' | 'created' | 'modified'>) => {
        if (!editingProject) return;
        await Storage.updateProject(editingProject.id, projectData);
        ToastManager.getInstance().success(t('options.projectPanel.projectUpdated', { name: isolateBidi(projectData.name) }));
        setEditingProject(undefined);
    };

    const handleDeleteProject = async (projectId: string) => {
        const project = projects.find(p => p.id === projectId);
        if (!project) return;

        if (window.confirm(t('options.projectPanel.deleteConfirm', { name: isolateBidi(project.name) }))) {
            await Storage.deleteProject(projectId);
            if (activeProjectId === projectId) {
                setActiveProjectId(null);
            }
            ToastManager.getInstance().success(t('options.projectPanel.projectDeleted', { name: isolateBidi(project.name) }));
        }
    };

    const handleAssignGroupToProject = async (groupId: string, projectId: string | undefined) => {
        await Storage.assignGroupToProject(groupId, projectId);
        setGroups(prev => prev.map(g =>
            g.id === groupId ? { ...g, projectId, modified: Date.now() } : g
        ));
        const projectName = projectId
            ? (projects.find(p => p.id === projectId)?.name ?? t('options.projectPanel.noProject'))
            : t('options.projectPanel.noProject');
        ToastManager.getInstance().success(t('options.projectPanel.groupAssigned', { project: isolateBidi(projectName) }));
    };

    const openCreateProject = () => {
        setEditingProject(undefined);
        setShowProjectModal(true);
    };

    const openEditProject = (project: Project) => {
        setEditingProject(project);
        setShowProjectModal(true);
    };

    const activeProject = activeProjectId ? projects.find(p => p.id === activeProjectId) : null;

    const ProjectModals = (
        <>
            <ProjectModal
                isOpen={showProjectModal}
                onClose={() => {
                    setShowProjectModal(false);
                    setEditingProject(undefined);
                }}
                onSave={editingProject ? handleEditProject : handleCreateProject}
                editProject={editingProject}
                existingProjects={projects}
            />

            {activeProjectId && activeProject && (
                <AddGroupToProjectModal
                    isOpen={showAddGroupToProjectModal}
                    onClose={() => setShowAddGroupToProjectModal(false)}
                    project={activeProject}
                    groups={groups}
                    onAddGroups={async (groupIds) => {
                        const updatedGroups = groups.map(g =>
                            groupIds.includes(g.id)
                                ? { ...g, projectId: activeProjectId, modified: Date.now() }
                                : g
                        );
                        await Storage.set('groups', updatedGroups);
                        setGroups(updatedGroups);
                        ToastManager.getInstance().success(
                            t('options.projectPanel.groupsAdded', {
                                count: groupIds.length,
                                project: activeProject.name,
                            }),
                        );
                    }}
                />
            )}
        </>
    );

    const ProjectFloatingButtons = activeProjectId && activeProject ? (
        <>
            <button
                onClick={() => setShowAddGroupToProjectModal(true)}
                className="w-14 h-14 rounded-full shadow-lg transition-all duration-200 hover:shadow-2xl hover:scale-105 flex items-center justify-center"
                style={{
                    backgroundColor: getProjectBackgroundColor(activeProject.color, 0.1),
                    color: PROJECT_COLORS[activeProject.color],
                }}
                title={t('options.projectPanel.addGroupTitle', { project: isolateBidi(activeProject.name) })}
            >
                <FolderPlus className="w-6 h-6" />
            </button>
            <button
                onClick={() => saveAllTabs(activeProjectId)}
                className="w-14 h-14 rounded-full shadow-lg transition-all duration-200 hover:shadow-2xl hover:scale-105 flex items-center justify-center"
                style={{
                    backgroundColor: getProjectBackgroundColor(activeProject.color, 0.1),
                    color: PROJECT_COLORS[activeProject.color],
                }}
                title={t('options.projectPanel.saveTabsTitle', { project: isolateBidi(activeProject.name) })}
            >
                <SquaresExclude className="w-6 h-6" />
            </button>
        </>
    ) : null;

    return {
        ProjectModals,
        ProjectFloatingButtons,
        openCreateProject,
        openEditProject,
        handleDeleteProject,
        handleAssignGroupToProject,
    };
}
