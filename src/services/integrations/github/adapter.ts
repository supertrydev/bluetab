import type { IntegrationAdapter } from '../../../types/integrations';
import { BrainDumpService } from '../../brain-dump-service';
import { executeProviderRequest } from '../cloud-operation-client';

const GITHUB_API_BASE = 'https://api.github.com';
const GITHUB_ACCEPT_HEADER = 'application/vnd.github+json';

type GitHubIssueResponse = {
  id?: number;
  number?: number;
  title?: string;
  body?: string;
  state?: string;
  updated_at?: string;
  html_url?: string;
};

type GitHubGistResponse = {
  id?: string;
  html_url?: string;
};

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : undefined;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function omitUndefined<T extends Record<string, unknown>>(input: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
}

function authHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: GITHUB_ACCEPT_HEADER,
  };
}

async function postJson<T>(
  url: string,
  body: Record<string, unknown>,
  accessToken: string,
  operation: string,
  input: Record<string, unknown>,
): Promise<T> {
  const response = await executeProviderRequest(accessToken, operation, input, () => fetch(url, {
    method: 'POST',
    headers: {
      ...authHeaders(accessToken),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  }));
  if (!response.ok) {
    throw response;
  }
  return (await response.json()) as T;
}

async function getJson<T>(
  url: string,
  accessToken: string,
  operation: string,
  input: Record<string, unknown>,
): Promise<T> {
  const response = await executeProviderRequest(accessToken, operation, input, () => fetch(url, {
    method: 'GET',
    headers: authHeaders(accessToken),
  }));
  if (!response.ok) {
    throw response;
  }
  return (await response.json()) as T;
}

async function createIssue(
  args: Record<string, unknown>,
  accessToken: string
): Promise<{ issueId?: number; issueNumber?: number; issueUrl?: string }> {
  const owner = asString(args.owner);
  const repo = asString(args.repo);
  const title = asString(args.title);
  if (!owner) {
    throw new Error('missing_owner');
  }
  if (!repo) {
    throw new Error('missing_repo');
  }
  if (!title) {
    throw new Error('missing_title');
  }

  const body = omitUndefined({
    title,
    body: asString(args.body),
    labels: asStringArray(args.labels),
    assignees: asStringArray(args.assignees),
  });

  const issue = await postJson<GitHubIssueResponse>(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/issues`,
    body,
    accessToken,
    'github.issue.create',
    { owner, repo, body },
  );

  return {
    issueId: issue.id,
    issueNumber: issue.number,
    issueUrl: issue.html_url,
  };
}

async function createGist(
  args: Record<string, unknown>,
  accessToken: string
): Promise<{ gistId?: string; gistUrl?: string }> {
  const description = asString(args.description);
  const files = asObject(args.files);
  if (!files) {
    throw new Error('missing_files');
  }

  const body = omitUndefined({
    description,
    public: asBoolean(args.public) ?? false,
    files,
  });

  const gist = await postJson<GitHubGistResponse>(
    `${GITHUB_API_BASE}/gists`, body, accessToken, 'github.gist.create', { body },
  );

  return { gistId: gist.id, gistUrl: gist.html_url };
}

async function pushBrainDumpToGitHub(
  args: Record<string, unknown>,
  accessToken: string
): Promise<unknown> {
  const entryId = asString(args.entryId);
  if (!entryId) {
    throw new Error('missing_entry_id');
  }
  const kind = asString(args.kind) === 'gist' ? 'gist' : 'issue';

  const entries = await BrainDumpService.list();
  const entry = entries.find((item) => item.id === entryId);
  if (!entry) {
    throw new Error('entry_not_found');
  }

  const text = asString(args.text) || entry.text;
  const tabUrl = entry.tabContext?.url;
  const issueBody = tabUrl ? `${text}\n\n${tabUrl}` : text;
  const title = text.slice(0, 100);

  if (kind === 'gist') {
    const filename = `brain-dump-${entry.id}.md`;
    return createGist(
      {
        description: title,
        public: false,
        files: { [filename]: { content: issueBody } },
      },
      accessToken
    );
  }

  return createIssue(
    {
      owner: asString(args.owner),
      repo: asString(args.repo),
      title,
      body: issueBody,
    },
    accessToken
  );
}

export const adapter: IntegrationAdapter = {
  async executeVerb(
    verb: string,
    args: Record<string, unknown>,
    accessToken: string,
    _accountMeta: Record<string, string>
  ): Promise<{ success: boolean; result?: unknown; error?: string }> {
    try {
      switch (verb) {
        case 'create_issue':
          return { success: true, result: await createIssue(args, accessToken) };
        case 'create_gist':
          return { success: true, result: await createGist(args, accessToken) };
        case 'push_brain_dump_to_github':
          return { success: true, result: await pushBrainDumpToGitHub(args, accessToken) };
        default:
          return { success: false, error: 'unknown_verb' };
      }
    } catch (error) {
      if (error instanceof Response) {
        // 401 must propagate so dispatchVerb can set the reauth flag.
        if (error.status === 401 || error.status === 429) throw error;
        // For other HTTP errors, surface a useful message instead of
        // letting dispatchVerb stringify the Response to "[object Response]".
        let detail = error.statusText;
        try {
          const bodyText = await error.text();
          if (bodyText) {
            try {
              const parsed = JSON.parse(bodyText) as { message?: string };
              if (parsed.message) detail = parsed.message;
            } catch {
              detail = bodyText.slice(0, 200);
            }
          }
        } catch { /* body unreadable */ }
        return { success: false, error: `GitHub ${error.status}: ${detail}` };
      }
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  async listRecords(
    accessToken: string,
    accountMeta: Record<string, string>,
    since?: Date
  ): Promise<unknown[]> {
    const owner = accountMeta.default_owner;
    const repo = accountMeta.default_repo;
    if (!owner) {
      throw new Error('missing_default_owner');
    }
    if (!repo) {
      throw new Error('missing_default_repo');
    }

    const params = new URLSearchParams();
    if (since) {
      params.set('since', since.toISOString());
    }
    params.set('state', 'all');
    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/issues?${params.toString()}`;

    const issues = await getJson<GitHubIssueResponse[]>(
      url,
      accessToken,
      'github.issues.list',
      { owner, repo, ...(since ? { since: since.toISOString() } : {}) },
    );
    return issues.map((issue) => ({
      id: issue.id,
      number: issue.number,
      title: issue.title || '',
      body: issue.body || '',
      state: issue.state || '',
      updatedAt: issue.updated_at ? Date.parse(issue.updated_at) : 0,
    }));
  },
};

type GitHubUserAuthResponse = { login?: string };

export async function fetchAuthenticatedUser(accessToken: string): Promise<{ login: string }> {
  const data = await getJson<GitHubUserAuthResponse>(
    `${GITHUB_API_BASE}/user`, accessToken, 'github.user.get', {},
  );
  if (!data.login) throw new Error('github_user_login_missing');
  return { login: data.login };
}

type GitHubRepoSearchResponse = {
  items?: Array<{
    full_name?: string;
    name?: string;
    private?: boolean;
    owner?: { login?: string };
    description?: string | null;
  }>;
};

export interface GitHubRepoSummary {
  owner: string;
  repo: string;
  fullName: string;
  private: boolean;
  description?: string;
}

export async function fetchRepos(
  accessToken: string,
  query: string,
  login: string,
): Promise<GitHubRepoSummary[]> {
  const trimmed = query.trim();
  // user:LOGIN scopes to repos the user has access to (owner or collaborator).
  // in:name limits the match to the repo name (not description) so suggestions
  // stay relevant.
  const q = trimmed.length > 0
    ? `${trimmed} in:name user:${login}`
    : `user:${login}`;
  const url = `${GITHUB_API_BASE}/search/repositories?q=${encodeURIComponent(q)}&per_page=10&sort=updated`;
  const data = await getJson<GitHubRepoSearchResponse>(
    url, accessToken, 'github.repos.list', { query: q },
  );
  const items = data.items ?? [];
  return items
    .filter(item => item.owner?.login && (item.name || item.full_name))
    .map(item => ({
      owner: item.owner!.login!,
      repo: item.name ?? item.full_name!.split('/').pop()!,
      fullName: item.full_name ?? `${item.owner!.login}/${item.name}`,
      private: !!item.private,
      description: item.description ?? undefined,
    }));
}
