import { getAuthState } from '../utils/auth-state';
import { saveTabsToBlueTab } from './saved-tab-actions';
import { saveLinkToBlueTab } from './save-link-to-bluetab';

jest.mock('../utils/auth-state', () => ({
  getAuthState: jest.fn(),
}));

jest.mock('./saved-tab-actions', () => ({
  saveTabsToBlueTab: jest.fn(),
}));

const mockGetAuthState = getAuthState as jest.MockedFunction<typeof getAuthState>;
const mockSaveTabsToBlueTab = saveTabsToBlueTab as jest.MockedFunction<typeof saveTabsToBlueTab>;

describe('saveLinkToBlueTab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAuthState.mockResolvedValue({
      isLoggedIn: true,
      isLoading: false,
      user: null,
      subscription: null,
      isPro: true,
      lastChecked: 0,
      offlineSince: null,
    } as never);
    mockSaveTabsToBlueTab.mockResolvedValue({
      processedCount: 1,
      memoryRestoredCount: 0,
      flowMatchedCount: 1,
      defaultGroupedCount: 0,
      closedCount: 0,
      savedGroups: [],
    });
  });

  it('routes links through saveTabsToBlueTab so group memory and Flow can claim them', async () => {
    await saveLinkToBlueTab({
      linkUrl: 'https://example.com/article',
      linkText: 'Example Article',
      now: 1_700_000_000_000,
    });

    expect(mockSaveTabsToBlueTab).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          url: 'https://example.com/article',
          title: 'Example Article',
          pinned: false,
        }),
      ],
      'Link: example.com',
      expect.objectContaining({
        closeSourceTabs: false,
        isPro: true,
        now: 1_700_000_000_000,
      }),
    );
  });
});
