import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isolateBidi } from '@/i18n/bidi';
import { toast } from '@/components/Toast';
import { X, Plus, Lock, Search } from 'lucide-react';
import { Storage } from '@/utils/storage';
import { getValidToken } from '@/services/integration-token-storage';
import { fetchAuthenticatedUser, fetchRepos, type GitHubRepoSummary } from '@/services/integrations/github/adapter';

export interface GitHubRepoConfig {
  owner: string;
  repo: string;
  fullName: string;
}

interface IntegrationSettings {
  github_repos?: GitHubRepoConfig[];
  [key: string]: unknown;
}

interface GitHubRepoSelectorProps {
  accountId: string;
}

const SEARCH_DEBOUNCE_MS = 300;

export function GitHubRepoSelector({ accountId }: GitHubRepoSelectorProps) {
  const { t } = useTranslation();
  const [addedRepos, setAddedRepos] = useState<GitHubRepoConfig[]>([]);
  const [login, setLogin] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GitHubRepoSummary[]>([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const settings = await Storage.get<IntegrationSettings>('integration_settings');
        if (!cancelled) setAddedRepos(settings?.github_repos ?? []);

        const accessToken = await getValidToken('github', accountId);
        if (!accessToken) throw new Error(t('components.integrationErrors.invalidGithubToken'));
        const user = await fetchAuthenticatedUser(accessToken);
        if (!cancelled) setLogin(user.login);
      } catch (err) {
        if (!cancelled) setLoginError(err instanceof Error ? err.message : t('components.integrationErrors.loadGithubUser'));
      }
    }
    init();
    return () => { cancelled = true; };
  }, [accountId, t]);

  useEffect(() => {
    if (!login || query.trim().length === 0) {
      setResults([]);
      setShowResults(false);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const accessToken = await getValidToken('github', accountId);
        if (!accessToken) throw new Error(t('components.integrationErrors.invalidGithubToken'));
        const repos = await fetchRepos(accessToken, query, login);
        setResults(repos);
        setShowResults(true);
      } catch (err) {
        console.error('[GitHubRepoSelector] Search failed:', err);
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, login, accountId, t]);

  async function persistRepos(next: GitHubRepoConfig[]) {
    const settings = (await Storage.get<IntegrationSettings>('integration_settings')) ?? {};
    await Storage.set('integration_settings', { ...settings, github_repos: next });
    setAddedRepos(next);
  }

  async function handleAddRepo(repo: GitHubRepoSummary) {
    if (addedRepos.some(r => r.fullName === repo.fullName)) {
      toast.info(t('settings.integrations.repoAlreadyAdded', { name: isolateBidi(repo.fullName, 'ltr') }));
      return;
    }
    const next = [...addedRepos, { owner: repo.owner, repo: repo.repo, fullName: repo.fullName }];
    try {
      await persistRepos(next);
      toast.success(t('settings.integrations.repoAdded', { name: isolateBidi(repo.fullName, 'ltr') }));
      setQuery('');
      setShowResults(false);
    } catch (err) {
      console.error('[GitHubRepoSelector] Persist failed:', err);
      toast.error(t('settings.integrations.repoSaveError'));
    }
  }

  async function handleRemoveRepo(fullName: string) {
    const next = addedRepos.filter(r => r.fullName !== fullName);
    try {
      await persistRepos(next);
      toast.success(t('settings.integrations.repoRemoved', { name: isolateBidi(fullName, 'ltr') }));
    } catch (err) {
      console.error('[GitHubRepoSelector] Persist failed:', err);
      toast.error(t('settings.integrations.repoRemoveError'));
    }
  }

  if (loginError) {
    return (
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">{t('settings.integrations.repositoriesLabel')}</label>
        <div className="text-xs text-red-600 dark:text-red-400">
          {t('settings.integrations.errorLoading', {
            resource: t('settings.integrations.resources.repositories'),
            message: isolateBidi(loginError),
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs text-muted-foreground">{t('settings.integrations.repositoriesLabel')}</label>

      {addedRepos.length > 0 && (
        <ul className="flex flex-col gap-1">
          {addedRepos.map(r => (
            <li
              key={r.fullName}
              className="flex items-center justify-between rounded-md border border-border-glass bg-card-glass/60 px-2 py-1.5 text-xs"
            >
              <bdi dir="ltr" className="truncate font-mono">{r.fullName}</bdi>
              <button
                type="button"
                onClick={() => handleRemoveRepo(r.fullName)}
                className="text-muted-foreground hover:text-red-600 dark:hover:text-red-400 transition"
                aria-label={`${t('common.remove')} ${r.fullName}`}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="relative">
        <div className="flex items-center gap-1.5 rounded-md border border-border-glass bg-input-glass px-2 py-1.5">
          <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <input
            type="text"
            dir="auto"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => results.length > 0 && setShowResults(true)}
            placeholder={login ? t('settings.integrations.searchRepositories') : t('settings.integrations.loadingRepositories')}
            disabled={!login}
            className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/60"
          />
          {searching && <span className="text-xs text-muted-foreground">…</span>}
        </div>

        {showResults && results.length > 0 && (
          <ul className="absolute z-10 mt-1 w-full rounded-md border border-border-glass bg-popover shadow-lg max-h-64 overflow-y-auto">
            {results.map(r => {
              const already = addedRepos.some(a => a.fullName === r.fullName);
              return (
                <li key={r.fullName}>
                  <button
                    type="button"
                    disabled={already}
                    onClick={() => handleAddRepo(r)}
                    className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-start text-xs hover:bg-accent/50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <span className="flex items-center gap-1.5 truncate">
                      {r.private && <Lock className="w-3 h-3 text-muted-foreground shrink-0" />}
                      <bdi dir="ltr" className="font-mono truncate">{r.fullName}</bdi>
                    </span>
                    {already ? (
                      <span className="text-muted-foreground text-micro">{t('settings.integrations.addedStatus')}</span>
                    ) : (
                      <Plus className="w-3.5 h-3.5 text-muted-foreground" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {showResults && query.trim().length > 0 && results.length === 0 && !searching && (
          <div className="absolute z-10 mt-1 w-full rounded-md border border-border-glass bg-popover px-2 py-1.5 text-xs text-muted-foreground">
            {t('settings.integrations.noMatchingRepositories')}
          </div>
        )}
      </div>
    </div>
  );
}
