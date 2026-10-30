/**
 * @module components/bluet/bluet-error-message
 *
 * WHY: Bluet bridge failures carry a machine-readable code; users should see
 *      translated text instead of the English server message.
 */

import type { BluetErrorCode } from '../../types/bluet'

export const BLUET_ERROR_KEYS = {
  not_connected: 'components.bluetConnection.errors.notConnected',
  nothing_to_share: 'components.bluetConnection.errors.nothingToShare',
  session_expired: 'components.bluetConnection.errors.sessionExpired',
  revoked: 'components.bluetConnection.errors.revoked',
  subscription_required: 'components.bluetConnection.errors.subscriptionRequired',
  bluetab_pro_required: 'components.bluetConnection.errors.bluetabProRequired',
  linked_elsewhere: 'components.bluetConnection.errors.linkedElsewhere',
  rate_limited: 'components.bluetConnection.errors.rateLimited',
  limit_exceeded: 'components.bluetConnection.errors.limitExceeded',
  invalid_payload: 'components.bluetConnection.errors.invalidPayload',
  payload_too_large: 'components.bluetConnection.errors.payloadTooLarge',
  invalid_token: 'components.bluetConnection.errors.invalidToken',
  token_expired: 'components.bluetConnection.errors.tokenExpired',
  server_error: 'components.bluetConnection.errors.serverError',
  network: 'components.bluetConnection.errors.network',
} as const satisfies Record<BluetErrorCode, string>

export type BluetErrorKey = (typeof BLUET_ERROR_KEYS)[BluetErrorCode]

/** Translated message for a failed Bluet call, falling back to the raw error text. */
export function bluetErrorMessage(
  translate: (key: BluetErrorKey) => string,
  result: { code?: BluetErrorCode; error?: string },
  fallback: string,
): string {
  if (result.code) return translate(BLUET_ERROR_KEYS[result.code])
  return result.error || fallback
}
