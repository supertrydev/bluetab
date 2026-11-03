import { sendOffscreenMessage } from '@/platform/offscreen-bridge'
import { config } from '@/config/config'
import { AIAllowanceService } from '@/services/ai-allowance-service'
import {
  ensureReason as ensureOffscreenReason,
  releaseReason as releaseOffscreenReason,
} from '@/services/offscreen-manager'
import type {
  OfflineExtractionFailureBucket,
  OfflineExtractionResult,
} from '@/types/offline-reading'
import { getAccessToken } from '@/utils/auth-state'

export const MAX_SUMMARIZE_PAGE_CONTENT_CHARS = 12_000

export class AIPageSummaryError extends Error {
  constructor(
    public readonly code:
      | 'auth_required'
      | 'network_error'
      | 'no_article_structure'
      | 'limited_content'
      | 'allowance_exhausted'
      | 'rate_limited'
      | 'backend_error'
      | 'empty_summary',
    message: string,
  ) {
    super(message)
    this.name = 'AIPageSummaryError'
  }
}

export interface PageSummaryExtractionInput {
  url: string
  title: string
  html?: string
}

export interface PageSummaryResult {
  summary: string
  title: string
  byline: string | null
  contentText: string
}

function mapExtractionFailure(
  bucket: OfflineExtractionFailureBucket | undefined,
  fallbackMessage?: string,
): AIPageSummaryError {
  switch (bucket) {
    case 'no_article_structure':
      return new AIPageSummaryError('no_article_structure', 'No article-like content was found on this page.')
    case 'limited_content':
      return new AIPageSummaryError('limited_content', 'This page does not have enough readable content to summarize.')
    case 'network_error':
    default:
      return new AIPageSummaryError('network_error', fallbackMessage || 'The page content could not be loaded.')
  }
}

function normalizeContentText(content: string): string {
  const collapsed = content
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (collapsed.length <= MAX_SUMMARIZE_PAGE_CONTENT_CHARS) {
    return collapsed
  }

  return collapsed.slice(0, MAX_SUMMARIZE_PAGE_CONTENT_CHARS).trimEnd()
}

function mapSummaryApiError(
  response: Response,
  payload: { error?: string; message?: string } | null,
): AIPageSummaryError {
  if (response.status === 401) {
    return new AIPageSummaryError('auth_required', 'Sign in again to use AI page summaries.')
  }

  if (response.status === 429 && payload?.error === 'token_cap_exceeded') {
    return new AIPageSummaryError('allowance_exhausted', 'Your AI allowance is used up for this billing period.')
  }

  if (response.status === 429) {
    return new AIPageSummaryError('rate_limited', 'AI page summary is temporarily rate-limited. Please try again shortly.')
  }

  return new AIPageSummaryError(
    'backend_error',
    payload?.message?.trim() || payload?.error?.trim() || `Summary request failed (${response.status}).`,
  )
}

export class AIPageSummaryService {
  static async summarizePage(
    input: PageSummaryExtractionInput,
  ): Promise<PageSummaryResult> {
    const token = await getAccessToken()
    if (!token) {
      throw new AIPageSummaryError('auth_required', 'Sign in again to use AI page summaries.')
    }

    await ensureOffscreenReason('DOM_PARSER' as chrome.offscreen.Reason)
    try {
      const extraction = await sendOffscreenMessage<OfflineExtractionResult>({
        type: 'EXTRACT_OFFLINE_ARTICLE',
        url: input.url,
        html: input.html,
      })

      if (!extraction?.success) {
        throw mapExtractionFailure(extraction?.failureBucket, extraction?.error)
      }

      const contentText = normalizeContentText(extraction.contentText || extraction.contentHtml || '')
      if (!contentText) {
        throw new AIPageSummaryError('limited_content', 'This page does not have enough readable content to summarize.')
      }

      let response: Response
      try {
        response = await fetch(`${config.supertry.apiUrl}${config.ai.summarizePageEndpoint}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            url: input.url,
            title: extraction.title || input.title || input.url,
            byline: extraction.byline ?? undefined,
            contentText,
          }),
          signal: AbortSignal.timeout(30_000),
        })
      } catch (error) {
        throw new AIPageSummaryError(
          'network_error',
          `Summary request failed: ${error instanceof Error ? error.message : String(error)}`,
        )
      }

      await AIAllowanceService.syncFromAIResponse(response)

      if (!response.ok) {
        const payload = await response.clone().json().catch(() => null) as {
          error?: string
          message?: string
        } | null
        throw mapSummaryApiError(response, payload)
      }

      const data = await response.json().catch(() => null) as { summary?: string } | null
      const summary = data?.summary?.trim()
      if (!summary) {
        throw new AIPageSummaryError('empty_summary', 'AI summary returned empty content.')
      }

      return {
        summary,
        title: extraction.title || input.title || input.url,
        byline: extraction.byline ?? null,
        contentText,
      }
    } finally {
      void releaseOffscreenReason('DOM_PARSER' as chrome.offscreen.Reason)
    }
  }
}
