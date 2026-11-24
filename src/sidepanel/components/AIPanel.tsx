/**
 * @module sidepanel/components/AIPanel
 *
 * WHY:  Root component for the AI tab in the sidepanel. Gates access based
 *       on Pro subscription status and renders the appropriate UI.
 *
 * WHAT: The AI tab root component that:
 *       - Checks Pro status via useAuth()
 *       - Shows AIUpgradePrompt for non-Pro users
 *       - Shows a one-time AI data notice (AINoticeDialog) the first time it opens
 *       - Shows thread list + AIChatThread for Pro users
 *       - Manages the shared useAIChat hook instance
 *
 * HOW:  Uses useAuth() for Pro gate. Mounts useAIChat() only for Pro users
 *       to avoid unnecessary transport initialization.
 *
 * NOT:  Does not handle authentication — that is useAuth.ts.
 *       Does not execute tool calls — that is useAIChat.ts.
 */

import { useState, useCallback, useEffect } from 'react';
import { useAuth } from '@/components/auth/useAuth';
import { formatDate } from '@/i18n/format';
import { AIUpgradePrompt } from './AIUpgradePrompt';
import { AIChatThread } from './AIChatThread';
import { useAIChat } from '../hooks/useAIChat';
import { Button } from '@/components/ui/button';
import { useAINotice } from '@/components/ai/AINoticeDialog';
import { Loader2, Plus, MessageSquare, Trash2, ChevronLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// ============================================================================
// Pro panel — only rendered when user is confirmed Pro
// ============================================================================

function ProAIPanel() {
  const { t } = useTranslation();
  const aiChat = useAIChat();
  const [showThreadList, setShowThreadList] = useState(false);

  const { newChat } = aiChat;
  const handleNewChat = useCallback(async () => {
    await newChat();
    setShowThreadList(false);
  }, [newChat]);

  // Thread list view
  if (showThreadList) {
    return (
      <div className="h-full flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
          <button
            onClick={() => setShowThreadList(false)}
            className="flex items-center gap-1 text-xs text-text-muted hover:text-text-strong transition-colors"
          >
            <ChevronLeft className="w-3.5 h-3.5 rtl:rotate-180" />
            {t('sidepanel.aiPanel.back')}
          </button>
          <span className="text-xs font-medium text-text-strong">{t('sidepanel.aiPanel.chatHistory')}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleNewChat}
            className="h-7 w-7 p-0 text-text-muted hover:text-text-strong"
            title={t('sidepanel.aiPanel.newChat')}
          >
            <Plus className="w-4 h-4" />
          </Button>
        </div>

        {/* Thread list */}
        <div className="flex-1 overflow-y-auto scrollbar-transparent px-2 py-2 space-y-1">
          {aiChat.threads.map((thread) => (
            <div
              key={thread.id}
              className={`group flex items-center gap-2 px-2.5 py-2 rounded-md cursor-pointer transition-colors ${
                thread.id === aiChat.activeThreadId
                  ? 'bg-primary-muted text-text-strong'
                  : 'hover:bg-bg-1 text-text-default'
              }`}
              onClick={() => {
                aiChat.switchThread(thread.id);
                setShowThreadList(false);
              }}
            >
              <MessageSquare className="w-3.5 h-3.5 shrink-0 text-text-muted" />
              <div className="flex-1 min-w-0">
                <p className="text-xs truncate"><bdi dir="auto">{thread.title}</bdi></p>
                <p className="text-xs text-text-muted">
                  <span dir="ltr">{formatDate(thread.modified, { day: 'numeric', month: 'short' })}</span>
                  {' · '}
                  {t('sidepanel.aiPanel.messages', { count: thread.messages.length })}
                </p>
              </div>
              {aiChat.threads.length > 1 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    aiChat.deleteThread(thread.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded-full text-text-muted hover:text-danger transition-all"
                  title={t('sidepanel.aiPanel.deleteChat')}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Chat view
  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Mini toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border">
        <button
          onClick={() => setShowThreadList(true)}
          className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-strong transition-colors"
          title={t('sidepanel.aiPanel.chatHistory')}
        >
          <MessageSquare className="w-3.5 h-3.5" />
          <span className="truncate max-w-[120px]">
            <bdi dir="auto">
              {aiChat.threads.find((thread) => thread.id === aiChat.activeThreadId)?.title ?? t('sidepanel.aiPanel.chat')}
            </bdi>
          </span>
        </button>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleNewChat}
          className="h-6 w-6 p-0 text-text-muted hover:text-text-strong"
          title={t('sidepanel.aiPanel.newChat')}
        >
          <Plus className="w-3.5 h-3.5" />
        </Button>
      </div>

      <AIChatThread key={aiChat.activeThreadId} aiChat={aiChat} />
    </div>
  );
}

// ============================================================================
// One-time AI data notice, shown the first time the AI tab opens
// ============================================================================

function ProAIPanelWithNotice() {
  const { showNoticeOnce, noticeDialog } = useAINotice();

  useEffect(() => {
    void showNoticeOnce();
  }, [showNoticeOnce]);

  return (
    <>
      <ProAIPanel />
      {noticeDialog}
    </>
  );
}

// ============================================================================
// Root component
// ============================================================================

export function AIPanel() {
  const { isPro, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {isPro ? <ProAIPanelWithNotice /> : <AIUpgradePrompt />}
    </div>
  );
}
