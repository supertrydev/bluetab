import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    PROJECT_COLORS,
    type Project,
    type ProjectColor,
    type ProjectIcon,
    type ProjectSearchScope
} from '../types/models';
import {
    Folder,
    Briefcase,
    Code2,
    BookOpen,
    ShoppingCart,
    Plane,
    Gamepad2,
    Heart,
    Star,
    Music,
    GraduationCap,
    Home,
    Globe,
    Camera,
    Coffee,
    Film,
    Gift,
    Lightbulb,
    Palette,
    Settings,
    type LucideIcon
} from 'lucide-react';

// Icon mappings
export const PROJECT_ICONS: Record<ProjectIcon, LucideIcon> = {
    folder: Folder,
    briefcase: Briefcase,
    code: Code2,
    book: BookOpen,
    'shopping-cart': ShoppingCart,
    plane: Plane,
    gamepad: Gamepad2,
    heart: Heart,
    star: Star,
    music: Music,
    'graduation-cap': GraduationCap,
    home: Home,
    globe: Globe,
    camera: Camera,
    coffee: Coffee,
    film: Film,
    gift: Gift,
    lightbulb: Lightbulb,
    palette: Palette,
    settings: Settings,
};

interface ProjectModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (project: Omit<Project, 'id' | 'created' | 'modified'>) => void;
    editProject?: Project;
    existingProjects?: Project[];
}

export function ProjectModal({
    isOpen,
    onClose,
    onSave,
    editProject,
    existingProjects = []
}: ProjectModalProps) {
    const { t } = useTranslation();
    const [name, setName] = useState('');
    const [color, setColor] = useState<ProjectColor>('blue');
    const [icon, setIcon] = useState<ProjectIcon>('folder');
    const [searchScope, setSearchScope] = useState<ProjectSearchScope>('project');
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (isOpen) {
            if (editProject) {
                setName(editProject.name);
                setColor(editProject.color);
                setIcon(editProject.icon);
                setSearchScope(editProject.searchScope || 'project');
            } else {
                setName('');
                setColor('blue');
                setIcon('folder');
                setSearchScope('project');
            }
            setError(null);
        }
    }, [editProject, isOpen]);

    const validateName = (value: string): string | null => {
        const trimmed = value.trim();
        if (!trimmed) return t('options.projectModal.nameRequired');
        if (trimmed.length > 100) return t('options.projectModal.nameTooLong');

        // Check for duplicate names (excluding current project if editing)
        const isDuplicate = existingProjects.some(p =>
            p.name.toLowerCase() === trimmed.toLowerCase() &&
            (!editProject || p.id !== editProject.id)
        );
        if (isDuplicate) return t('options.projectModal.nameDuplicate');

        return null;
    };

    const handleSubmit = () => {
        const validationError = validateName(name);
        if (validationError) {
            setError(validationError);
            return;
        }

        onSave({ name: name.trim(), color, icon, searchScope });
        onClose();
    };

    const handleNameChange = (value: string) => {
        setName(value);
        if (error) {
            setError(validateName(value));
        }
    };

    const IconComponent = PROJECT_ICONS[icon];

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>
                        {editProject ? t('options.projectModal.editTitle') : t('options.projectModal.createTitle')}
                    </DialogTitle>
                    <DialogDescription>
                        {editProject
                            ? t('options.projectModal.editDescription')
                            : t('options.projectModal.createDescription')}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                    {/* Project Name */}
                    <div className="space-y-2">
                        <Label htmlFor="project-name">{t('options.projectModal.nameLabel')}</Label>
                        <Input
                            id="project-name"
                            value={name}
                            onChange={(e) => handleNameChange(e.target.value)}
                            placeholder={t('options.projectModal.namePlaceholder')}
                            autoFocus
                            className={error ? 'border-red-500' : ''}
                        />
                        {error && (
                            <p className="text-xs text-red-500">{error}</p>
                        )}
                    </div>

                    {/* Color Selection */}
                    <div className="space-y-2">
                        <Label>{t('options.projectModal.colorLabel')}</Label>
                        <div className="flex gap-2 flex-wrap">
                            {(Object.keys(PROJECT_COLORS) as ProjectColor[]).map((c) => (
                                <button
                                    key={c}
                                    type="button"
                                    onClick={() => setColor(c)}
                                    className={`w-8 h-8 rounded-full transition-all ${
                                        color === c
                                            ? 'ring-2 ring-offset-2 ring-gray-400 dark:ring-gray-500 scale-110'
                                            : 'hover:scale-105'
                                    }`}
                                    style={{ backgroundColor: PROJECT_COLORS[c] }}
                                    title={c.charAt(0).toUpperCase() + c.slice(1)}
                                />
                            ))}
                        </div>
                    </div>

                    {/* Icon Selection */}
                    <div className="space-y-2">
                        <Label>{t('options.projectModal.iconLabel')}</Label>
                        <div className="grid grid-cols-10 gap-1">
                            {(Object.keys(PROJECT_ICONS) as ProjectIcon[]).map((i) => {
                                const Icon = PROJECT_ICONS[i];
                                return (
                                    <button
                                        key={i}
                                        type="button"
                                        onClick={() => setIcon(i)}
                                        className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all border ${
                                            icon === i
                                                ? 'border-primary bg-primary/10 text-primary'
                                                : 'border-transparent hover:bg-muted text-muted-foreground'
                                        }`}
                                        title={i.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                                    >
                                        <Icon className="w-4 h-4" />
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Search Scope - only show when editing */}
                    {editProject && (
                        <div className="space-y-2">
                            <Label>{t('options.projectModal.searchScopeLabel')}</Label>
                            <p className="text-xs text-muted-foreground">
                                {t('options.projectModal.searchScopeDescription')}
                            </p>
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => setSearchScope('project')}
                                    className={`flex-1 px-3 py-2 rounded-lg border text-sm transition-colors ${
                                        searchScope === 'project'
                                            ? 'border-primary bg-primary/10 text-primary'
                                            : 'border-border hover:bg-muted text-muted-foreground'
                                    }`}
                                >
                                    {t('options.projectModal.projectOnly')}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setSearchScope('all')}
                                    className={`flex-1 px-3 py-2 rounded-lg border text-sm transition-colors ${
                                        searchScope === 'all'
                                            ? 'border-primary bg-primary/10 text-primary'
                                            : 'border-border hover:bg-muted text-muted-foreground'
                                    }`}
                                >
                                    {t('options.projectModal.allGroups')}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Preview */}
                    <div className="space-y-2">
                        <Label>{t('options.projectModal.previewLabel')}</Label>
                        <div
                            className="flex items-center gap-3 p-3 rounded-lg border border-border"
                            style={{ backgroundColor: `${PROJECT_COLORS[color]}15` }}
                        >
                            <IconComponent
                                className="w-5 h-5"
                                style={{ color: PROJECT_COLORS[color] }}
                            />
                            <span className="font-medium text-foreground">
                                {name || t('options.projectModal.previewName')}
                            </span>
                        </div>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>
                        {t('common.cancel')}
                    </Button>
                    <Button onClick={handleSubmit} disabled={!name.trim()}>
                        {editProject ? t('options.projectModal.saveChanges') : t('options.projectModal.createProject')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

// Helper function to get background color with opacity
export function getProjectBackgroundColor(color: ProjectColor, opacity: number = 0.1): string {
    const hex = PROJECT_COLORS[color];
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}
