/**
 * @laguna/whitelabel-sdk
 *
 * Official TypeScript SDK for the Laguna Whitelabel API.
 * https://github.com/Laguna-10xlab/laguna-whitelabel-sdk
 */

export { LagunaClient } from './client'
export type { LagunaClientConfig } from './client'

export {
  LagunaError,
  LagunaAuthError,
  LagunaValidationError,
  LagunaScopeError,
  LagunaRateLimitError,
  LagunaServerError,
  LagunaNetworkError,
  LagunaWebhookSignatureError,
} from './errors'

export { verifyWebhookSignature, parseWebhook } from './webhooks'

export type {
  // Common
  SubscriptionStatus,
  WebhookEventType,
  DisbursementStatus,
  // Catalog
  CatalogMerchant,
  CatalogResponse,
  MerchantDetail,
  MerchantsListResponse,
  // Subscriptions
  Subscription,
  SubscriptionListResponse,
  SubscriptionRequestResult,
  // Links
  CreateLinkParams,
  CreateLinkResult,
  // Disbursements
  DisburseParams,
  DisburseResult,
  DisbursementDetail,
  // Earnings + Withdrawals
  Earnings,
  CreateWithdrawalParams,
  Withdrawal,
  // Webhooks
  WebhookPayload,
} from './types'
