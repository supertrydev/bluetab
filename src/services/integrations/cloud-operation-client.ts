import { config } from '../../config/config';
import { t as translate } from '../../i18n';
import { getAccessToken } from '../../utils/auth-state';
import { AuthService } from '../auth-service';

const CLOUD_CONNECTION_CREDENTIAL_PREFIX = 'bluetab-cloud-connection:v1:';
const CONNECTION_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
const OPERATION_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * BlueTab's own sign-in (the Supertry session) is missing or was rejected.
 * This is NOT a provider problem: the connection is kept in the cloud vault
 * and works again after the user signs in, so callers must not mark the
 * integration as "reconnect required". Plain Error, never a 401 Response.
 */
export class IntegrationSessionError extends Error {
  readonly code = 'supertry_session_expired';

  constructor() {
    super(translate('settings.integrations.signInAgain'));
    this.name = 'IntegrationSessionError';
  }
}

/**
 * The connected provider account can never serve this operation (for example
 * a work Microsoft account without an Outlook mailbox). Reconnecting the same
 * account will not help, so callers must not mark it "reconnect required".
 */
export class IntegrationAccountUnsupportedError extends Error {
  readonly code = 'provider_account_unsupported';

  constructor() {
    super(translate('settings.integrations.accountUnsupported'));
    this.name = 'IntegrationAccountUnsupportedError';
  }
}

const SESSION_CHECK_INTERVAL_MS = 60_000;
let lastSessionCheckAt = 0;

/**
 * Ask the auth service to confirm a rejected session. It signs the user out
 * when the session is really gone, which makes the UI ask for sign-in.
 * Throttled: a burst of failing calls must not hit the refresh rate limit.
 */
function confirmSessionAfterRejection(): void {
  const now = Date.now();
  if (now - lastSessionCheckAt < SESSION_CHECK_INTERVAL_MS) return;
  lastSessionCheckAt = now;
  void AuthService.forceRefreshToken().catch(() => undefined);
}

export function createCloudConnectionCredential(connectionId: string): string {
  if (!CONNECTION_ID_PATTERN.test(connectionId)) {
    throw new Error('invalid_cloud_connection_reference');
  }
  return `${CLOUD_CONNECTION_CREDENTIAL_PREFIX}${connectionId}`;
}

export function isCloudConnectionCredential(value: string): boolean {
  return value.startsWith(CLOUD_CONNECTION_CREDENTIAL_PREFIX) &&
    CONNECTION_ID_PATTERN.test(value.slice(CLOUD_CONNECTION_CREDENTIAL_PREFIX.length));
}

export function getCloudConnectionId(credential: string): string {
  if (!isCloudConnectionCredential(credential)) {
    throw new Error('invalid_cloud_connection_credential');
  }
  return credential.slice(CLOUD_CONNECTION_CREDENTIAL_PREFIX.length);
}

export async function executeCloudOperation(
  credential: string,
  operation: string,
  input: Record<string, unknown>,
): Promise<Response> {
  const connectionId = getCloudConnectionId(credential);
  if (!OPERATION_PATTERN.test(operation)) {
    throw new Error('invalid_cloud_operation');
  }
  const sessionToken = await getAccessToken();
  if (!sessionToken) {
    throw new IntegrationSessionError();
  }
  const response = await fetch(
    `${config.supertry.apiUrl}/v1/integrations/${encodeURIComponent(connectionId)}/operations/${operation}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({ input }),
    },
  );
  if (response.status === 401) {
    // supertry.net rejected BlueTab's session (or the cloud assertion), not
    // the provider grant: keep the integration connected.
    confirmSessionAfterRejection();
    throw new IntegrationSessionError();
  }
  if (response.status === 409) {
    // 409 reauth_required: the provider says the grant is dead. Adapters and
    // dispatchVerb treat a 401 Response as "reconnect this integration".
    return new Response(null, { status: 401 });
  }
  if (response.status === 422) {
    const body = await response.clone().json().catch(() => null) as { error?: unknown } | null;
    if (body?.error === 'provider_account_unsupported') throw new IntegrationAccountUnsupportedError();
  }
  return response;
}

/**
 * Delete a cloud connection on explicit user disconnect: the cloud revokes the
 * grant at the provider and drops the stored tokens. 404 means already gone.
 */
export async function deleteCloudConnection(connectionId: string): Promise<void> {
  if (!CONNECTION_ID_PATTERN.test(connectionId)) {
    throw new Error('invalid_cloud_connection_reference');
  }
  const sessionToken = await getAccessToken();
  if (!sessionToken) {
    throw new IntegrationSessionError();
  }
  const response = await fetch(
    `${config.supertry.apiUrl}/v1/integrations/connections/${encodeURIComponent(connectionId)}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${sessionToken}` } },
  );
  if (response.ok || response.status === 404) return;
  if (response.status === 401) {
    confirmSessionAfterRejection();
    throw new IntegrationSessionError();
  }
  throw new Error(`cloud_connection_delete_failed:${response.status}`);
}

export async function executeProviderRequest(
  credential: string,
  operation: string,
  input: Record<string, unknown>,
  directRequest: () => Promise<Response>,
): Promise<Response> {
  return isCloudConnectionCredential(credential)
    ? executeCloudOperation(credential, operation, input)
    : directRequest();
}
