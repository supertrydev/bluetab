/**
 * @module sidepanel/components/TeamsChatPanel
 *
 * WHY:  Ephemeral in-session chat. Collapsed by default to preserve sidepanel
 *       space. Unread badge motivates users to expand without being intrusive.
 *
 * WHAT: - Collapsible trigger: "Chat" label + unread badge + chevron
 *       - First open: dismissible disclaimer "Messages are temporary and not saved"
 *       - Scrollable message list with auto-scroll to newest message
 *       - Auto-linked URLs in message text (regex-based)
 *       - Text input + Send button (Enter key shortcut); disabled when not connected
 *
 * HOW:  @radix-ui/react-collapsible for expand/collapse.
 *       linkifyText() helper splits text on URL pattern and returns React nodes.
 *
 * NOT:  Does not manage chat state — receives messages and callbacks as props.
 *       Disclaimer reset happens per session (local state only, not persisted).
 */

import { formatTime as formatClockTime } from '@/i18n/format'
import { useState, useEffect, useRef } from 'react'
import { MessageCircle, ChevronDown, X, Info, Send } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import type { TeamsChatMessage } from '@/types/teams'

// ─── URL auto-linking helper ──────────────────────────────────────────────────

const URL_REGEX = /(https?:\/\/[^\s]+)/g

function linkifyText(text: string): React.ReactNode[] {
    const parts = text.split(URL_REGEX)
    return parts.map((part, i) => {
        if (URL_REGEX.test(part)) {
            // Reset lastIndex after test (stateful regex)
            URL_REGEX.lastIndex = 0
            return (
                <a
                    key={i}
                    dir="ltr"
                    href={part}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline break-all"
                    onClick={(e) => {
                        e.preventDefault()
                        chrome.tabs.create({ url: part }).catch(() => {})
                    }}
                >
                    {part}
                </a>
            )
        }
        URL_REGEX.lastIndex = 0
        return part
    })
}

// ─── Timestamp formatter ─────────────────────────────────────────────────────

// Shared formatter: app locale + Settings > Time format.
function formatTime(timestamp: number): string {
    return formatClockTime(timestamp)
}

// ─── Component ────────────────────────────────────────────────────────────────

interface TeamsChatPanelProps {
    chatMessages: TeamsChatMessage[]
    unreadCount: number
    isConnected: boolean
    onSendChat: (text: string) => void
    onMarkRead: () => void
}

export function TeamsChatPanel({
    chatMessages,
    unreadCount,
    isConnected,
    onSendChat,
    onMarkRead,
}: TeamsChatPanelProps) {
    const { t } = useTranslation()
    const [isOpen, setIsOpen] = useState(false)
    const [disclaimerDismissed, setDisclaimerDismissed] = useState(false)
    const [inputText, setInputText] = useState('')
    const messagesEndRef = useRef<HTMLDivElement>(null)
    const inputRef = useRef<HTMLInputElement>(null)

    // Mark chat read when panel opens
    const handleOpenChange = (open: boolean) => {
        setIsOpen(open)
        if (open) {
            onMarkRead()
        }
    }

    // Auto-scroll to bottom when new messages arrive (only when open)
    useEffect(() => {
        if (isOpen) {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
        }
    }, [chatMessages, isOpen])

    // Focus input when panel opens
    useEffect(() => {
        if (isOpen) {
            setTimeout(() => inputRef.current?.focus(), 100)
        }
    }, [isOpen])

    const handleSend = () => {
        const text = inputText.trim()
        if (!text || !isConnected) return
        onSendChat(text)
        setInputText('')
    }

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            handleSend()
        }
    }

    return (
        <Collapsible
            open={isOpen}
            onOpenChange={handleOpenChange}
            data-testid="teams-chat-panel"
            data-open={isOpen ? 'true' : 'false'}
            className={cn(
                'flex min-h-0 flex-col bg-background',
                isOpen && 'flex-1'
            )}
        >
            {/* Trigger row */}
            <CollapsibleTrigger asChild>
                <button
                    type="button"
                    data-testid="teams-chat-trigger"
                    className="flex w-full items-center gap-2 border-t border-border bg-background/95 px-3 py-2 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                    <MessageCircle className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <span className="flex-1 text-start">{t('sidepanel.teamsChat.label')}</span>

                    {/* Unread badge — only show when collapsed */}
                    {unreadCount > 0 && !isOpen && (
                        <span dir="ltr" className="bg-primary text-primary-foreground text-xs rounded-full px-1.5 min-w-[18px] h-[18px] flex items-center justify-center font-medium">
                            {unreadCount > 99 ? '99+' : unreadCount}
                        </span>
                    )}

                    <ChevronDown
                        className={cn(
                            'w-4 h-4 text-muted-foreground transition-transform flex-shrink-0',
                            isOpen && 'rotate-180'
                        )}
                    />
                </button>
            </CollapsibleTrigger>

            <CollapsibleContent className={cn('min-h-0 overflow-hidden', isOpen && 'flex flex-1 flex-col')}>
                <div className="flex min-h-0 flex-1 flex-col border-t border-border">

                    {/* Disclaimer — shown once per session on first open */}
                    {!disclaimerDismissed && (
                        <div className="flex items-start gap-2 px-3 py-2 bg-muted/50 border-b border-border">
                            <Info className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
                            <p className="flex-1 text-xs text-muted-foreground">
                                {t('sidepanel.teamsChat.disclaimer')}
                            </p>
                            <button
                                onClick={() => setDisclaimerDismissed(true)}
                                className="flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                                aria-label={t('sidepanel.teamsChat.dismiss')}
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    )}

                    {/* Message list */}
                    <div
                        data-testid="teams-chat-messages"
                        className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2 scrollbar-transparent"
                    >
                        {chatMessages.length === 0 ? (
                            <p className="text-xs text-muted-foreground text-center py-2">
                                {t('sidepanel.teamsChat.empty')}
                            </p>
                        ) : (
                            chatMessages.map((msg, idx) => (
                                <div key={idx} className="flex flex-col gap-0.5">
                                    <div className="flex items-baseline gap-1.5">
                                        <bdi dir="auto" className="text-xs font-semibold text-foreground">
                                            {msg.senderName}
                                        </bdi>
                                        <span dir="ltr" className="text-micro text-muted-foreground">
                                            {formatTime(msg.timestamp)}
                                        </span>
                                    </div>
                                    <p dir="auto" className="text-xs text-foreground/90 break-words leading-relaxed">
                                        {linkifyText(msg.text)}
                                    </p>
                                </div>
                            ))
                        )}
                        <div ref={messagesEndRef} />
                    </div>

                    {/* Input area */}
                    <div
                        data-testid="teams-chat-composer"
                        className="flex flex-shrink-0 items-center gap-1.5 border-t border-border px-3 py-2"
                    >
                        <input
                            ref={inputRef}
                            data-testid="teams-chat-input"
                            type="text"
                            dir="auto"
                            value={inputText}
                            onChange={(e) => setInputText(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder={isConnected ? t('sidepanel.teamsChat.inputPlaceholder') : t('sidepanel.teamsChat.notConnected')}
                            disabled={!isConnected}
                            className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                        />
                        <button
                            onClick={handleSend}
                            disabled={!isConnected || !inputText.trim()}
                            className="flex-shrink-0 p-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            aria-label={t('sidepanel.teamsChat.send')}
                        >
                            <Send className="w-3.5 h-3.5" />
                        </button>
                    </div>
                </div>
            </CollapsibleContent>
        </Collapsible>
    )
}
