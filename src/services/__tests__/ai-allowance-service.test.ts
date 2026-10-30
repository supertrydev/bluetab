import { AIAllowanceService, formatAllowancePercent } from '../ai-allowance-service';

describe('formatAllowancePercent', () => {
  it('keeps one decimal for fractional allowance usage', () => {
    expect(formatAllowancePercent(0.1)).toBe('0.1%');
    expect(formatAllowancePercent(62.5)).toBe('62.5%');
  });

  it('omits trailing decimals for whole percentages', () => {
    expect(formatAllowancePercent(0)).toBe('0%');
    expect(formatAllowancePercent(62)).toBe('62%');
    expect(formatAllowancePercent(100)).toBe('100%');
  });
});


describe('AIAllowanceService.syncFromAIResponse', () => {
  afterEach(() => jest.restoreAllMocks());

  it('refreshes on success by default (one-shot AI calls)', async () => {
    const refresh = jest.spyOn(AIAllowanceService, 'refresh').mockResolvedValue(null);
    await AIAllowanceService.syncFromAIResponse(new Response('{}', { status: 200 }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('skips the success refresh for streaming chat, which refreshes once per turn', async () => {
    const refresh = jest.spyOn(AIAllowanceService, 'refresh').mockResolvedValue(null);
    await AIAllowanceService.syncFromAIResponse(new Response('{}', { status: 200 }), { refreshOnSuccess: false });
    expect(refresh).not.toHaveBeenCalled();
  });
});
