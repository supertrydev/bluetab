import { StrictMode, useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { LocaleDirectionProvider } from '@/components/LocaleDirectionProvider';
import { AppSidebar } from '../components/app-sidebar';
import { textSizeService } from '../utils/TextSizeService';
import {
    SidebarProvider,
    SidebarInset,
    SidebarTrigger,
} from '../components/ui/sidebar';
import { Separator } from '../components/ui/separator';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { RadioGroup, RadioGroupItem } from '../components/ui/radio-group';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '../components/ui/select';
import { Switch } from '../components/ui/switch';
import { FlowStorageService } from '../utils/flow-storage';
import { Storage } from '../utils/storage';
import { hasHistoryPermission, requestHistoryPermission } from '@/services/history-permission';
import { makeSafeUserRegex } from '../utils/safe-regex';
import { FLOW_TEMPLATES } from '../config/flow-templates';
import type { FlowSettings, FlowRule, FlowTemplate, FlowConditionType } from '../types/flow';
import type { TabGroup, Project } from '../types/models';
import { Toaster, toast } from '@/components/Toast';
import { initI18n, setDocumentTitle, t as translate } from '@/i18n';
import { isolateBidi } from '@/i18n/bidi';
import { useDirection } from '@radix-ui/react-direction';
import { useAuth } from '../components/auth/useAuth';
import { getUpgradeUrl } from '../utils/feature-gate';
import { UpgradeToProButton } from '../components/auth/UpgradeToProButton';
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragEndEvent,
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    useSortable,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
    Zap,
    Plus,
    Sparkles,
    RefreshCw,
    Edit2,
    Trash2,
    Copy,
    GripVertical,
    AlertTriangle,
    FlaskConical,
    CheckCircle2,
    XCircle,
    CircleStar,
} from 'lucide-react';
import { FlowProposalModal } from './FlowProposalModal';
import { ModalTemplate, ModalTemplateSection } from '../components/ui/modal-template';
import '../styles/tailwind.css';

// Flow Template Card Component
function FlowTemplateCard({
    template,
    isImported,
    onImport,
    onRemove
}: {
    template: FlowTemplate;
    isImported: boolean;
    onImport: () => void;
    onRemove: () => void;
}) {
    return (
        <div className="flex items-center justify-between p-4 rounded-lg border border-border bg-bg-1 hover:bg-bg-2 transition-colors">
            <div className="flex items-center gap-3">
                <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center text-white text-lg"
                    style={{ backgroundColor: template.color }}
                >
                    <img
                        src={chrome.runtime.getURL(`src/assets/brand-icons/${template.platform}.svg`)}
                        alt={template.name}
                        className="w-5 h-5"
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                    />
                </div>
                <div>
                    <h4 className="font-medium text-text-strong"><bdi dir="auto">{template.name}</bdi></h4>
                    <p dir="auto" className="text-xs text-text-muted">{template.description}</p>
                </div>
            </div>
            {isImported ? (
                <Button variant="outline" size="sm" onClick={onRemove}>
                    {translate('common.remove')}
                </Button>
            ) : (
                <Button size="sm" onClick={onImport}>
                    <Plus className="h-4 w-4 me-1" />
                    {translate('common.add')}
                </Button>
            )}
        </div>
    );
}

// Sortable Flow Rule Card Component
function SortableFlowRuleCard({
    rule,
    existingGroups,
    hasConflict,
    onToggle,
    onEdit,
    onDuplicate,
    onDelete
}: {
    rule: FlowRule;
    existingGroups: { id: string; name: string }[];
    hasConflict?: boolean;
    onToggle: (enabled: boolean) => void;
    onEdit: () => void;
    onDuplicate: () => void;
    onDelete: () => void;
}) {
    const {
        attributes,
        listeners,
        setNodeRef,
        setActivatorNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: rule.id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
    };

    const getActionSummary = () => {
        if (rule.action.type === 'add_to_or_create') {
            return `→ ${rule.action.newGroupName || rule.name}`;
        }
        if (rule.action.type === 'create_group') {
            return translate('flow.ruleCard.createAction', { name: isolateBidi(rule.action.newGroupName || rule.name) });
        }
        if (rule.action.type === 'add_to_existing_group' && rule.action.targetGroupId) {
            const group = existingGroups.find(g => g.id === rule.action.targetGroupId);
            return `→ ${group?.name || translate('flow.ruleCard.unknownGroup')}`;
        }
        return translate('flow.ruleCard.addToGroup');
    };
    const actionSummary = getActionSummary();

    return (
        <div
            ref={setNodeRef}
            style={style}
            {...attributes}
            className={`flex items-center justify-between p-4 rounded-lg border ${hasConflict ? 'border-warning/50 bg-warning/5' : rule.enabled ? 'border-border bg-bg-1' : 'border-border-subtle bg-bg-0 opacity-60'} ${isDragging ? 'shadow-lg z-50' : ''}`}
        >
            <div className="flex items-center gap-3 flex-1 min-w-0">
                {/* Drag Handle */}
                <button
                    ref={setActivatorNodeRef}
                    {...listeners}
                    className="touch-none p-1 rounded hover:bg-bg-2 cursor-grab active:cursor-grabbing text-text-muted hover:text-text-strong transition-colors"
                    aria-label={translate('flow.ruleCard.dragToReorder')}
                >
                    <GripVertical className="h-4 w-4" />
                </button>
                {hasConflict && (
                    <AlertTriangle className="h-4 w-4 text-warning flex-shrink-0" aria-label={translate('flow.ruleCard.conflictAria')} />
                )}
                <Switch
                    checked={rule.enabled}
                    onCheckedChange={onToggle}
                />
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                        <h4 className="font-medium text-text-strong truncate"><bdi dir="auto">{rule.name}</bdi></h4>
                        {rule.isTemplate && (
                            <span className="text-xs px-1.5 py-0.5 bg-primary/10 text-primary rounded">
                                {translate('flow.ruleCard.templateBadge')}
                            </span>
                        )}
                    </div>
                    {rule.description && (
                        <p dir="auto" className="text-xs text-text-muted truncate">{rule.description}</p>
                    )}
                    <div className="flex flex-wrap gap-1 mt-1">
                        {rule.conditions.length > 1 && rule.conditionOperator === 'OR' && (
                            <span className="text-xs px-1.5 py-0.5 bg-primary/10 text-primary rounded font-medium">
                                OR
                            </span>
                        )}
                        {rule.conditions.map((c, idx) => (
                            <span key={c.id || idx} className={`text-xs px-1.5 py-0.5 rounded ${c.negate ? 'bg-danger/10 text-danger' : 'bg-bg-2 text-text-muted'}`}>
                                {c.negate && `${translate('flow.ruleCard.not')} `}{getConditionTypeLabels()[c.type]}:{' '}
                                <bdi dir={c.type.includes('title') ? 'auto' : 'ltr'}>{c.value}</bdi>
                            </span>
                        ))}
                        <span className="text-xs text-primary"><bdi dir="auto">{actionSummary}</bdi></span>
                    </div>
                    {rule.triggerCount && rule.triggerCount > 0 && (
                        <p className="text-xs text-text-muted mt-1">
                            {translate('flow.ruleCard.triggeredCount', { count: rule.triggerCount })}
                        </p>
                    )}
                </div>
            </div>
            <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" onClick={onEdit}>
                    <Edit2 className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" onClick={onDuplicate}>
                    <Copy className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" onClick={onDelete} className="text-danger hover:text-danger">
                    <Trash2 className="h-4 w-4" />
                </Button>
            </div>
        </div>
    );
}

// Condition type labels
function getConditionTypeLabels(): Record<FlowConditionType, string> {
    return {
        domain_contains: translate('flow.conditionTypes.domain_contains'),
        domain_equals: translate('flow.conditionTypes.domain_equals'),
        path_contains: translate('flow.conditionTypes.path_contains'),
        url_contains: translate('flow.conditionTypes.url_contains'),
        url_starts_with: translate('flow.conditionTypes.url_starts_with'),
        url_matches_regex: translate('flow.conditionTypes.url_matches_regex'),
        title_contains: translate('flow.conditionTypes.title_contains'),
        title_matches_regex: translate('flow.conditionTypes.title_matches_regex'),
    }
}

function getConditionPlaceholder(condition: { type: FlowConditionType }): string {
    if (condition.type.includes('domain')) return translate('flow.placeholders.domain');
    if (condition.type.includes('path')) return translate('flow.placeholders.path');
    if (condition.type.includes('title')) return translate('flow.placeholders.title');
    return translate('flow.placeholders.url');
}

// Condition editor for a single condition
interface ConditionEditorProps {
    condition: { type: FlowConditionType; value: string; negate?: boolean };
    index: number;
    onChange: (condition: { type: FlowConditionType; value: string; negate?: boolean }) => void;
    onRemove: () => void;
    canRemove: boolean;
}

function ConditionEditor({ condition, index, onChange, onRemove, canRemove }: ConditionEditorProps) {
    const conditionValueId = `flow-condition-${index}-value`;

    return (
        <div className="rounded-xl border border-border bg-bg-1 p-3">
            <div className="flex items-start gap-2">
                <div className="flex-1 space-y-3 min-w-0">
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                        <Select
                            value={condition.type}
                            onValueChange={(value) => onChange({ ...condition, type: value as FlowConditionType })}
                        >
                            <SelectTrigger className="border-border bg-bg-0 text-text-strong">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="border-border bg-bg-1 text-text">
                                {Object.entries(getConditionTypeLabels()).map(([value, label]) => (
                                    <SelectItem key={value} value={value}>{label}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Button
                            type="button"
                            variant={condition.negate ? 'danger' : 'outline'}
                            size="sm"
                            onClick={() => onChange({ ...condition, negate: !condition.negate })}
                            title={condition.negate ? translate('flow.editor.notDisableTitle') : translate('flow.editor.notEnableTitle')}
                            className="h-9 px-3"
                        >
                            NOT
                        </Button>
                    </div>
                    <div className="space-y-1.5">
                        <Label htmlFor={conditionValueId} className="text-text-muted">
                            {translate('flow.editor.matchValue')}
                        </Label>
                        <Input
                            id={conditionValueId}
                            type="text"
                            value={condition.value}
                            onChange={(e) => onChange({ ...condition, value: e.target.value })}
                            placeholder={getConditionPlaceholder(condition)}
                            className="border-border bg-bg-0 text-text-strong placeholder:text-gray-400 focus-visible:ring-primary/50 focus-visible:ring-offset-0"
                            dir={condition.type.includes('title') ? 'auto' : 'ltr'}
                        />
                    </div>
                </div>
                {canRemove && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={onRemove}
                        className="mt-0 text-danger hover:text-danger"
                        aria-label={translate('flow.editor.removeCondition', { count: index + 1 })}
                    >
                        <Trash2 className="h-4 w-4" />
                    </Button>
                )}
            </div>
        </div>
    );
}

// Flow Rule Editor Component
function FlowRuleEditor({
    rule,
    existingGroups,
    onSave,
    onCancel
}: {
    rule?: FlowRule;
    existingGroups: { id: string; name: string }[];
    onSave: (rule: Partial<FlowRule>) => void;
    onCancel: () => void;
}) {
    const [name, setName] = useState(rule?.name || '');
    const [description, setDescription] = useState(rule?.description || '');
    const [conditions, setConditions] = useState<{ type: FlowConditionType; value: string; negate?: boolean }[]>(
        rule?.conditions.map(c => ({ type: c.type, value: c.value, negate: c.negate })) ||
        [{ type: 'domain_contains', value: '', negate: false }]
    );
    const [conditionOperator, setConditionOperator] = useState<'AND' | 'OR'>(rule?.conditionOperator || 'AND');
    const [targetMode, setTargetMode] = useState<'existing' | 'new'>(() => {
        if (rule?.action.type === 'add_to_existing_group' && rule.action.targetGroupId) {
            return 'existing';
        }
        if (rule?.action.type === 'add_to_or_create' || rule?.action.type === 'create_group') {
            return 'new';
        }
        return existingGroups.length > 0 ? 'existing' : 'new';
    });
    const [selectedGroupId, setSelectedGroupId] = useState(rule?.action.targetGroupId || '');
    const [newGroupName, setNewGroupName] = useState(rule?.action.newGroupName || '');
    const hasExistingGroups = existingGroups.length > 0;
    const formId = rule?.id ? `flow-rule-editor-${rule.id}` : 'flow-rule-editor-create';

    const handleAddCondition = () => {
        setConditions([...conditions, { type: 'domain_contains', value: '', negate: false }]);
    };

    const handleUpdateCondition = (index: number, condition: { type: FlowConditionType; value: string; negate?: boolean }) => {
        const updated = [...conditions];
        updated[index] = condition;
        setConditions(updated);
    };

    const handleRemoveCondition = (index: number) => {
        setConditions(conditions.filter((_, i) => i !== index));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        // Validate
        if (!name.trim()) {
            toast.error(translate('flow.editor.validation.ruleName'));
            return;
        }

        const validConditions = conditions.filter(c => c.value.trim());
        if (validConditions.length === 0) {
            toast.error(translate('flow.editor.validation.condition'));
            return;
        }

        if (targetMode === 'existing' && !selectedGroupId) {
            toast.error(translate('flow.editor.validation.targetGroup'));
            return;
        }

        if (targetMode === 'new' && !newGroupName.trim()) {
            toast.error(translate('flow.editor.validation.newGroupName'));
            return;
        }

        onSave({
            id: rule?.id,
            name: name.trim(),
            description: description.trim() || undefined,
            enabled: rule?.enabled ?? true,
            priority: rule?.priority ?? 0,
            conditions: validConditions.map((c, idx) => ({
                id: rule?.conditions[idx]?.id || `cond-${Date.now()}-${idx}`,
                type: c.type,
                value: c.value.trim(),
                negate: c.negate,
            })),
            conditionOperator,
            action: targetMode === 'existing'
                ? { type: 'add_to_existing_group', targetGroupId: selectedGroupId }
                : { type: 'add_to_or_create', newGroupName: newGroupName.trim() },
        });
    };

    return (
        <ModalTemplate
            open
            onOpenChange={(nextOpen) => {
                if (!nextOpen) {
                    onCancel();
                }
            }}
            className="sm:max-w-2xl"
            heading={rule ? translate('flow.editor.editHeading') : translate('flow.editor.createHeading')}
            description={translate('flow.editor.description')}
            titleIcon={<Zap className="h-5 w-5 text-primary" />}
            footerClassName="bg-transparent"
            footer={(
                <>
                    <Button type="button" variant="secondary" onClick={onCancel}>
                        {translate('common.cancel')}
                    </Button>
                    <Button type="submit" form={formId}>
                        {rule ? translate('flow.editor.saveChanges') : translate('flow.editor.createRule')}
                    </Button>
                </>
            )}
        >
            <form id={formId} onSubmit={handleSubmit} className="space-y-4">
                <ModalTemplateSection className="rounded-lg">
                    <div className="space-y-1">
                        <h4 className="text-sm font-medium text-text-strong">{translate('flow.editor.ruleDetails')}</h4>
                        <p className="text-xs text-text-muted">
                            {translate('flow.editor.ruleDetailsDescription')}
                        </p>
                    </div>
                    <div className="space-y-4">
                        <div className="space-y-1.5">
                            <Label htmlFor="flow-rule-name">{translate('flow.editor.ruleName')}</Label>
                            <Input
                                id="flow-rule-name"
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder={translate('flow.editor.ruleNamePlaceholder')}
                                className="border-border bg-bg-0 text-text-strong placeholder:text-gray-400 focus-visible:ring-primary/50 focus-visible:ring-offset-0"
                                dir="auto"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="flow-rule-description">{translate('flow.editor.ruleDescription')}</Label>
                            <Input
                                id="flow-rule-description"
                                type="text"
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder={translate('flow.proposalModal.descriptionPlaceholder')}
                                className="border-border bg-bg-0 text-text-strong placeholder:text-gray-400 focus-visible:ring-primary/50 focus-visible:ring-offset-0"
                                dir="auto"
                            />
                        </div>
                    </div>
                </ModalTemplateSection>

                <ModalTemplateSection className="rounded-lg">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                            <h4 className="text-sm font-medium text-text-strong">{translate('flow.editor.conditions')}</h4>
                            <p className="mt-1 text-xs text-text-muted">
                                {conditionOperator === 'AND'
                                    ? translate('flow.editor.andDescription')
                                    : translate('flow.editor.orDescription')}
                            </p>
                        </div>
                        <div className="flex items-center gap-2">
                            {conditions.length > 1 && (
                                <div className="flex rounded-lg border border-border bg-bg-1 p-0.5">
                                    <Button
                                        type="button"
                                        variant={conditionOperator === 'AND' ? 'primary' : 'ghost'}
                                        size="sm"
                                        onClick={() => setConditionOperator('AND')}
                                        className="h-7 rounded-lg px-3"
                                    >
                                        AND
                                    </Button>
                                    <Button
                                        type="button"
                                        variant={conditionOperator === 'OR' ? 'primary' : 'ghost'}
                                        size="sm"
                                        onClick={() => setConditionOperator('OR')}
                                        className="h-7 rounded-lg px-3"
                                    >
                                        OR
                                    </Button>
                                </div>
                            )}
                            <Button type="button" variant="outline" size="sm" onClick={handleAddCondition}>
                                <Plus className="h-4 w-4" />
                                {translate('common.add')}
                            </Button>
                        </div>
                    </div>

                    <div className="space-y-3">
                        {conditions.map((condition, idx) => (
                            <ConditionEditor
                                key={idx}
                                index={idx}
                                condition={condition}
                                onChange={(c) => handleUpdateCondition(idx, c)}
                                onRemove={() => handleRemoveCondition(idx)}
                                canRemove={conditions.length > 1}
                            />
                        ))}
                    </div>
                </ModalTemplateSection>

                <ModalTemplateSection className="rounded-lg">
                    <div className="space-y-1">
                        <h4 className="text-sm font-medium text-text-strong">{translate('flow.editor.targetGroup')}</h4>
                        <p className="text-xs text-text-muted">
                            {translate('flow.editor.targetGroupDescription')}
                        </p>
                    </div>

                    <RadioGroup
                        value={targetMode}
                        onValueChange={(value) => {
                            const nextMode = value as 'existing' | 'new';
                            if (nextMode === 'existing' && !hasExistingGroups) return;
                            setTargetMode(nextMode);
                        }}
                        className="grid gap-2 sm:grid-cols-2"
                    >
                        <div className={`flex items-start gap-3 rounded-lg border p-3 transition-all ${targetMode === 'existing' ? 'border-primary bg-primary-muted/30' : 'border-border bg-bg-2'} ${!hasExistingGroups ? 'opacity-50' : ''}`}>
                            <RadioGroupItem
                                id="flow-target-existing"
                                value="existing"
                                disabled={!hasExistingGroups}
                                className="mt-0.5"
                            />
                            <Label htmlFor="flow-target-existing" className="grid cursor-pointer gap-1">
                                <span className="text-text-strong">{translate('flow.editor.existingGroup')}</span>
                                <span className="text-xs font-normal text-text-muted">
                                    {translate('flow.editor.existingGroupDescription')}
                                </span>
                            </Label>
                        </div>
                        <div className={`flex items-start gap-3 rounded-lg border p-3 transition-all ${targetMode === 'new' ? 'border-primary bg-primary-muted/30' : 'border-border bg-bg-2'}`}>
                            <RadioGroupItem id="flow-target-new" value="new" className="mt-0.5" />
                            <Label htmlFor="flow-target-new" className="grid cursor-pointer gap-1">
                                <span className="text-text-strong">{translate('flow.editor.newGroup')}</span>
                                <span className="text-xs font-normal text-text-muted">
                                    {translate('flow.editor.newGroupDescription')}
                                </span>
                            </Label>
                        </div>
                    </RadioGroup>

                    {targetMode === 'existing' ? (
                        <div className="space-y-1.5">
                            <Label htmlFor="flow-target-group">{translate('flow.editor.group')}</Label>
                            <Select
                                value={selectedGroupId}
                                onValueChange={setSelectedGroupId}
                                disabled={!hasExistingGroups}
                            >
                                <SelectTrigger id="flow-target-group" className="border-border bg-bg-0 text-text-strong">
                                    <SelectValue placeholder={translate('flow.editor.selectGroup')} />
                                </SelectTrigger>
                                <SelectContent className="border-border bg-bg-1 text-text">
                                    {existingGroups.map(group => (
                                        <SelectItem key={group.id} value={group.id}>
                                            <bdi dir="auto">{group.name}</bdi>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    ) : (
                        <div className="space-y-1.5">
                            <Label htmlFor="flow-new-group-name">{translate('flow.editor.newGroupName')}</Label>
                            <Input
                                id="flow-new-group-name"
                                type="text"
                                value={newGroupName}
                                onChange={(e) => setNewGroupName(e.target.value)}
                                placeholder={translate('flow.editor.enterNewGroupName')}
                                className="border-border bg-bg-0 text-text-strong placeholder:text-gray-400 focus-visible:ring-primary/50 focus-visible:ring-offset-0"
                                dir="auto"
                            />
                            <p className="text-xs text-text-muted">
                                {translate('flow.editor.newGroupHint')}
                            </p>
                        </div>
                    )}
                </ModalTemplateSection>
            </form>
        </ModalTemplate>
    );
}

// Test condition helper (matches flow-service.ts logic)
function testCondition(condition: { type: FlowConditionType; value: string; negate?: boolean }, url: string, title: string): boolean {
    let result = false;

    try {
        const parsedUrl = new URL(url);
        const value = condition.value.toLowerCase();
        const urlLower = url.toLowerCase();
        const titleLower = title.toLowerCase();

        switch (condition.type) {
            case 'domain_contains': {
                // Secure domain matching (same as flow-service.ts):
                // - "youtube.com" matches: youtube.com, www.youtube.com, m.youtube.com
                // - "youtube.com" does NOT match: fakeyoutube.com
                const domain = parsedUrl.hostname.toLowerCase();
                const searchDomain = value.replace(/^www\./, '');
                const normalizedDomain = domain.replace(/^www\./, '');
                result = normalizedDomain === searchDomain || normalizedDomain.endsWith('.' + searchDomain);
                break;
            }
            case 'domain_equals': {
                const domain = parsedUrl.hostname.toLowerCase();
                const normalizedDomain = domain.replace(/^www\./, '');
                const normalizedValue = value.replace(/^www\./, '');
                result = normalizedDomain === normalizedValue;
                break;
            }
            case 'path_contains': {
                const path = parsedUrl.pathname.toLowerCase();
                result = path.includes(value);
                break;
            }
            case 'url_contains':
                result = urlLower.includes(value);
                break;
            case 'url_starts_with':
                result = urlLower.startsWith(value);
                break;
            case 'url_matches_regex':
                result = makeSafeUserRegex(condition.value, 'i')?.test(url) ?? false;
                break;
            case 'title_contains':
                result = titleLower.includes(value);
                break;
            case 'title_matches_regex':
                result = makeSafeUserRegex(condition.value, 'i')?.test(title) ?? false;
                break;
        }
    } catch {
        result = false;
    }

    return condition.negate ? !result : result;
}

// Test rule helper (shared)
function testRule(rule: FlowRule, url: string, title: string): boolean {
    if (!rule.enabled) return false;

    const operator = rule.conditionOperator || 'AND';

    if (operator === 'AND') {
        return rule.conditions.every(c => testCondition(c, url, title));
    } else {
        return rule.conditions.some(c => testCondition(c, url, title));
    }
}

// Rule Test Component
function RuleTestPanel({ rules }: { rules: FlowRule[] }) {
    const [testUrl, setTestUrl] = useState('');
    const [testTitle, setTestTitle] = useState('');

    // Normalize URL for testing
    const getNormalizedUrl = (url: string): string => {
        if (!url.trim()) return '';
        let urlToTest = url.trim();
        if (!urlToTest.startsWith('http://') && !urlToTest.startsWith('https://')) {
            urlToTest = 'https://' + urlToTest;
        }
        return urlToTest;
    };

    const normalizedUrl = getNormalizedUrl(testUrl);

    // Dynamic test result - computed on every render
    const testResult = normalizedUrl ? (() => {
        const allMatches = rules.filter(r => testRule(r, normalizedUrl, testTitle));
        const matchedRule = allMatches[0];
        return {
            matched: allMatches.length > 0,
            matchedRule,
            allMatches,
        };
    })() : null;

    return (
        <section className="bg-bg-1 border border-border rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
                <FlaskConical className="h-5 w-5 text-primary" />
                <h3 className="font-medium text-text-strong">{translate('flow.testPanel.title')}</h3>
            </div>
            <p className="text-xs text-text-muted mb-3">
                {translate('flow.testPanel.description')}
            </p>
            <div className="space-y-3">
                <input
                    type="text"
                    value={testUrl}
                    onChange={(e) => setTestUrl(e.target.value)}
                    placeholder={translate('flow.testPanel.urlPlaceholder')}
                    className="w-full px-3 py-2 rounded-md border border-border bg-bg-0 text-text-strong placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/50"
                    dir="ltr"
                />
                <input
                    type="text"
                    value={testTitle}
                    onChange={(e) => setTestTitle(e.target.value)}
                    placeholder={translate('flow.testPanel.titlePlaceholder')}
                    className="w-full px-3 py-2 rounded-md border border-border bg-bg-0 text-text-strong placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/50"
                    dir="auto"
                />

                {testResult && (
                    <div className={`p-3 rounded-md border ${testResult.matched ? 'border-success/50 bg-success/10' : 'border-border bg-bg-2'}`}>
                        {testResult.matched ? (
                            <div className="space-y-2">
                                <div className="flex items-center gap-2">
                                    <CheckCircle2 className="h-4 w-4 text-success" />
                                    <span className="text-sm font-medium text-text-strong">
                                        {translate('flow.testPanel.matched', { name: isolateBidi(testResult.matchedRule?.name ?? '') })}
                                    </span>
                                </div>
                                <p className="text-xs text-text-muted">
                                    → <bdi dir="auto">{testResult.matchedRule?.action.newGroupName || translate('flow.testPanel.targetGroup')}</bdi>
                                </p>
                                {testResult.allMatches.length > 1 && (
                                    <p className="text-xs text-warning">
                                        {translate('flow.testPanel.otherMatches', { count: testResult.allMatches.length - 1 })}
                                    </p>
                                )}
                            </div>
                        ) : (
                            <div className="flex items-center gap-2">
                                <XCircle className="h-4 w-4 text-text-muted" />
                                <span className="text-sm text-text-muted">{translate('flow.testPanel.noMatch')}</span>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </section>
    );
}

// Rule Conflict Detection
function detectRuleConflicts(rules: FlowRule[]): { rule1: FlowRule; rule2: FlowRule; reason: string }[] {
    const conflicts: { rule1: FlowRule; rule2: FlowRule; reason: string }[] = [];
    const enabledRules = rules.filter(r => r.enabled);

    for (let i = 0; i < enabledRules.length; i++) {
        for (let j = i + 1; j < enabledRules.length; j++) {
            const rule1 = enabledRules[i];
            const rule2 = enabledRules[j];

            // Check for identical conditions (including negate flag)
            const cond1 = rule1.conditions.map(c => `${c.type}:${c.value}:${c.negate || false}`).sort().join('|');
            const cond2 = rule2.conditions.map(c => `${c.type}:${c.value}:${c.negate || false}`).sort().join('|');
            const op1 = rule1.conditionOperator || 'AND';
            const op2 = rule2.conditionOperator || 'AND';

            if (cond1 === cond2 && op1 === op2) {
                conflicts.push({
                    rule1,
                    rule2,
                    reason: translate('flow.conflicts.identical')
                });
                continue;
            }

            // Check for overlapping domain conditions
            const domain1 = rule1.conditions.find(c => c.type === 'domain_contains' || c.type === 'domain_equals');
            const domain2 = rule2.conditions.find(c => c.type === 'domain_contains' || c.type === 'domain_equals');

            if (domain1 && domain2 && domain1.value === domain2.value) {
                // Same domain, check if one is more specific
                const pathCond1 = rule1.conditions.filter(c => c.type !== 'domain_contains' && c.type !== 'domain_equals');
                const pathCond2 = rule2.conditions.filter(c => c.type !== 'domain_contains' && c.type !== 'domain_equals');

                if (pathCond1.length === 0 && pathCond2.length > 0) {
                    conflicts.push({
                        rule1,
                        rule2,
                        reason: translate('flow.conflicts.overlap', {
                            first: isolateBidi(rule1.name),
                            domain: isolateBidi(domain1.value, 'ltr'),
                            second: isolateBidi(rule2.name),
                        })
                    });
                }
            }
        }
    }

    return conflicts;
}

// Main Flow Page Component
function FlowPage() {
    const direction = useDirection();
    const { isPro, isLoading: isAuthLoading } = useAuth();
    const [flowSettings, setFlowSettings] = useState<FlowSettings | null>(null);
    const [importedTemplates, setImportedTemplates] = useState<Set<string>>(new Set());
    const [existingGroups, setExistingGroups] = useState<{ id: string; name: string }[]>([]);
    const [projects, setProjects] = useState<Project[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [showEditor, setShowEditor] = useState(false);
    const [editingRule, setEditingRule] = useState<FlowRule | undefined>(undefined);

    // AI Flow Rule Designer — modal state (Pro-only, DESIGN-01)
    const [showProposalModal, setShowProposalModal] = useState(false);
    const [historyPermissionGranted, setHistoryPermissionGranted] = useState(false);

    const [sidebarOpen, setSidebarOpen] = useState<boolean | null>(null);

    useEffect(() => {
        Storage.get<boolean>('bluetab_sidebar_open').then((saved) => {
            setSidebarOpen(saved ?? true);
        });
    }, []);

    const refreshAIHistoryAccess = useCallback(async () => {
        const historyGranted = await hasHistoryPermission();
        setHistoryPermissionGranted(historyGranted);
    }, []);

    // Check history permission for the AI entrypoint.
    useEffect(() => {
        if (!isPro) {
            setHistoryPermissionGranted(false);
            return;
        }
        void refreshAIHistoryAccess();
    }, [isPro, refreshAIHistoryAccess]);

    const handleOpenProposalModal = useCallback(() => {
        void (async () => {
            const permissionGranted =
                historyPermissionGranted === true ? true : await requestHistoryPermission();

            setHistoryPermissionGranted(permissionGranted);

            if (!permissionGranted) {
                toast.error(translate('flow.page.historyAccessRequired'));
                return;
            }

            void refreshAIHistoryAccess();
            setShowProposalModal(true);
        })();
    }, [historyPermissionGranted, refreshAIHistoryAccess]);

    // DnD sensors
    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 8,
            },
        }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    // Detect rule conflicts
    const ruleConflicts = flowSettings?.rules ? detectRuleConflicts(flowSettings.rules) : [];

    // Save sidebar state to chrome.storage.local
    const handleSidebarOpenChange = (open: boolean) => {
        setSidebarOpen(open);
        Storage.set('bluetab_sidebar_open', open);
    };

    // Load Flow settings and existing groups on mount
    useEffect(() => {
        loadFlowSettings();
        loadExistingGroups();
    }, []);

    const loadExistingGroups = async () => {
        try {
            const groups = await Storage.get<TabGroup[]>('groups') || [];
            setExistingGroups(groups.map(g => ({ id: g.id, name: g.name })));
            const storedProjects = await Storage.getProjects();
            setProjects(storedProjects);
        } catch (error) {
            console.error('Failed to load groups:', error);
        }
    };

    // Navigate to options page with project filter
    const handleSelectProject = (projectId: string | null) => {
        if (projectId) {
            window.location.href = chrome.runtime.getURL(`src/options/index.html#project=${projectId}`);
        } else {
            window.location.href = chrome.runtime.getURL('src/options/index.html');
        }
    };

    const loadFlowSettings = async () => {
        setIsLoading(true);
        try {
            const settings = await FlowStorageService.getFlowSettings();
            setFlowSettings(settings);

            // Check which templates are imported
            const imported = new Set<string>();
            for (const template of FLOW_TEMPLATES) {
                if (await FlowStorageService.isTemplateImported(template.id)) {
                    imported.add(template.id);
                }
            }
            setImportedTemplates(imported);
        } catch (error) {
            console.error('Failed to load Flow settings:', error);
            toast.error(translate('flow.page.loadFailed'));
        } finally {
            setIsLoading(false);
        }
    };

    const handleToggleFlow = async (enabled: boolean) => {
        const result = await FlowStorageService.toggleFlow(enabled);
        if (result.success) {
            setFlowSettings(prev => prev ? { ...prev, enabled } : null);
            toast.success(enabled ? translate('flow.page.enabledToast') : translate('flow.page.disabledToast'));
        } else {
            toast.error(translate('flow.page.toggleFailed'));
        }
    };

    const handleImportTemplate = async (template: FlowTemplate) => {
        const result = await FlowStorageService.importTemplate(template);
        if (result.success) {
            setImportedTemplates(prev => new Set([...prev, template.id]));
            await loadFlowSettings();
            toast.success(translate('flow.page.templateAdded', { name: isolateBidi(template.name) }));
        } else {
            toast.error(translate('flow.page.templateAddFailed', {
                message: isolateBidi(result.error ?? translate('common.unknownError')),
            }));
        }
    };

    const handleRemoveTemplate = async (templateId: string) => {
        const result = await FlowStorageService.removeTemplateRules(templateId);
        if (result.success) {
            setImportedTemplates(prev => {
                const next = new Set(prev);
                next.delete(templateId);
                return next;
            });
            await loadFlowSettings();
            toast.success(translate('flow.page.templateRemoved'));
        } else {
            toast.error(translate('flow.page.templateRemoveFailed'));
        }
    };

    const handleToggleRule = async (ruleId: string, enabled: boolean) => {
        // Optimistic update
        setFlowSettings(prev => prev ? {
            ...prev,
            rules: prev.rules.map(r => r.id === ruleId ? { ...r, enabled } : r)
        } : null);

        const result = await FlowStorageService.toggleRule(ruleId, enabled);
        if (!result.success) {
            toast.error(translate('flow.page.ruleUpdateFailed'));
            await loadFlowSettings(); // Revert on error
        }
    };

    const handleDeleteRule = async (ruleId: string) => {
        // Optimistic update
        setFlowSettings(prev => prev ? {
            ...prev,
            rules: prev.rules.filter(r => r.id !== ruleId)
        } : null);

        const result = await FlowStorageService.deleteRule(ruleId);
        if (result.success) {
            toast.success(translate('flow.page.ruleDeleted'));
        } else {
            toast.error(translate('flow.page.ruleDeleteFailed'));
            await loadFlowSettings(); // Revert on error
        }
    };

    const handleCreateRule = () => {
        setEditingRule(undefined);
        setShowEditor(true);
    };

    const handleEditRule = (rule: FlowRule) => {
        setEditingRule(rule);
        setShowEditor(true);
    };

    const handleDuplicateRule = async (rule: FlowRule) => {
        const result = await FlowStorageService.createRule({
            name: `${rule.name} (Copy)`,
            description: rule.description,
            enabled: rule.enabled,
            priority: rule.priority,
            conditions: rule.conditions.map(c => ({ ...c, id: `${c.id}-copy-${Date.now()}` })),
            action: { ...rule.action },
        });
        if (result.success) {
            setFlowSettings(prev => prev ? { ...prev, rules: [...prev.rules, result.rule!] } : null);
            toast.success(translate('flow.page.ruleDuplicated'));
        } else {
            toast.error(translate('flow.page.ruleDuplicateFailed', {
                message: isolateBidi(result.error ?? translate('common.unknownError')),
            }));
        }
    };

    const handleDragEnd = async (event: DragEndEvent) => {
        const { active, over } = event;

        if (over && active.id !== over.id && flowSettings) {
            const oldIndex = flowSettings.rules.findIndex(r => r.id === active.id);
            const newIndex = flowSettings.rules.findIndex(r => r.id === over.id);

            const newRules = arrayMove(flowSettings.rules, oldIndex, newIndex);
            // Update priorities based on new order
            const updatedRules = newRules.map((rule, idx) => ({ ...rule, priority: idx }));

            // Optimistically update UI
            setFlowSettings(prev => prev ? { ...prev, rules: updatedRules } : null);

            // Persist to storage
            const result = await FlowStorageService.reorderRules(updatedRules.map(r => r.id));
            if (!result.success) {
                toast.error(translate('flow.page.ruleOrderFailed'));
                await loadFlowSettings(); // Revert on error
            }
        }
    };

    const handleSaveRule = async (ruleData: Partial<FlowRule>) => {
        if (editingRule) {
            // Update existing rule
            const result = await FlowStorageService.updateRule(editingRule.id, ruleData);
            if (result.success) {
                // Reload from storage to ensure we have the latest data
                await loadFlowSettings();
                toast.success(translate('flow.page.ruleUpdated'));
                setShowEditor(false);
                setEditingRule(undefined);
            } else {
                toast.error(translate('flow.page.ruleUpdateWithMessage', {
                    message: isolateBidi(result.error ?? translate('common.unknownError')),
                }));
            }
        } else {
            // Create new rule
            const result = await FlowStorageService.createRule({
                name: ruleData.name!,
                description: ruleData.description,
                enabled: ruleData.enabled ?? true,
                priority: ruleData.priority ?? 0,
                conditions: ruleData.conditions!,
                conditionOperator: ruleData.conditionOperator,
                action: ruleData.action!,
            });
            if (result.success && result.rule) {
                // Optimistic update
                setFlowSettings(prev => prev ? {
                    ...prev,
                    rules: [...prev.rules, result.rule!]
                } : null);
                toast.success(translate('flow.page.ruleCreated'));
                setShowEditor(false);
            } else {
                toast.error(translate('flow.page.ruleCreateFailed', {
                    message: isolateBidi(result.error ?? translate('common.unknownError')),
                }));
            }
        }
    };

    if (sidebarOpen === null) return null;

    return (
        <SidebarProvider open={sidebarOpen} onOpenChange={handleSidebarOpenChange}>
            <AppSidebar
                activePage="flow"
                projects={projects}
                onSelectProject={handleSelectProject}
                onCreateProject={() => {
                    window.location.href = chrome.runtime.getURL('src/options/index.html#action=create-project');
                }}
            />
            <SidebarInset>
                <header className="sticky top-0 z-50 flex h-16 shrink-0 items-center justify-between gap-2 border-b border-border-glass px-4 bg-glass-bg backdrop-blur-md">
                    <div className="flex items-center gap-2">
                        <SidebarTrigger className="-ms-1" />
                        <Separator orientation="vertical" className="me-2 h-4" />
                        <div className="flex items-center gap-2">
                            <Zap className="h-5 w-5 text-primary" />
                            <div>
                                <h1 className="text-lg font-semibold text-text-strong">{translate('flow.page.title')}</h1>
                                <p className="text-xs text-text-muted">
                                    {translate('flow.page.tabsProcessed', { count: flowSettings?.executionCount || 0 })}
                                </p>
                            </div>
                        </div>
                    </div>
                    {isPro && (
                        <div className="flex items-center gap-3">
                            {/* Suggest rules (AI) — Pro-only, DESIGN-01 */}
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={handleOpenProposalModal}
                                    title={
                                        !historyPermissionGranted
                                            ? translate('flow.page.aiSuggestGrantTitle')
                                            : translate('flow.page.aiSuggestTitle')
                                    }
                                    className="gap-1.5"
                            >
                                <Sparkles className="h-4 w-4" />
                                {translate('flow.page.suggestRules')}
                            </Button>
                            <Button variant="ghost" size="icon" onClick={loadFlowSettings} disabled={isLoading}>
                                <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
                            </Button>
                            <div className="flex items-center gap-2">
                                <span className="text-sm text-text-muted">
                                    {flowSettings?.enabled ? translate('flow.page.enabled') : translate('flow.page.disabled')}
                                </span>
                                <Switch
                                    checked={flowSettings?.enabled || false}
                                    onCheckedChange={handleToggleFlow}
                                />
                            </div>
                        </div>
                    )}
                </header>

                <div className="flex flex-1 flex-col gap-6 p-4 bg-bg-0 overflow-auto">
                    {/* Pro Gate */}
                    {!isAuthLoading && !isPro && (
                        <div className="max-w-4xl mx-auto w-full">
                            <div className="bg-gradient-to-br from-primary/10 via-bg-1 to-warning/10 border border-primary/20 rounded-xl p-8 text-center">
                                <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                                    <CircleStar className="h-8 w-8 text-primary" />
                                </div>
                                <h2 className="text-2xl font-bold text-text-strong mb-2">
                                    {translate('flow.page.proTitle')}
                                </h2>
                                <p className="text-text-muted mb-6 max-w-md mx-auto">
                                    {translate('flow.page.proDescription')}
                                </p>
                                <div className="flex items-center justify-center gap-3">
                                    <UpgradeToProButton
                                        onClick={() => window.open(getUpgradeUrl(), '_blank')}
                                    />
                                </div>
                                <div className="mt-8 grid gap-3 sm:grid-cols-3 text-start max-w-lg mx-auto">
                                    <div className="flex items-start gap-2">
                                        <CheckCircle2 className="h-4 w-4 text-success mt-0.5 flex-shrink-0" />
                                        <span className="text-sm text-text-muted">{translate('flow.page.proFeatures.urlGrouping')}</span>
                                    </div>
                                    <div className="flex items-start gap-2">
                                        <CheckCircle2 className="h-4 w-4 text-success mt-0.5 flex-shrink-0" />
                                        <span className="text-sm text-text-muted">{translate('flow.page.proFeatures.templates')}</span>
                                    </div>
                                    <div className="flex items-start gap-2">
                                        <CheckCircle2 className="h-4 w-4 text-success mt-0.5 flex-shrink-0" />
                                        <span className="text-sm text-text-muted">{translate('flow.page.proFeatures.customRules')}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Flow Content - only show if Pro */}
                    {(isAuthLoading || isPro) && (
                        <div className="max-w-4xl mx-auto w-full space-y-6">
                            {/* Templates Section */}
                            <section>
                                <div className="flex items-center gap-2 mb-4">
                                    <Sparkles className="h-5 w-5 text-primary" />
                                    <h2 className="text-lg font-semibold text-text-strong">{translate('flow.page.templates')}</h2>
                                </div>
                                <p className="text-sm text-text-muted mb-4">
                                    {translate('flow.page.templatesDescription')}
                                </p>
                                <div className="grid gap-3 sm:grid-cols-2">
                                    {FLOW_TEMPLATES.map(template => (
                                        <FlowTemplateCard
                                            key={template.id}
                                            template={template}
                                            isImported={importedTemplates.has(template.id)}
                                            onImport={() => handleImportTemplate(template)}
                                            onRemove={() => handleRemoveTemplate(template.id)}
                                        />
                                    ))}
                                </div>
                            </section>

                            {/* Active Rules Section */}
                            <section>
                                <div className="flex items-center justify-between mb-4">
                                    <div className="flex items-center gap-2">
                                        <Zap className="h-5 w-5 text-primary" />
                                        <h2 className="text-lg font-semibold text-text-strong">{translate('flow.page.activeRules')}</h2>
                                        <span className="text-sm text-text-muted">
                                            ({flowSettings?.rules.length || 0})
                                        </span>
                                    </div>
                                    <Button onClick={handleCreateRule} size="sm">
                                        <Plus className="h-4 w-4 me-1" />
                                        {translate('flow.editor.createRule')}
                                    </Button>
                                </div>

                                {isLoading ? (
                                    <div className="flex items-center justify-center py-12">
                                        <RefreshCw className="h-6 w-6 animate-spin text-text-muted" />
                                    </div>
                                ) : flowSettings?.rules.length === 0 ? (
                                    <div className="text-center py-12 border border-dashed border-border rounded-lg">
                                        <Zap className="h-8 w-8 text-text-muted mx-auto mb-3" />
                                        <p className="text-text-muted mb-2">{translate('flow.page.noRules')}</p>
                                        <p className="text-sm text-text-muted mb-4">
                                            {translate('flow.page.noRulesDescription')}
                                        </p>
                                        <Button onClick={handleCreateRule} variant="outline" size="sm">
                                            <Plus className="h-4 w-4 me-1" />
                                            {translate('flow.editor.createRule')}
                                        </Button>
                                    </div>
                                ) : (
                                    <div className="space-y-3">
                                        {/* Rule Conflicts Warning - inside rules section */}
                                        {ruleConflicts.length > 0 && (
                                            <div className="bg-warning/10 border border-warning/50 rounded-lg p-3">
                                                <div className="flex items-center gap-2 mb-2">
                                                    <AlertTriangle className="h-4 w-4 text-warning" />
                                                    <span className="text-sm font-medium text-text-strong">
                                                        {translate('flow.page.conflictsDetected', { count: ruleConflicts.length })}
                                                    </span>
                                                </div>
                                                <ul className="text-xs text-text-muted space-y-1">
                                                    {ruleConflicts.map((conflict, idx) => (
                                                        <li key={idx}>• <bdi dir="auto">{conflict.reason}</bdi></li>
                                                    ))}
                                                </ul>
                                            </div>
                                        )}

                                        <DndContext
                                            sensors={sensors}
                                            collisionDetection={closestCenter}
                                            onDragEnd={handleDragEnd}
                                        >
                                            <SortableContext
                                                items={flowSettings?.rules.map(r => r.id) || []}
                                                strategy={verticalListSortingStrategy}
                                            >
                                                <div className="space-y-2">
                                                    {flowSettings?.rules.map(rule => {
                                                        const hasConflict = ruleConflicts.some(
                                                            c => c.rule1.id === rule.id || c.rule2.id === rule.id
                                                        );
                                                        return (
                                                            <SortableFlowRuleCard
                                                                key={rule.id}
                                                                rule={rule}
                                                                existingGroups={existingGroups}
                                                                hasConflict={hasConflict}
                                                                onToggle={(enabled) => handleToggleRule(rule.id, enabled)}
                                                                onEdit={() => handleEditRule(rule)}
                                                                onDuplicate={() => handleDuplicateRule(rule)}
                                                                onDelete={() => handleDeleteRule(rule.id)}
                                                            />
                                                        );
                                                    })}
                                                </div>
                                            </SortableContext>
                                        </DndContext>
                                    </div>
                                )}
                            </section>

                            {/* Rule Test Panel (conditionally shown) */}
                            {flowSettings?.showRuleTest && flowSettings.rules.length > 0 && (
                                <RuleTestPanel rules={flowSettings.rules} />
                            )}

                            {/* Developer Options Section - commented out
                        <section className="bg-bg-1 border border-border rounded-lg p-4">
                            <div className="flex items-center gap-2 mb-3">
                                <Settings className="h-5 w-5 text-text-muted" />
                                <h3 className="font-medium text-text-strong">Developer Options</h3>
                            </div>
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm text-text-strong">Show Rule Test Panel</p>
                                    <p className="text-xs text-text-muted">Test URLs against your rules for debugging</p>
                                </div>
                                <Switch
                                    checked={flowSettings?.showRuleTest || false}
                                    onCheckedChange={handleToggleRuleTest}
                                />
                            </div>
                        </section>
                        */}

                            {/* Info Section */}
                            <section className="bg-bg-1 border border-border rounded-lg p-4">
                                <h3 className="font-medium text-text-strong mb-2">{translate('flow.page.howItWorks')}</h3>
                                <ul className="text-sm text-text-muted space-y-1">
                                    <li>{translate('flow.page.howItWorksItems.0')}</li>
                                    <li>{translate('flow.page.howItWorksItems.1')}</li>
                                    <li>{translate('flow.page.howItWorksItems.2')}</li>
                                    <li>{translate('flow.page.howItWorksItems.3')}</li>
                                </ul>
                            </section>
                        </div>
                    )}
                </div>

                {/* AI Flow Rule Proposal Modal (Pro-only, DESIGN-01) */}
                <FlowProposalModal
                    open={showProposalModal}
                    onClose={() => setShowProposalModal(false)}
                    onRulesChanged={loadFlowSettings}
                />

                {/* Rule Editor Modal */}
                {showEditor && (
                    <FlowRuleEditor
                        rule={editingRule}
                        existingGroups={existingGroups}
                        onSave={handleSaveRule}
                        onCancel={() => {
                            setShowEditor(false);
                            setEditingRule(undefined);
                        }}
                    />
                )}

                <Toaster richColors position={direction === 'rtl' ? 'bottom-left' : 'bottom-right'} />
            </SidebarInset>
        </SidebarProvider>
    );
}

async function mountFlowPage(): Promise<void> {
    await initI18n();
    setDocumentTitle('document.flowTitle');

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
                <FlowPage />
            </LocaleDirectionProvider>
        </StrictMode>
    );
}

void mountFlowPage();
