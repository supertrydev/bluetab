/**
 * @module sidepanel/components/AIChatThread
 *
 * WHY:  Renders the AI chat conversation for Pro users in the sidepanel AI tab.
 *       Uses @assistant-ui/react-ui Thread component with AI SDK v6 runtime bridge.
 *
 * WHAT: Chat thread component providing:
 *       - Full Thread UI from @assistant-ui/react-ui with markdown rendering
 *       - Bluetab brand avatar as assistant avatar
 *       - Welcome message with suggestion prompts
 *       - ConfirmationCard overlay for destructive tool calls (archive/delete)
 *       - Inline error display for API failures
 *
 * HOW:  Accepts the chat object from useAIChat. Bridges to @assistant-ui via
 *       useAISDKRuntime (takes existing useChat return). ThreadConfigProvider
 *       customizes avatar, welcome, and markdown rendering.
 *
 * NOT:  Does not handle the Pro gate — AIPanel handles that.
 *       Does not execute tool calls — useAIChat does that.
 */

import { useState, useEffect, useMemo } from 'react';
import { AssistantRuntimeProvider, MessagePrimitive, useThread } from '@assistant-ui/react';
import { useAISDKRuntime } from '@assistant-ui/react-ai-sdk';
import {
  AssistantActionBar,
  AssistantMessage,
  BranchPicker,
  Composer,
  Thread,
  UserActionBar,
  UserMessage,
  makeMarkdownText,
  useThreadConfig,
} from '@assistant-ui/react-ui';
import { AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ConfirmationCard } from './ConfirmationCard';
import { AI_REPLY_PHASE, type UseAIChatReturn } from '../hooks/useAIChat';
import { TOOL_LOADING_MESSAGES } from '@/utils/ai-tools';
import { toolLoopNotice } from '@/utils/ai-tool-loop';
import { getAuthState } from '@/utils/auth-state';
import bluetabAvatar from '@/assets/bluetab-avatar.png';

// ============================================================================
// Markdown text renderer for assistant messages
// ============================================================================

const MarkdownText = makeMarkdownText();

// ============================================================================
// Fun greeting messages — picked randomly on each mount
// ============================================================================

const GREETINGS_WITH_NAME = [
  'sidepanel.aiChatThread.greetings.withName.0',
  'sidepanel.aiChatThread.greetings.withName.1',
  'sidepanel.aiChatThread.greetings.withName.2',
  'sidepanel.aiChatThread.greetings.withName.3',
] as const;
const GREETINGS_ANONYMOUS = [
  'sidepanel.aiChatThread.greetings.anonymous.0',
  'sidepanel.aiChatThread.greetings.anonymous.1',
  'sidepanel.aiChatThread.greetings.anonymous.2',
  'sidepanel.aiChatThread.greetings.anonymous.3',
] as const;

/**
 * Picks one greeting per mount. The variant and the user's first name are
 * resolved once (one auth read); translation happens at render so a language
 * change still applies. Previously the effect depended on arrays rebuilt every
 * render, so it re-read auth and re-rolled the greeting on each streamed token.
 */
function useRandomGreeting(): string {
  const { t } = useTranslation();
  const [variant] = useState(() => Math.floor(Math.random() * GREETINGS_ANONYMOUS.length));
  const [firstName, setFirstName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAuthState().then((auth) => {
      if (!cancelled) setFirstName(auth.user?.name?.split(/\s+/)[0] || null);
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return firstName
    ? t(GREETINGS_WITH_NAME[variant], { name: firstName })
    : t(GREETINGS_ANONYMOUS[variant]);
}

// ============================================================================
// Types
// ============================================================================

interface AIChatThreadProps {
  /** Result of useAIChat() — contains messages, sendMessage, status, etc. */
  aiChat: UseAIChatReturn;
}

function ComposerWithSafetyNote() {
  const { t } = useTranslation();
  const { composer: { allowAttachments = true } = {} } = useThreadConfig();
  const attachmentsSupported = useThread((thread) => thread.capabilities.attachments);
  const showAttachments = allowAttachments && attachmentsSupported;

  return (
    <div className="flex w-full flex-col">
      <Composer.Root>
        {showAttachments && <Composer.Attachments />}
        {showAttachments && <Composer.AddAttachment />}
        <Composer.Input dir="auto" autoFocus />
        <Composer.Action />
      </Composer.Root>
      <div className="px-2 pt-1">
        <p
          className="block w-full truncate text-center text-micro leading-none text-text-muted"
          title={t('sidepanel.aiChatThread.safetyNote')}
        >
          {t('sidepanel.aiChatThread.safetyNote')}
        </p>
      </div>
    </div>
  );
}

function DirectionAwareUserMessage() {
  return (
    <UserMessage.Root>
      <UserMessage.Attachments />
      <MessagePrimitive.If hasContent>
        <UserActionBar />
        <UserMessage.Content dir="auto" />
      </MessagePrimitive.If>
      <BranchPicker />
    </UserMessage.Root>
  );
}

function DirectionAwareAssistantMessage() {
  return (
    <AssistantMessage.Root>
      <AssistantMessage.Avatar />
      <AssistantMessage.Content dir="auto" />
      <BranchPicker />
      <AssistantActionBar />
    </AssistantMessage.Root>
  );
}

// ============================================================================
// Inner component — renders inside AssistantRuntimeProvider
// ============================================================================

function ChatThreadInner({ aiChat }: AIChatThreadProps) {
  const { t } = useTranslation();
  const { error, isLoading, pendingConfirmation, confirmAction, cancelAction, currentToolName, toolLoopStopped } = aiChat;
  const greeting = useRandomGreeting();
  // Stable between tokens so the Thread welcome props do not change identity.
  const suggestions = useMemo(() => [
    {
      text: t('sidepanel.aiChatThread.suggestions.whatCanYouDo.text'),
      prompt: t('sidepanel.aiChatThread.suggestions.whatCanYouDo.prompt'),
    },
    {
      text: t('sidepanel.aiChatThread.suggestions.groupTabs.text'),
      prompt: t('sidepanel.aiChatThread.suggestions.groupTabs.prompt'),
    },
    {
      text: t('sidepanel.aiChatThread.suggestions.organizeGroups.text'),
      prompt: t('sidepanel.aiChatThread.suggestions.organizeGroups.prompt'),
    },
  ], [t]);

  // Derive action-specific loading message text (localized; English map as fallback)
  const loadingMessage = isLoading
    ? (currentToolName === AI_REPLY_PHASE
        ? t('sidepanel.aiChatThread.writingReply')
        : currentToolName
        ? t(`sidepanel.aiChatThread.toolLoading.${currentToolName}`, {
            defaultValue: TOOL_LOADING_MESSAGES[currentToolName] ?? t('sidepanel.aiChatThread.working'),
          })
        : t('sidepanel.aiChatThread.thinking'))
    : null;

  return (
    <div
      className="h-full flex flex-col overflow-hidden"
      data-loading={isLoading ? 'true' : undefined}
      // JSON.stringify yields a valid quoted CSS string even when a translation contains quotes.
      style={loadingMessage ? { '--aui-loading-text': JSON.stringify(loadingMessage) } as React.CSSProperties : undefined}
    >
      {/* Thread fills available space */}
      <div className="flex-1 min-h-0">
        <Thread
          assistantAvatar={{
            src: bluetabAvatar,
            fallback: 'B',
          }}
          welcome={{
            message: greeting,
            suggestions,
          }}
          assistantMessage={{
            allowCopy: true,
            allowReload: true,
            components: {
              Text: MarkdownText,
            },
          }}
          components={{
            AssistantMessage: DirectionAwareAssistantMessage,
            Composer: ComposerWithSafetyNote,
            UserMessage: DirectionAwareUserMessage,
          }}
          strings={{
            composer: {
              input: { placeholder: t('sidepanel.aiChatThread.inputPlaceholder') },
            },
          }}
        />
      </div>

      {/* Confirmation card for destructive actions — outside scroll container */}
      {pendingConfirmation && (
        <div className="px-3 pb-2">
          <ConfirmationCard
            tabs={pendingConfirmation.affectedItems}
            toolName={pendingConfirmation.toolName}
            projectMeta={pendingConfirmation.projectMeta}
            integrationName={pendingConfirmation.integrationName}
            onConfirm={() => confirmAction()}
            onAlwaysAllow={
              pendingConfirmation.toolName === 'integration_action' && pendingConfirmation.allowAlwaysAllow !== false
                ? () => confirmAction({ alwaysAllowIntegrations: true })
                : undefined
            }
            onCancel={cancelAction}
            isResolved={pendingConfirmation.status !== 'pending'}
            resolvedStatus={
              pendingConfirmation.status === 'pending'
                ? undefined
                : pendingConfirmation.status
            }
          />
        </div>
      )}

      {/* Error display */}
      {toolLoopStopped && !isLoading && !error && (
        <div className="mx-3 mb-2 rounded-md border border-border bg-bg-1 px-3 py-2 text-xs text-text-muted" role="status">
          {(() => {
            const notice = toolLoopNotice(toolLoopStopped);
            return t(notice.key, { ...notice.params, defaultValue: t('sidepanel.aiChatThread.toolLoopStopped') });
          })()}
        </div>
      )}

      {error && !isLoading && (
        <div className="flex items-start gap-2 p-2 mx-3 mb-2 rounded-md bg-danger-muted border border-danger/30">
          <AlertCircle className="w-3.5 h-3.5 text-danger shrink-0 mt-0.5" />
          <p className="text-caption text-danger leading-relaxed">
            {error.message || t('sidepanel.aiChatThread.errorFallback')}
          </p>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Exported component — wraps inner thread with AssistantRuntimeProvider
// ============================================================================

export function AIChatThread({ aiChat }: AIChatThreadProps) {
  // useAISDKRuntime bridges an EXISTING useChat instance to @assistant-ui runtime.
  // (useChatRuntime creates its own useChat — wrong for our custom hook)
  const runtime = useAISDKRuntime(aiChat.chat);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ChatThreadInner aiChat={aiChat} />
    </AssistantRuntimeProvider>
  );
}
