const OAUTH_NAVIGATION_FAILURE_PATTERNS = [
  /^Authorization page could not be loaded\.?$/i,
  /\b(?:net::)?ERR_NAME_NOT_RESOLVED\b/i,
  /\bLOAD_FAILED\b/i,
];

export class OAuthProviderUnreachableError extends Error {
  readonly code = 'oauth_provider_unreachable' as const;
  readonly providerName: string;
  readonly cause: unknown;

  constructor(providerName: string, cause: unknown) {
    super(`${providerName} could not be reached`);
    this.name = 'OAuthProviderUnreachableError';
    this.providerName = providerName;
    this.cause = cause;
  }
}

export function mapOAuthLaunchError(error: unknown, providerName: string): unknown {
  const message = error instanceof Error ? error.message : String(error);
  const isNavigationFailure = OAUTH_NAVIGATION_FAILURE_PATTERNS.some((pattern) =>
    pattern.test(message),
  );

  return isNavigationFailure
    ? new OAuthProviderUnreachableError(providerName, error)
    : error;
}
