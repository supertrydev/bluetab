import { StrictMode, useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { AppSidebar } from '../components/app-sidebar';
import {
    SidebarProvider,
    SidebarInset,
    SidebarTrigger,
} from '../components/ui/sidebar';
import { Separator } from '../components/ui/separator';
import { Button } from '../components/ui/button';
import { Switch } from '../components/ui/switch';
import { FlowStorageService } from '../utils/flow-storage';
import { Storage } from '../utils/storage';
import { FLOW_TEMPLATES } from '../config/flow-templates';
import type { FlowSettings, FlowRule, FlowTemplate, FlowConditionType, FlowConditionOperator } from '../types/flow';
import type { TabGroup, Project } from '../types/models';
import { Toaster, toast } from 'sonner';
import { useAuth } from '../components/auth/useAuth';
import { getUpgradeUrl } from '../utils/feature-gate';
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
    X,
    Edit2,
    Trash2,
    Copy,
    GripVertical,
    AlertTriangle,
    FlaskConical,
    CheckCircle2,
    XCircle,
    Crown,
} from 'lucide-react';
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
                    {template.icon === 'Youtube' && <i className="fab fa-youtube"></i>}
                    {template.icon === 'X' && <i className="fa-brands fa-x-twitter"></i>}
                    {template.icon === 'Instagram' && <i className="fab fa-instagram"></i>}
                    {template.icon === 'Facebook' && <i className="fab fa-facebook"></i>}
                    {template.icon === 'Linkedin' && <i className="fab fa-linkedin"></i>}
                    {template.icon === 'Reddit' && <i className="fab fa-reddit"></i>}
                    {template.icon === 'Tiktok' && <i className="fab fa-tiktok"></i>}
                    {template.icon === 'Github' && <i className="fab fa-github"></i>}
                    {template.icon === 'Pinterest' && <i className="fab fa-pinterest"></i>}
                </div>
                <div>
                    <h4 className="font-medium text-text-strong">{template.name}</h4>
                    <p className="text-xs text-text-muted">{template.description}</p>
                </div>
            </div>
            {isImported ? (
                <Button variant="outline" size="sm" onClick={onRemove}>
                    Remove
                </Button>
            ) : (
                <Button size="sm" onClick={onImport}>
                    <Plus className="h-4 w-4 mr-1" />
                    Add
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
            return `Create: ${rule.action.newGroupName || rule.name}`;
        }
        if (rule.action.type === 'add_to_existing_group' && rule.action.targetGroupId) {
            const group = existingGroups.find(g => g.id === rule.action.targetGroupId);
            return `→ ${group?.name || 'Unknown group'}`;
        }
        return 'Add to group';
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
                    aria-label="Drag to reorder"
                >
                    <GripVertical className="h-4 w-4" />
                </button>
                {hasConflict && (
                    <AlertTriangle className="h-4 w-4 text-warning flex-shrink-0" title="This rule has a conflict" />
                )}
                <Switch
                    checked={rule.enabled}
                    onCheckedChange={onToggle}
                />
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                        <h4 className="font-medium text-text-strong truncate">{rule.name}</h4>
                        {rule.isTemplate && (
                            <span className="text-xs px-1.5 py-0.5 bg-primary/10 text-primary rounded">
                                Template
                            </span>
                        )}
                    </div>
                    {rule.description && (
                        <p className="text-xs text-text-muted truncate">{rule.description}</p>
                    )}
                    <div className="flex flex-wrap gap-1 mt-1">
                        {rule.conditions.length > 1 && rule.conditionOperator === 'OR' && (
                            <span className="text-xs px-1.5 py-0.5 bg-primary/10 text-primary rounded font-medium">
                                OR
                            </span>
                        )}
                        {rule.conditions.map((c, idx) => (
                            <span key={c.id || idx} className={`text-xs px-1.5 py-0.5 rounded ${c.negate ? 'bg-danger/10 text-danger' : 'bg-bg-2 text-text-muted'}`}>
                                {c.negate && 'NOT '}{CONDITION_TYPE_LABELS[c.type]}: {c.value}
                            </span>
                        ))}
                        <span className="text-xs text-primary">{actionSummary}</span>
                    </div>
                    {rule.triggerCount && rule.triggerCount > 0 && (
                        <p className="text-xs text-text-muted mt-1">
                            Triggered {rule.triggerCount} time{rule.triggerCount !== 1 ? 's' : ''}
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
const CONDITION_TYPE_LABELS: Record<FlowConditionType, string> = {
    'domain_contains': 'Domain Contains',
    'domain_equals': 'Domain Equals',
    'path_contains': 'Path Contains',
    'url_contains': 'URL Contains',
    'url_starts_with': 'URL Starts With',
    'url_matches_regex': 'URL Regex',
    'title_contains': 'Title Contains',
    'title_matches_regex': 'Title Regex',
};

// Condition editor for a single condition
interface ConditionEditorProps {
    condition: { type: FlowConditionType; value: string; negate?: boolean };
    onChange: (condition: { type: FlowConditionType; value: string; negate?: boolean }) => void;
    onRemove: () => void;
    canRemove: boolean;
}

function ConditionEditor({ condition, onChange, onRemove, canRemove }: ConditionEditorProps) {
    const getPlaceholder = () => {
        if (condition.type.includes('domain')) return 'e.g., youtube.com';
        if (condition.type.includes('path')) return 'e.g., /watch';
        if (condition.type.includes('title')) return 'e.g., Tutorial';
        return 'e.g., youtube.com/watch';
    };

    return (
        <div className="flex gap-2 items-start">
            <div className="flex-1 space-y-2">
                <div className="flex gap-2">
                    <select
                        value={condition.type}
                        onChange={(e) => onChange({ ...condition, type: e.target.value as FlowConditionType })}
                        className="flex-1 px-3 py-2 rounded-md border border-border bg-bg-0 text-text-strong focus:outline-none focus:ring-2 focus:ring-primary/50"
                    >
                        {Object.entries(CONDITION_TYPE_LABELS).map(([value, label]) => (
                            <option key={value} value={value}>{label}</option>
                        ))}
                    </select>
                    <button
                        type="button"
                        onClick={() => onChange({ ...condition, negate: !condition.negate })}
                        className={`px-3 py-2 rounded-md border text-sm font-medium transition-colors ${condition.negate
                            ? 'border-danger bg-danger/10 text-danger'
                            : 'border-border bg-bg-0 text-text-muted hover:bg-bg-2'
                            }`}
                        title={condition.negate ? 'NOT active - click to disable' : 'Click to enable NOT'}
                    >
                        NOT
                    </button>
                </div>
                <input
                    type="text"
                    value={condition.value}
                    onChange={(e) => onChange({ ...condition, value: e.target.value })}
                    placeholder={getPlaceholder()}
                    className="w-full px-3 py-2 rounded-md border border-border bg-bg-0 text-text-strong placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
            </div>
            {canRemove && (
                <Button type="button" variant="ghost" size="sm" onClick={onRemove} className="mt-1">
                    <Trash2 className="h-4 w-4 text-danger" />
                </Button>
            )}
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
            toast.error('Please enter a rule name');
            return;
        }

        const validConditions = conditions.filter(c => c.value.trim());
        if (validConditions.length === 0) {
            toast.error('Please add at least one condition');
            return;
        }

        if (targetMode === 'existing' && !selectedGroupId) {
            toast.error('Please select a target group');
            return;
        }

        if (targetMode === 'new' && !newGroupName.trim()) {
            toast.error('Please enter a new group name');
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
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-bg-1 rounded-lg border border-border w-full max-w-md max-h-[90vh] overflow-auto">
                <div className="flex items-center justify-between p-4 border-b border-border">
                    <h3 className="font-semibold text-text-strong">
                        {rule ? 'Edit Rule' : 'Create New Rule'}
                    </h3>
                    <Button variant="ghost" size="sm" onClick={onCancel}>
                        <X className="h-4 w-4" />
                    </Button>
                </div>

                <form onSubmit={handleSubmit} className="p-4 space-y-4">
                    {/* Rule Name */}
                    <div>
                        <label className="block text-sm font-medium text-text-strong mb-1">
                            Rule Name *
                        </label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="e.g., YouTube Videos"
                            className="w-full px-3 py-2 rounded-md border border-border bg-bg-0 text-text-strong placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/50"
                        />
                    </div>

                    {/* Description */}
                    <div>
                        <label className="block text-sm font-medium text-text-strong mb-1">
                            Description
                        </label>
                        <input
                            type="text"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="Optional description"
                            className="w-full px-3 py-2 rounded-md border border-border bg-bg-0 text-text-strong placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/50"
                        />
                    </div>

                    {/* Conditions */}
                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <label className="block text-sm font-medium text-text-strong">
                                    Conditions *
                                </label>
                                {conditions.length > 1 && (
                                    <div className="flex rounded-md border border-border overflow-hidden">
                                        <button
                                            type="button"
                                            onClick={() => setConditionOperator('AND')}
                                            className={`px-2 py-0.5 text-xs font-medium transition-colors ${conditionOperator === 'AND'
                                                ? 'bg-primary text-white'
                                                : 'bg-bg-0 text-text-muted hover:bg-bg-2'
                                                }`}
                                        >
                                            AND
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setConditionOperator('OR')}
                                            className={`px-2 py-0.5 text-xs font-medium transition-colors ${conditionOperator === 'OR'
                                                ? 'bg-primary text-white'
                                                : 'bg-bg-0 text-text-muted hover:bg-bg-2'
                                                }`}
                                        >
                                            OR
                                        </button>
                                    </div>
                                )}
                            </div>
                            <Button type="button" variant="ghost" size="sm" onClick={handleAddCondition}>
                                <Plus className="h-4 w-4 mr-1" />
                                Add
                            </Button>
                        </div>
                        <p className="text-xs text-text-muted">
                            {conditionOperator === 'AND'
                                ? 'All conditions must match'
                                : 'At least one condition must match'}
                        </p>
                        <div className="space-y-3">
                            {conditions.map((condition, idx) => (
                                <ConditionEditor
                                    key={idx}
                                    condition={condition}
                                    onChange={(c) => handleUpdateCondition(idx, c)}
                                    onRemove={() => handleRemoveCondition(idx)}
                                    canRemove={conditions.length > 1}
                                />
                            ))}
                        </div>
                    </div>

                    {/* Target Group */}
                    <div className="space-y-3">
                        <label className="block text-sm font-medium text-text-strong">
                            Target Group *
                        </label>

                        {/* Mode selector */}
                        <div className="flex gap-2">
                            <Button
                                type="button"
                                variant={targetMode === 'existing' ? 'default' : 'outline'}
                                size="sm"
                                onClick={() => setTargetMode('existing')}
                                disabled={existingGroups.length === 0}
                            >
                                Existing Group
                            </Button>
                            <Button
                                type="button"
                                variant={targetMode === 'new' ? 'default' : 'outline'}
                                size="sm"
                                onClick={() => setTargetMode('new')}
                            >
                                New Group
                            </Button>
                        </div>

                        {targetMode === 'existing' ? (
                            <select
                                value={selectedGroupId}
                                onChange={(e) => setSelectedGroupId(e.target.value)}
                                className="w-full px-3 py-2 rounded-md border border-border bg-bg-0 text-text-strong focus:outline-none focus:ring-2 focus:ring-primary/50"
                            >
                                <option value="">Select a group...</option>
                                {existingGroups.map(group => (
                                    <option key={group.id} value={group.id}>{group.name}</option>
                                ))}
                            </select>
                        ) : (
                            <input
                                type="text"
                                value={newGroupName}
                                onChange={(e) => setNewGroupName(e.target.value)}
                                placeholder="Enter new group name"
                                className="w-full px-3 py-2 rounded-md border border-border bg-bg-0 text-text-strong placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/50"
                            />
                        )}

                        {targetMode === 'new' && (
                            <p className="text-xs text-text-muted">
                                If a group with this name exists, tabs will be added to it. Otherwise, a new group will be created.
                            </p>
                        )}
                    </div>

                    {/* Actions */}
                    <div className="flex justify-end gap-2 pt-4 border-t border-border">
                        <Button type="button" variant="outline" onClick={onCancel}>
                            Cancel
                        </Button>
                        <Button type="submit">
                            {rule ? 'Save Changes' : 'Create Rule'}
                        </Button>
                    </div>
                </form>
            </div>
        </div>
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
                result = new RegExp(condition.value, 'i').test(url);
                break;
            case 'title_contains':
                result = titleLower.includes(value);
                break;
            case 'title_matches_regex':
                result = new RegExp(condition.value, 'i').test(title);
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
                <h3 className="font-medium text-text-strong">Rule Test</h3>
            </div>
            <p className="text-xs text-text-muted mb-3">
                Test which rule would match a given URL and title.
            </p>
            <div className="space-y-3">
                <input
                    type="text"
                    value={testUrl}
                    onChange={(e) => setTestUrl(e.target.value)}
                    placeholder="Enter URL to test (e.g., youtube.com/watch?v=abc)"
                    className="w-full px-3 py-2 rounded-md border border-border bg-bg-0 text-text-strong placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
                <input
                    type="text"
                    value={testTitle}
                    onChange={(e) => setTestTitle(e.target.value)}
                    placeholder="Enter tab title (optional)"
                    className="w-full px-3 py-2 rounded-md border border-border bg-bg-0 text-text-strong placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/50"
                />

                {testResult && (
                    <div className={`p-3 rounded-md border ${testResult.matched ? 'border-success/50 bg-success/10' : 'border-border bg-bg-2'}`}>
                        {testResult.matched ? (
                            <div className="space-y-2">
                                <div className="flex items-center gap-2">
                                    <CheckCircle2 className="h-4 w-4 text-success" />
                                    <span className="text-sm font-medium text-text-strong">
                                        Matched: {testResult.matchedRule?.name}
                                    </span>
                                </div>
                                <p className="text-xs text-text-muted">
                                    → {testResult.matchedRule?.action.newGroupName || 'Target group'}
                                </p>
                                {testResult.allMatches.length > 1 && (
                                    <p className="text-xs text-warning">
                                        ⚠️ {testResult.allMatches.length - 1} other rule(s) also match
                                    </p>
                                )}
                            </div>
                        ) : (
                            <div className="flex items-center gap-2">
                                <XCircle className="h-4 w-4 text-text-muted" />
                                <span className="text-sm text-text-muted">No rules matched</span>
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
                    reason: 'Identical conditions - only the first rule will ever match'
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
                        reason: `"${rule1.name}" matches all ${domain1.value} URLs, making "${rule2.name}" potentially unreachable`
                    });
                }
            }
        }
    }

    return conflicts;
}

// Main Flow Page Component
function FlowPage() {
    const { isPro, isLoading: isAuthLoading } = useAuth();
    const [flowSettings, setFlowSettings] = useState<FlowSettings | null>(null);
    const [importedTemplates, setImportedTemplates] = useState<Set<string>>(new Set());
    const [existingGroups, setExistingGroups] = useState<{ id: string; name: string }[]>([]);
    const [projects, setProjects] = useState<Project[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [showEditor, setShowEditor] = useState(false);
    const [editingRule, setEditingRule] = useState<FlowRule | undefined>(undefined);

    const [sidebarOpen, setSidebarOpen] = useState(() => {
        const saved = localStorage.getItem('bluetab_sidebar_open');
        return saved !== null ? saved === 'true' : true;
    });

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

    const handleSidebarOpenChange = (open: boolean) => {
        setSidebarOpen(open);
        localStorage.setItem('bluetab_sidebar_open', String(open));
    };

    const handleToggleRuleTest = async () => {
        if (!flowSettings) return;
        const newValue = !flowSettings.showRuleTest;
        setFlowSettings(prev => prev ? { ...prev, showRuleTest: newValue } : null);
        await FlowStorageService.setFlowSettings({ ...flowSettings, showRuleTest: newValue });
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
            toast.error('Failed to load Flow settings');
        } finally {
            setIsLoading(false);
        }
    };

    const handleToggleFlow = async (enabled: boolean) => {
        const result = await FlowStorageService.toggleFlow(enabled);
        if (result.success) {
            setFlowSettings(prev => prev ? { ...prev, enabled } : null);
            toast.success(enabled ? 'Flow enabled' : 'Flow disabled');
        } else {
            toast.error('Failed to toggle Flow');
        }
    };

    const handleImportTemplate = async (template: FlowTemplate) => {
        const result = await FlowStorageService.importTemplate(template);
        if (result.success) {
            setImportedTemplates(prev => new Set([...prev, template.id]));
            await loadFlowSettings();
            toast.success(`Added ${template.name} template`);
        } else {
            toast.error(`Failed to add template: ${result.error}`);
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
            toast.success('Template removed');
        } else {
            toast.error('Failed to remove template');
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
            toast.error('Failed to update rule');
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
            toast.success('Rule deleted');
        } else {
            toast.error('Failed to delete rule');
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
            toast.success('Rule duplicated');
        } else {
            toast.error(`Failed to duplicate rule: ${result.error}`);
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
                toast.error('Failed to save rule order');
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
                toast.success('Rule updated');
                setShowEditor(false);
                setEditingRule(undefined);
            } else {
                toast.error(`Failed to update rule: ${result.error}`);
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
                toast.success('Rule created');
                setShowEditor(false);
            } else {
                toast.error(`Failed to create rule: ${result.error}`);
            }
        }
    };

    return (
        <SidebarProvider open={sidebarOpen} onOpenChange={handleSidebarOpenChange}>
            <AppSidebar
                activePage="flow"
                projects={projects}
                onSelectProject={handleSelectProject}
            />
            <SidebarInset>
                <header className="sticky top-0 z-50 flex h-16 shrink-0 items-center justify-between gap-2 border-b border-border px-4 bg-bg-1">
                    <div className="flex items-center gap-2">
                        <SidebarTrigger className="-ml-1" />
                        <Separator orientation="vertical" className="mr-2 h-4" />
                        <div className="flex items-center gap-2">
                            <Zap className="h-5 w-5 text-primary" />
                            <div>
                                <h1 className="text-lg font-semibold text-text-strong">Flow</h1>
                                <p className="text-xs text-text-muted">
                                    {flowSettings?.executionCount || 0} tabs processed
                                </p>
                            </div>
                        </div>
                    </div>
                    {isPro && (
                        <div className="flex items-center gap-3">
                            <Button variant="ghost" size="icon" onClick={loadFlowSettings} disabled={isLoading}>
                                <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
                            </Button>
                            <div className="flex items-center gap-2">
                                <span className="text-sm text-text-muted">
                                    {flowSettings?.enabled ? 'Enabled' : 'Disabled'}
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
                                    <Crown className="h-8 w-8 text-primary" />
                                </div>
                                <h2 className="text-2xl font-bold text-text-strong mb-2">
                                    Coming Soon in Cloud
                                </h2>
                                <p className="text-text-muted mb-6 max-w-md mx-auto">
                                    Automatically organize your tabs with powerful automation rules.
                                    This feature will be available in the upcoming BlueTab Cloud version.
                                </p>
                                <div className="flex items-center justify-center gap-3">
                                    <Button
                                        onClick={() => window.open('https://github.com/supertrydev/bluetab', '_blank')}
                                        className="gap-2"
                                    >
                                        <Crown className="h-4 w-4" />
                                        Learn More
                                    </Button>
                                </div>
                                <div className="mt-8 grid gap-3 sm:grid-cols-3 text-left max-w-lg mx-auto">
                                    <div className="flex items-start gap-2">
                                        <CheckCircle2 className="h-4 w-4 text-success mt-0.5 flex-shrink-0" />
                                        <span className="text-sm text-text-muted">URL-based auto-grouping</span>
                                    </div>
                                    <div className="flex items-start gap-2">
                                        <CheckCircle2 className="h-4 w-4 text-success mt-0.5 flex-shrink-0" />
                                        <span className="text-sm text-text-muted">Platform templates</span>
                                    </div>
                                    <div className="flex items-start gap-2">
                                        <CheckCircle2 className="h-4 w-4 text-success mt-0.5 flex-shrink-0" />
                                        <span className="text-sm text-text-muted">Custom rules</span>
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
                                    <h2 className="text-lg font-semibold text-text-strong">Templates</h2>
                                </div>
                                <p className="text-sm text-text-muted mb-4">
                                    Quick-start with pre-built automation rules for popular platforms.
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
                                        <h2 className="text-lg font-semibold text-text-strong">Active Rules</h2>
                                        <span className="text-sm text-text-muted">
                                            ({flowSettings?.rules.length || 0})
                                        </span>
                                    </div>
                                    <Button onClick={handleCreateRule} size="sm">
                                        <Plus className="h-4 w-4 mr-1" />
                                        Create Rule
                                    </Button>
                                </div>

                                {isLoading ? (
                                    <div className="flex items-center justify-center py-12">
                                        <RefreshCw className="h-6 w-6 animate-spin text-text-muted" />
                                    </div>
                                ) : flowSettings?.rules.length === 0 ? (
                                    <div className="text-center py-12 border border-dashed border-border rounded-lg">
                                        <Zap className="h-8 w-8 text-text-muted mx-auto mb-3" />
                                        <p className="text-text-muted mb-2">No rules yet</p>
                                        <p className="text-sm text-text-muted mb-4">
                                            Add a template above or create a custom rule
                                        </p>
                                        <Button onClick={handleCreateRule} variant="outline" size="sm">
                                            <Plus className="h-4 w-4 mr-1" />
                                            Create Rule
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
                                                        {ruleConflicts.length} conflict{ruleConflicts.length > 1 ? 's' : ''} detected
                                                    </span>
                                                </div>
                                                <ul className="text-xs text-text-muted space-y-1">
                                                    {ruleConflicts.map((conflict, idx) => (
                                                        <li key={idx}>• {conflict.reason}</li>
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
                                <h3 className="font-medium text-text-strong mb-2">How Flow Works</h3>
                                <ul className="text-sm text-text-muted space-y-1">
                                    <li>• When you save tabs, Flow checks each URL against your rules</li>
                                    <li>• Matching tabs are automatically added to the specified group</li>
                                    <li>• Rules are processed in priority order (top to bottom)</li>
                                    <li>• Tabs that don't match any rule go to a new default group</li>
                                </ul>
                            </section>
                        </div>
                    )}
                </div>

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

                <Toaster richColors position="bottom-right" />
            </SidebarInset>
        </SidebarProvider>
    );
}

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(
    <StrictMode>
        <FlowPage />
    </StrictMode>
);
