import * as fs from 'fs';
import * as path from 'path';

const DASHBOARD_FILE = path.resolve(__dirname, './StatsDashboard.tsx');
const dashboardSource = fs.readFileSync(DASHBOARD_FILE, 'utf-8');
const english = JSON.parse(fs.readFileSync(
  path.resolve(__dirname, '../../i18n/locales/en.json'),
  'utf-8',
));

describe('Stats dashboard site-title contract', () => {
  it('renders saved site titles instead of formatting raw domains in the statistics UI', () => {
    expect(dashboardSource).toContain('resolveDomainDisplayTitle');
    expect(dashboardSource).toContain("label={translate('options.stats.cards.topSite')}");
    expect(dashboardSource).toContain("translate('options.stats.topSites')");
    expect(english.options.stats.cards.topSite).toBe('Top Site');
    expect(english.options.stats.topSites).toBe('Top Sites');
    expect(dashboardSource).not.toContain('formatDomainName(d.domain)');
  });
});
