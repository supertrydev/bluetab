/**
 * A rejected or missing BlueTab (Supertry) session must not look like a dead
 * provider connection: cloud connections stay valid in the vault and work
 * again after sign-in, so these paths must never produce a 401 Response
 * (which adapters and dispatchVerb treat as "reconnect this integration").
 */

const mockGetAccessToken = jest.fn();
const mockForceRefreshToken = jest.fn();

jest.mock('../../../utils/auth-state', () => ({
  getAccessToken: (...args: unknown[]) => mockGetAccessToken(...args),
}));

jest.mock('../../auth-service', () => ({
  AuthService: {
    forceRefreshToken: (...args: unknown[]) => mockForceRefreshToken(...args),
  },
}));

import {
  IntegrationAccountUnsupportedError,
  IntegrationSessionError,
  createCloudConnectionCredential,
  executeCloudOperation,
} from '../cloud-operation-client';

const credential = createCloudConnectionCredential('connection-1');
const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;

describe('cloud operation session handling', () => {
  let now = 1_000_000;

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = fetchMock;
    mockGetAccessToken.mockResolvedValue('extension-session');
    mockForceRefreshToken.mockResolvedValue({ success: false, sessionInvalid: true });
    now += 10 * 60_000;
    jest.spyOn(Date, 'now').mockReturnValue(now);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('throws a session error, not a 401 Response, when signed out', async () => {
    mockGetAccessToken.mockResolvedValue(null);

    const call = executeCloudOperation(credential, 'linear.teams.list', {});

    await expect(call).rejects.toBeInstanceOf(IntegrationSessionError);
    await expect(call).rejects.not.toBeInstanceOf(Response);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('treats a 401 from supertry.net as a session problem and checks the session once', async () => {
    fetchMock.mockResolvedValue(new Response('{"error":"Session expired"}', { status: 401 }));

    await expect(executeCloudOperation(credential, 'linear.teams.list', {}))
      .rejects.toBeInstanceOf(IntegrationSessionError);
    await expect(executeCloudOperation(credential, 'todoist.projects.list', {}))
      .rejects.toBeInstanceOf(IntegrationSessionError);

    // Throttled: a burst of failing calls asks the auth service only once.
    expect(mockForceRefreshToken).toHaveBeenCalledTimes(1);
  });

  it('still maps a Cloud 409 reauth_required to the 401 reconnect signal', async () => {
    fetchMock.mockResolvedValue(new Response('{"error":"reauth_required"}', { status: 409 }));

    const response = await executeCloudOperation(credential, 'linear.teams.list', {});

    expect(response.status).toBe(401);
    expect(mockForceRefreshToken).not.toHaveBeenCalled();
  });

  it('maps a Cloud 422 provider_account_unsupported to its own error, not a reconnect signal', async () => {
    fetchMock.mockResolvedValue(new Response('{"error":"provider_account_unsupported"}', { status: 422 }));

    const call = executeCloudOperation(credential, 'outlook-calendar.calendars.list', {});

    await expect(call).rejects.toBeInstanceOf(IntegrationAccountUnsupportedError);
    await expect(call).rejects.not.toBeInstanceOf(Response);
    expect(mockForceRefreshToken).not.toHaveBeenCalled();
  });

  it('passes other Cloud 422 responses through unchanged', async () => {
    fetchMock.mockResolvedValue(new Response('{"error":"something_else"}', { status: 422 }));

    const response = await executeCloudOperation(credential, 'outlook-calendar.calendars.list', {});

    expect(response.status).toBe(422);
  });

  it('passes a transient Cloud 503 through without a reconnect signal', async () => {
    fetchMock.mockResolvedValue(new Response('{"error":"provider_unavailable"}', { status: 503 }));

    const response = await executeCloudOperation(credential, 'linear.teams.list', {});

    expect(response.status).toBe(503);
  });
});
