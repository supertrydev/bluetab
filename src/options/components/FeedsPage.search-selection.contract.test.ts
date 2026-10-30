import * as fs from 'fs';
import * as path from 'path';

const source = fs.readFileSync(
  path.resolve(__dirname, './FeedsPage.tsx'),
  'utf-8',
);

describe('FeedsPage search selection contract', () => {
  it('clears the active search query when a feed is selected from the list', () => {
    const handleSelectFeedStart = source.indexOf('const handleSelectFeed = useCallback((feedId: string) => {');
    const handleSelectFeedEnd = source.indexOf('}, []);', handleSelectFeedStart);
    const handleSelectFeedBody = source.slice(handleSelectFeedStart, handleSelectFeedEnd);

    expect(handleSelectFeedBody).toContain("setSelectedFeedId(feedId);");
    expect(handleSelectFeedBody).toContain("setSearchQuery('');");
  });
});
