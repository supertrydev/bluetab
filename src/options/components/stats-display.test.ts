import { extractSiteTitleCandidate, formatDomainName, resolveDomainDisplayTitle } from './stats-display';
import type { TabGroup } from '@/types/models';

describe('stats display helpers', () => {
  it('prefers a compact site-name segment when titles contain separators', () => {
    expect(extractSiteTitleCandidate('Article headline - The Verge')).toBe('The Verge');
    expect(extractSiteTitleCandidate('Inbox | Gmail')).toBe('Gmail');
  });

  it('falls back to the formatted domain when no saved title exists for that site', () => {
    expect(resolveDomainDisplayTitle('www.github.com', [])).toBe('Github');
    expect(formatDomainName('www.x.com')).toBe('X');
    expect(formatDomainName('workspace.google.com')).toBe('Google');
    expect(formatDomainName('news.bbc.co.uk')).toBe('Bbc');
  });

  it('uses the most common saved title for matching hostnames across groups', () => {
    const groups: TabGroup[] = [
      {
        id: 'g-1',
        name: 'Older',
        created: 1,
        modified: 10,
        tabs: [
          {
            id: 't-1',
            url: 'https://www.github.com/openai/openai',
            title: 'OpenAI · GitHub',
            timestamp: 10,
            groupId: 'g-1',
          },
        ],
      },
      {
        id: 'g-2',
        name: 'Newer',
        created: 2,
        modified: 20,
        tabs: [
          {
            id: 't-2',
            url: 'https://github.com/vercel/next.js',
            title: 'next.js - GitHub',
            timestamp: 20,
            groupId: 'g-2',
          },
          {
            id: 't-3',
            url: 'https://github.com/tailwindlabs/tailwindcss',
            title: 'tailwindcss - GitHub',
            timestamp: 30,
            groupId: 'g-2',
          },
        ],
      },
    ];

    expect(resolveDomainDisplayTitle('github.com', groups)).toBe('GitHub');
  });

  it('prefers a domain-matching title segment and avoids generic subdomain labels', () => {
    const groups: TabGroup[] = [
      {
        id: 'g-1',
        name: 'Workspace',
        created: 1,
        modified: 10,
        tabs: [
          {
            id: 't-1',
            url: 'https://workspace.google.com/products',
            title: 'Business Apps & Productivity Tools | Google Workspace',
            timestamp: 10,
            groupId: 'g-1',
          },
          {
            id: 't-2',
            url: 'https://accounts.google.com/signin',
            title: 'Accounts - Google',
            timestamp: 11,
            groupId: 'g-1',
          },
          {
            id: 't-3',
            url: 'https://github.com/sbusso/claudeclaw',
            title: 'sbusso/claudeclaw: Use Claude to orchestrate agents like OpenClaw',
            timestamp: 12,
            groupId: 'g-1',
          },
        ],
      },
    ];

    expect(resolveDomainDisplayTitle('workspace.google.com', groups)).toBe('Google Workspace');
    expect(resolveDomainDisplayTitle('accounts.google.com', groups)).toBe('Google');
    expect(resolveDomainDisplayTitle('github.com', groups)).toBe('Github');
  });
});
