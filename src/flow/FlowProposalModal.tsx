/**
 * @module flow/FlowProposalModal
 *
 * WHY:  Pro users need a review surface for AI-proposed Flow rules. The modal
 *       persists the last proposal batch across close (same pattern as DistractionScanModal).
 *
 * WHAT: Shared modal-template review surface with:
 *       - Empty-state: "No proposals yet — click Suggest" CTA
 *       - Loading state: spinner while generating
 *       - Cached-results state: proposal cards + batch accept/dismiss footer
 *       - Block-state: inline error per reason (kill switch, allowance, rate limit…)
 *       - Per-proposal: checkbox, name/description, rationale, "Matches N open tabs"
 *         dry-run count (DESIGN-04), expandable matching-tab list, inline editor
 *
 * HOW:  - On open: loads cached results via FlowDesignerService.loadCache()
 *       - "Suggest rules" button: calls FlowDesignerService.propose(token)
 *       - Inline editor updates local editedProposal state (DESIGN-03)
 *       - Accept uses the EDITED proposal shape, not the original
 *       - Zod validation gate via FlowRuleSchema.safeParse inside accept()
 *       - DESIGN-05: max 3 proposals enforced server-side via Zod
 *
 * COPY DISCIPLINE (SAFETY-02):
 *   Phase 9 CI copy-safety grep runs on this file — keep copy neutral and constructive.
 *
 * NOT:  Does NOT render for Free users — caller (flow/main.tsx) gates on isPro.
 *       Does NOT implement undo on accept (DESIGN-08 refined).
 *       Does NOT auto-apply accepted rules (DESIGN-09 refined).
 *       Does NOT modify FlowStorageService or FlowService — uses FlowDesignerService.
 *
 * DESIGN-03: Export buildAcceptPayload() as a pure helper so it is unit-testable
 *   without @testing-library/react. The test asserts that the EDITED shape (not
 *   the original) flows into FlowDesignerService.accept().
 *
 * PROCESS-03: Does NOT touch FlowService or FlowStorageService directly.
 *   FlowDesignerService.accept() calls FlowStorageService.createRule internally.
 */

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Sparkles,
    RefreshCw,
    AlertCircle,
    ChevronDown,
    ChevronRight,
    Check,
    CheckSquare,
    Square,
    Trash2,
} from 'lucide-react';
import { toast } from '@/components/Toast';
import { Button } from '../components/ui/button';
import { ModalTemplate, ModalTemplateSection } from '../components/ui/modal-template';
import { FlowDesignerService } from '../services/flow-designer-service';
import { testRule } from '../services/flow-matcher';
import { useAuth } from '../components/auth/useAuth';
import { getAccessToken } from '../utils/auth-state';
import { useAINotice } from '../components/ai/AINoticeDialog';
import { t as translate } from '@/i18n';
import { isolateBidi } from '@/i18n/bidi';
import type { ProposedFlowRule, ProposalCache } from '../types/distraction';
import type { FlowCondition, FlowConditionType, FlowRule } from '../types/flow';

// ─── buildAcceptPayload — pure helper (exported for DESIGN-03 unit test) ──────

/**
 * Returns the proposal that should be persisted on accept.
 * The UI layer passes the EDITED proposal (after user modifications) here,
 * not the original AI proposal. This indirection makes the invariant testable
 * without mounting the component.
 *
 * DESIGN-03: The unit test imports this and asserts that the edited fields
 * (not the original AI fields) flow into FlowDesignerService.accept().
 */
export function buildAcceptPayload(editedProposal: ProposedFlowRule): ProposedFlowRule {
    return editedProposal;
}

// ─── ProposalAsFlowRule helper ────────────────────────────────────────────────

/**
 * Coerce a ProposedFlowRule into a FlowRule-shaped object for testRule().
 * The preview id/created/modified are synthetic — never persisted.
 */
function proposalAsFlowRule(proposal: ProposedFlowRule): FlowRule {
    return {
        ...proposal,
        id: 'preview-id',
        created: 0,
        modified: 0,
    };
}

// ─── Block reason copy ────────────────────────────────────────────────────────

function getBlockReasonCopy(reason: string): string {
    const lookup: Record<string, string> = {
        kill_switch: translate('flow.proposalModal.blockReasons.kill_switch'),
        backend_error: translate('flow.proposalModal.blockReasons.backend_error'),
        budget: translate('flow.proposalModal.blockReasons.budget'),
        rate_limit: translate('flow.proposalModal.blockReasons.rate_limit'),
        no_permission: translate('flow.proposalModal.blockReasons.no_permission'),
        insufficient_history: translate('flow.proposalModal.blockReasons.insufficient_history'),
    }
    return lookup[reason] ?? translate('flow.proposalModal.genericError')
}

// ─── Relative time helper ─────────────────────────────────────────────────────

function relativeMinutes(ts: number): string {
    const diffMs = Date.now() - ts;
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return translate('time.justNow');
    if (mins < 60) return translate('time.minutesAgo_other', { count: mins });
    const hrs = Math.floor(mins / 60);
    return translate('time.hoursAgo_other', { count: hrs });
}

// ─── Condition type labels (mirrored from flow/main.tsx) ──────────────────────

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

const PROPOSAL_CONTROL_CLASSNAME =
    'w-full rounded-lg border border-border bg-bg-0 px-3 py-2 text-sm text-text-strong shadow-sm ' +
    'placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-0';

const PROPOSAL_SELECT_CLASSNAME = PROPOSAL_CONTROL_CLASSNAME;

// ─── Inline proposal editor (minimal fields form) ────────────────────────────

interface ProposalEditorProps {
    proposal: ProposedFlowRule;
    onChange: (updated: ProposedFlowRule) => void;
}

/**
 * Inline editor rendered inside an expanded proposal card.
 * Covers name, description, EVERY condition type + value, condition operator,
 * action type, new group name. Changes update the parent's editedProposal
 * state so Accept uses the user's version (DESIGN-03).
 */
function ProposalEditor({ proposal, onChange }: ProposalEditorProps) {
    const { t } = useTranslation()
    const conditionTypeLabels = getConditionTypeLabels()

    // Guarantee at least one editable condition row even if the AI returned
    // an empty array (shouldn't happen — server enforces .min(1) — but keep
    // the UI robust).
    const conditions = proposal.conditions.length > 0
        ? proposal.conditions
        : [{
            id: `cond-${Date.now()}`,
            type: 'domain_contains' as FlowConditionType,
            value: '',
        }];

    const updateConditionAt = (index: number, patch: Partial<FlowCondition>) => {
        const updated = conditions.map((c, i) =>
            i === index ? { ...c, ...patch } : c
        );
        onChange({ ...proposal, conditions: updated });
    };

    return (
        <div className="mt-3 space-y-3 border-t border-border-glass pt-3">
            {/* Name */}
            <div>
                <label className="block text-xs font-medium text-text-muted mb-1">{t('flow.proposalModal.ruleName')}</label>
                <input
                    type="text"
                    value={proposal.name}
                    onChange={(e) => onChange({ ...proposal, name: e.target.value })}
                    className={PROPOSAL_CONTROL_CLASSNAME}
                    placeholder={t('flow.proposalModal.ruleNamePlaceholder')}
                    dir="auto"
                />
            </div>

            {/* Description */}
            <div>
                <label className="block text-xs font-medium text-text-muted mb-1">{t('flow.proposalModal.description')}</label>
                <input
                    type="text"
                    value={proposal.description}
                    onChange={(e) => onChange({ ...proposal, description: e.target.value })}
                    className={PROPOSAL_CONTROL_CLASSNAME}
                    placeholder={t('flow.proposalModal.descriptionPlaceholder')}
                    dir="auto"
                />
            </div>

            {/* Condition operator (only shown if multiple conditions) */}
            {proposal.conditions.length > 1 && (
                <div>
                    <label className="block text-xs font-medium text-text-muted mb-1">{t('flow.proposalModal.conditionLogic')}</label>
                    <select
                        value={proposal.conditionOperator ?? 'AND'}
                        onChange={(e) => onChange({ ...proposal, conditionOperator: e.target.value as 'AND' | 'OR' })}
                        className={PROPOSAL_SELECT_CLASSNAME}
                    >
                        <option value="AND">{t('flow.proposalModal.andLabel')}</option>
                        <option value="OR">{t('flow.proposalModal.orLabel')}</option>
                    </select>
                </div>
            )}

            {/* All conditions (one row per proposed condition) */}
            <div className="space-y-3">
                <label className="block text-xs font-medium text-text-muted">
                    {conditions.length === 1
                        ? t('flow.proposalModal.condition')
                        : t('flow.proposalModal.conditionsCount', { count: conditions.length })}
                </label>
                {conditions.map((condition, index) => (
                    <div key={condition.id ?? index} className="space-y-2">
                        {conditions.length > 1 && (
                            <div dir="ltr" className="text-caption text-text-muted">
                                #{index + 1}
                            </div>
                        )}
                        <div className="flex gap-2">
                            <select
                                value={condition.type}
                                onChange={(e) =>
                                    updateConditionAt(index, {
                                        type: e.target.value as FlowConditionType,
                                    })
                                }
                                className={`flex-1 ${PROPOSAL_SELECT_CLASSNAME}`}
                            >
                                {(Object.entries(conditionTypeLabels) as [FlowConditionType, string][]).map(
                                    ([value, label]) => (
                                        <option key={value} value={value}>{label}</option>
                                    )
                                )}
                            </select>
                        </div>
                        <input
                            type="text"
                            value={condition.value}
                            onChange={(e) => updateConditionAt(index, { value: e.target.value })}
                            className={PROPOSAL_CONTROL_CLASSNAME}
                            placeholder={t('flow.placeholders.domain')}
                            dir={condition.type.includes('title') ? 'auto' : 'ltr'}
                        />
                    </div>
                ))}
            </div>

            {/* Action */}
            <div>
                <label className="block text-xs font-medium text-text-muted mb-1">{t('flow.proposalModal.action')}</label>
                <select
                    value={proposal.action.type}
                    onChange={(e) => {
                        const type = e.target.value as ProposedFlowRule['action']['type'];
                        onChange({
                            ...proposal,
                            action: { ...proposal.action, type },
                        });
                    }}
                    className={PROPOSAL_SELECT_CLASSNAME}
                >
                    <option value="add_to_or_create">{t('flow.proposalModal.actions.addToOrCreate')}</option>
                    <option value="create_group">{t('flow.proposalModal.actions.createGroup')}</option>
                    <option value="add_to_existing_group">{t('flow.proposalModal.actions.addToExisting')}</option>
                </select>
            </div>

            {/* New group name (for create_group / add_to_or_create) */}
            {(proposal.action.type === 'create_group' || proposal.action.type === 'add_to_or_create') && (
                <div>
                    <label className="block text-xs font-medium text-text-muted mb-1">{t('flow.proposalModal.groupName')}</label>
                    <input
                        type="text"
                        value={proposal.action.newGroupName ?? ''}
                        onChange={(e) =>
                            onChange({
                                ...proposal,
                                action: { ...proposal.action, newGroupName: e.target.value },
                            })
                        }
                        className={PROPOSAL_CONTROL_CLASSNAME}
                        placeholder={t('flow.proposalModal.groupNamePlaceholder')}
                        dir="auto"
                    />
                </div>
            )}
        </div>
    );
}

// ─── ProposalCard ─────────────────────────────────────────────────────────────

interface ProposalCardProps {
    proposal: ProposedFlowRule;
    index: number;
    openTabs: chrome.tabs.Tab[];
    selected: boolean;
    onToggleSelect: () => void;
    onAccept: (edited: ProposedFlowRule) => void;
    onDismiss: () => void;
}

function ProposalCard({
    proposal,
    openTabs,
    selected,
    onToggleSelect,
    onAccept,
    onDismiss,
}: ProposalCardProps) {
    const { t } = useTranslation()
    const [editedProposal, setEditedProposal] = useState<ProposedFlowRule>(proposal);
    const [expanded, setExpanded] = useState(false);
    const [showMatchingTabs, setShowMatchingTabs] = useState(false);

    // Compute matching tabs count from editedProposal (live, updates as user edits)
    const ruleForPreview = proposalAsFlowRule(editedProposal);
    const matchingTabs = openTabs.filter(
        (tab) => tab.url && testRule(ruleForPreview, { url: tab.url, title: tab.title })
    );
    const matchCount = matchingTabs.length;

    const handleAccept = () => {
        // DESIGN-03: pass editedProposal (the user's version) to accept, not the original
        onAccept(buildAcceptPayload(editedProposal));
    };

    return (
        <div className="relative rounded-xl border border-dashed border-primary/40 bg-bg-1/70 p-4 backdrop-blur-sm shadow-sm">
            {/* "Proposed" badge */}
            <span className="absolute top-2 end-2 text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                {t('flow.proposalModal.proposed')}
            </span>

            {/* Header row: checkbox + name */}
            <div className="flex items-start gap-3 pe-16">
                <button
                    type="button"
                    onClick={onToggleSelect}
                    className="mt-0.5 flex-shrink-0 text-text-muted hover:text-primary transition-colors"
                    aria-label={selected ? t('flow.proposalModal.deselect') : t('flow.proposalModal.select')}
                >
                    {selected ? (
                        <CheckSquare className="h-4 w-4 text-primary" />
                    ) : (
                        <Square className="h-4 w-4" />
                    )}
                </button>

                <div className="flex-1 min-w-0">
                    <h4 className="font-medium text-text-strong"><bdi dir="auto">{editedProposal.name}</bdi></h4>
                    {editedProposal.description && (
                        <p dir="auto" className="text-xs text-text-muted mt-0.5">{editedProposal.description}</p>
                    )}
                    {/* Rationale */}
                    <p dir="auto" className="text-xs text-text-muted mt-1 italic">
                        {editedProposal.rationale}
                    </p>
                </div>
            </div>

            {/* Dry-run count (DESIGN-04) */}
            <div className="mt-3 ms-7">
                <button
                    type="button"
                    onClick={() => setShowMatchingTabs((v) => !v)}
                    className="text-xs text-primary hover:underline flex items-center gap-1"
                >
                    {showMatchingTabs ? (
                        <ChevronDown className="h-3 w-3" />
                    ) : (
                        <ChevronRight className="h-3 w-3 rtl:rotate-180" />
                    )}
                    {t('flow.proposalModal.matchesOpenTabs', { count: matchCount })}
                </button>

                {/* Expandable matching tab list */}
                {showMatchingTabs && matchCount > 0 && (
                    <div className="mt-2 max-h-48 overflow-y-auto space-y-1 rounded-md border border-border-glass bg-bg-0/70 p-2 backdrop-blur-sm">
                        {matchingTabs.map((tab, i) => (
                            <div key={tab.id ?? i} className="flex items-center gap-2 text-xs text-text-muted">
                                {tab.favIconUrl ? (
                                    <img
                                        src={tab.favIconUrl}
                                        alt=""
                                        className="h-4 w-4 flex-shrink-0 rounded-sm"
                                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                    />
                                ) : (
                                    <div className="h-4 w-4 flex-shrink-0 rounded-sm bg-bg-2" />
                                )}
                                <span className="truncate"><bdi dir={tab.title ? 'auto' : 'ltr'}>{tab.title || tab.url}</bdi></span>
                            </div>
                        ))}
                    </div>
                )}
                {showMatchingTabs && matchCount === 0 && (
                    <p className="mt-1 text-xs text-text-muted">{t('flow.proposalModal.noMatchesNow')}</p>
                )}
            </div>

            {/* Expand chevron for inline editor */}
            <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="mt-3 ms-7 flex items-center gap-1 text-xs text-text-muted hover:text-text-strong transition-colors"
            >
                {expanded ? (
                    <ChevronDown className="h-3 w-3" />
                ) : (
                    <ChevronRight className="h-3 w-3 rtl:rotate-180" />
                )}
                {expanded ? t('flow.proposalModal.collapseEditor') : t('flow.proposalModal.editRule')}
            </button>

            {/* Inline editor (DESIGN-06) */}
            {expanded && (
                <div className="ms-7">
                    <ProposalEditor
                        proposal={editedProposal}
                        onChange={setEditedProposal}
                    />
                </div>
            )}

            {/* Per-card footer: Accept + Dismiss */}
            <div className="mt-4 ms-7 flex items-center gap-2">
                <Button size="sm" onClick={handleAccept} className="gap-1">
                    <Check className="h-3 w-3" />
                    {t('flow.proposalModal.accept')}
                </Button>
                <Button size="sm" variant="ghost" onClick={onDismiss} className="text-text-muted gap-1">
                    <Trash2 className="h-3 w-3" />
                    {t('flow.proposalModal.dismiss')}
                </Button>
            </div>
        </div>
    );
}

// ─── FlowProposalModal (main export) ─────────────────────────────────────────

interface FlowProposalModalProps {
    open: boolean;
    onClose: () => void;
    /**
     * Notification hook — fired after a proposal is accepted so the parent
     * Flow workspace can reload its rule list without waiting for a refresh.
     * Optional for backwards compatibility.
     */
    onRulesChanged?: () => void;
}

/**
 * FlowProposalModal — AI Flow Rule proposal review modal.
 *
 * Opened by the "Suggest rules (AI)" button in flow/main.tsx (Pro users only).
 * Props: { open, onClose, onRulesChanged? }
 */
export function FlowProposalModal({ open, onClose, onRulesChanged }: FlowProposalModalProps) {
    const { t } = useTranslation()
    // user is unused directly but kept for potential future Pro-gating reads
    useAuth();

    const [cache, setCache] = useState<ProposalCache | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [blockReason, setBlockReason] = useState<string | null>(null);
    const { showNoticeOnce, noticeDialog } = useAINotice();
    const [openTabs, setOpenTabs] = useState<chrome.tabs.Tab[]>([]);
    const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
    // editedProposals tracks per-proposal edits keyed by original proposal index
    const [editedProposals, setEditedProposals] = useState<Map<number, ProposedFlowRule>>(new Map());

    // Load cache + open tabs when the modal opens
    useEffect(() => {
        if (!open) return;

        (async () => {
            const cached = await FlowDesignerService.loadCache();
            setCache(cached);

            const tabs = await chrome.tabs.query({});
            setOpenTabs(tabs);
        })();
    }, [open]);

    const handleSuggest = async () => {
        // Open tabs, recent groups and visit totals go to Bluetab AI: one-time data notice first.
        await showNoticeOnce();

        setIsLoading(true);
        setBlockReason(null);

        // Decrypt the Supertry access token before each request — it lives
        // AES-GCM-encrypted in chrome.storage.local, so we cannot read it as a
        // plain string via useAuth().user.
        const token = await getAccessToken();
        if (!token) {
            setBlockReason('no_permission');
            setIsLoading(false);
            return;
        }

        const result = await FlowDesignerService.propose(token);

        if (result.status === 'blocked') {
            setBlockReason(result.reason);
            setIsLoading(false);
            return;
        }

        setCache(result.cache);
        setSelectedIndices(new Set());
        setEditedProposals(new Map());
        // Refresh open tabs
        const tabs = await chrome.tabs.query({});
        setOpenTabs(tabs);
        setIsLoading(false);
    };

    const handleAcceptProposal = async (index: number, edited: ProposedFlowRule) => {
        const result = await FlowDesignerService.accept(edited);
        if (!result.success) {
            toast.error(t('flow.proposalModal.acceptError', { message: isolateBidi(result.error) }));
            return;
        }
        toast.success(t('flow.proposalModal.ruleAdded', { name: isolateBidi(edited.name) }));
        onRulesChanged?.();

        // Refresh cache state
        const updated = await FlowDesignerService.loadCache();
        setCache(updated);
        setSelectedIndices((prev) => {
            const next = new Set(prev);
            next.delete(index);
            return next;
        });

        if (!updated || updated.proposals.length === 0) {
            onClose();
        }
    };

    const handleDismissProposal = async (index: number) => {
        await FlowDesignerService.dismiss(index);
        const updated = await FlowDesignerService.loadCache();
        setCache(updated);
        setSelectedIndices((prev) => {
            const next = new Set(prev);
            next.delete(index);
            return next;
        });
    };

    const handleAcceptSelected = async () => {
        const indices = Array.from(selectedIndices).sort((a, b) => b - a); // descending
        let acceptedCount = 0;
        for (const idx of indices) {
            const edited = editedProposals.get(idx) ?? cache!.proposals[idx];
            const result = await FlowDesignerService.accept(edited);
            if (result.success) {
                acceptedCount++;
            } else {
                toast.error(t('flow.proposalModal.acceptOneError', {
                    name: isolateBidi(edited.name),
                    message: isolateBidi(result.error),
                }));
            }
        }
        if (acceptedCount > 0) {
            toast.success(t('flow.proposalModal.acceptedCount', { count: acceptedCount }));
            onRulesChanged?.();
        }
        const updated = await FlowDesignerService.loadCache();
        setCache(updated);
        setSelectedIndices(new Set());
        if (!updated || updated.proposals.length === 0) {
            onClose();
        }
    };

    const handleDismissSelected = async () => {
        // Dismiss in descending index order so earlier indices remain stable
        const indices = Array.from(selectedIndices).sort((a, b) => b - a);
        for (const idx of indices) {
            await FlowDesignerService.dismiss(idx);
        }
        toast.success(t('flow.proposalModal.removedCount', { count: indices.length }));
        const updated = await FlowDesignerService.loadCache();
        setCache(updated);
        setSelectedIndices(new Set());
    };

    const handleClearAll = async () => {
        await FlowDesignerService.clearCache();
        setCache(null);
        setSelectedIndices(new Set());
        setEditedProposals(new Map());
    };

    const toggleSelect = (index: number) => {
        setSelectedIndices((prev) => {
            const next = new Set(prev);
            if (next.has(index)) {
                next.delete(index);
            } else {
                next.add(index);
            }
            return next;
        });
    };

    const proposals = cache?.proposals ?? [];
    const hasProposals = proposals.length > 0;
    const selectedCount = selectedIndices.size;
    const headerTrailing = cache ? (
        <>
            <span className="hidden text-xs text-text-muted sm:inline">
                {t('flow.proposalModal.lastGenerated', { time: relativeMinutes(cache.generatedAt) })}
            </span>
            <Button
                size="sm"
                variant="outline"
                onClick={handleSuggest}
                disabled={isLoading}
                className="gap-1"
            >
                <RefreshCw className={`h-3 w-3 ${isLoading ? 'animate-spin' : ''}`} />
                {t('flow.proposalModal.regenerate')}
            </Button>
        </>
    ) : undefined;

    return (
        <ModalTemplate
            open={open}
            onOpenChange={(nextOpen) => {
                if (!nextOpen) {
                    onClose();
                }
            }}
            className="sm:max-w-2xl"
            heading={t('flow.proposalModal.heading')}
            description={t('flow.proposalModal.descriptionText')}
            titleIcon={<Sparkles className="h-5 w-5 text-primary" />}
            headerTrailing={headerTrailing}
            bodyClassName="min-h-0 space-y-4 scrollbar-transparent"
            footer={!isLoading && hasProposals ? (
                <div className="flex w-full items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                        <Button
                            size="sm"
                            onClick={handleAcceptSelected}
                            disabled={selectedCount === 0}
                            className="gap-1"
                        >
                            <Check className="h-3 w-3" />
                            {selectedCount > 0
                                ? t('flow.proposalModal.acceptCount', { count: selectedCount })
                                : t('flow.proposalModal.accept')}
                        </Button>
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={handleDismissSelected}
                            disabled={selectedCount === 0}
                            className="gap-1"
                        >
                            <Trash2 className="h-3 w-3" />
                            {selectedCount > 0
                                ? t('flow.proposalModal.dismissCount', { count: selectedCount })
                                : t('flow.proposalModal.dismiss')}
                        </Button>
                    </div>
                    <Button
                        size="sm"
                        variant="ghost"
                        onClick={handleClearAll}
                        className="text-text-muted"
                    >
                        {t('flow.proposalModal.clearAll')}
                    </Button>
                </div>
            ) : undefined}
        >
            {noticeDialog}
            {isLoading && (
                <div className="flex flex-col items-center justify-center py-16 gap-3">
                    <RefreshCw className="h-8 w-8 animate-spin text-primary" />
                    <p className="text-sm text-text-muted">{t('flow.proposalModal.loading')}</p>
                </div>
            )}

            {!isLoading && blockReason && (
                <ModalTemplateSection tone="warning" className="rounded-lg">
                    <div className="flex items-start gap-3">
                        <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-warning" />
                        <p className="text-sm text-text-strong">
                            {getBlockReasonCopy(blockReason)}
                        </p>
                    </div>
                </ModalTemplateSection>
            )}

            {!isLoading && !blockReason && !hasProposals && (
                <div className="flex flex-col items-center justify-center py-12 gap-4 text-center">
                    <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
                        <Sparkles className="h-7 w-7 text-primary" />
                    </div>
                    <div>
                        <h3 className="font-medium text-text-strong mb-1">
                            {t('flow.proposalModal.emptyTitle')}
                        </h3>
                        <p className="mx-auto max-w-xs text-sm text-text-muted">
                            {t('flow.proposalModal.emptyDescription')}
                        </p>
                    </div>
                    <Button onClick={handleSuggest} className="gap-2" disabled={isLoading}>
                        <Sparkles className="h-4 w-4" />
                        {t('flow.proposalModal.suggestRules')}
                    </Button>
                </div>
            )}

            {!isLoading && hasProposals && proposals.map((proposal, index) => (
                <ProposalCard
                    key={`${proposal.name}-${index}`}
                    proposal={proposal}
                    index={index}
                    openTabs={openTabs}
                    selected={selectedIndices.has(index)}
                    onToggleSelect={() => toggleSelect(index)}
                    onAccept={(edited) => handleAcceptProposal(index, edited)}
                    onDismiss={() => handleDismissProposal(index)}
                />
            ))}
        </ModalTemplate>
    );
}
