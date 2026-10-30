import { AIAllowanceService } from './ai-allowance-service'
import {
  AIPageSummaryError,
  AIPageSummaryService,
  MAX_SUMMARIZE_PAGE_CONTENT_CHARS,
} from './ai-page-summary-to-dump'
import { ensureReason } from './offscreen-manager'
import { getAccessToken } from '@/utils/auth-state'

jest.mock('./ai-allowance-service', () => ({
  AIAllowanceService: {
    syncFromAIResponse: jest.fn(),
  },
}))

jest.mock('./offscreen-manager', () => ({
  ensureReason: jest.fn(),
  releaseReason: jest.fn(),
}))

jest.mock('@/utils/auth-state', () => ({
  getAccessToken: jest.fn(),
}))

describe('AIPageSummaryService', () => {
  const mockFetch = global.fetch as jest.Mock | undefined

  beforeEach(() => {
    jest.clearAllMocks()
    ;(getAccessToken as jest.Mock).mockResolvedValue('token-123')
    ;(ensureReason as jest.Mock).mockResolvedValue(undefined)
    ;(chrome.runtime.sendMessage as jest.Mock).mockResolvedValue({
      success: true,
      title: 'Readable title',
      byline: 'Author',
      contentText: 'A'.repeat(MAX_SUMMARIZE_PAGE_CONTENT_CHARS + 200),
      contentHtml: '<p>fallback</p>',
    })
    global.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ summary: 'Overview sentence\n- Point one\n- Point two' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as unknown as typeof fetch
  })

  afterEach(() => {
    if (mockFetch) {
      global.fetch = mockFetch
    }
  })

  it('extracts page content, truncates it safely, and returns the summary', async () => {
    const result = await AIPageSummaryService.summarizePage({
      url: 'https://example.com/story',
      title: 'Page title',
      html: '<html></html>',
    })

    expect(result.summary).toContain('Overview sentence')
    expect(result.title).toBe('Readable title')
    expect(result.byline).toBe('Author')
    expect(result.contentText).toHaveLength(MAX_SUMMARIZE_PAGE_CONTENT_CHARS)
    expect(ensureReason).toHaveBeenCalledWith('DOM_PARSER')
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'EXTRACT_OFFLINE_ARTICLE',
      url: 'https://example.com/story',
      html: '<html></html>',
    })
    expect(global.fetch).toHaveBeenCalledWith(
      'https://supertry.net/api/ai/summarize-page',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer token-123',
        }),
      }),
    )
    const fetchBody = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body as string)
    expect(fetchBody.contentText).toHaveLength(MAX_SUMMARIZE_PAGE_CONTENT_CHARS)
    expect(AIAllowanceService.syncFromAIResponse).toHaveBeenCalledTimes(1)
  })

  it('maps extraction failures before contacting the backend', async () => {
    ;(chrome.runtime.sendMessage as jest.Mock).mockResolvedValue({
      success: false,
      failureBucket: 'no_article_structure',
    })

    await expect(
      AIPageSummaryService.summarizePage({
        url: 'https://example.com/story',
        title: 'Page title',
      }),
    ).rejects.toMatchObject<Partial<AIPageSummaryError>>({
      code: 'no_article_structure',
    })

    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('maps allowance exhaustion from the backend', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue(
      new Response(JSON.stringify({ error: 'token_cap_exceeded' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    await expect(
      AIPageSummaryService.summarizePage({
        url: 'https://example.com/story',
        title: 'Page title',
      }),
    ).rejects.toMatchObject<Partial<AIPageSummaryError>>({
      code: 'allowance_exhausted',
    })

    expect(AIAllowanceService.syncFromAIResponse).toHaveBeenCalledTimes(1)
  })
})
