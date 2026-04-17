/**
 * Type definitions for the Laguna Whitelabel API.
 * Mirrors the response shape from agent_backend's WhitelabelController and
 * the webhook payload from backend_worker's PartnerAttributionService.
 */

// ---------- Common ----------

export type SubscriptionStatus = 'pending' | 'approved' | 'rejected' | 'revoked'
export type WebhookEventType = 'conversion.confirmed' | 'conversion.reversed'
export type DisbursementStatus = 'processing' | 'completed' | 'failed'

// ---------- Catalog ----------

export interface CatalogMerchant {
  merchant_id: string
  name: string
  category: string | null
  logo_url: string | null
  supported_geos: string[]
  headline_rate: number
  /** null if not yet requested by partner */
  subscription_status: SubscriptionStatus | null
}

export interface CatalogResponse {
  merchants: CatalogMerchant[]
  total: number
}

export interface MerchantDetail {
  merchant_id: string
  name: string
  logo_url: string | null
  category: string | null
  best_rate: number
  rate_note: string
  category_rates: Array<{ sub_category: string; rate: number }>
  cookie_days: number
  payout_days: number
  supported_geos: string[]
  /** Cache the response on your server for at least this many seconds. */
  cache_ttl: number
  available: boolean
}

export interface MerchantsListResponse {
  merchants: MerchantDetail[]
  total: number
  cache_ttl: number
}

// ---------- Subscriptions ----------

export interface Subscription {
  id: string
  merchant_id: string
  merchant_name: string
  merchant_category: string | null
  merchant_logo_url: string | null
  status: SubscriptionStatus
  requested_by: 'partner' | 'admin'
  requested_at: string
  reviewed_at: string | null
  rejection_reason: string | null
}

export interface SubscriptionListResponse {
  subscriptions: Subscription[]
  total: number
}

export interface SubscriptionRequestResult {
  id: string
  merchant_id: string
  status: SubscriptionStatus
  requested_at: string
}

// ---------- Links ----------

export interface CreateLinkParams {
  merchant_id: string
  partner_user_id: string
  geo?: string
  target_url?: string
}

export interface CreateLinkResult {
  shortlink: string
  shortcode: string
  merchant_id: string
  partner_user_id: string
}

// ---------- Disbursement (Model 1) ----------

export interface DisburseParams {
  /** From the webhook payload. Same as conversion.transaction_id. */
  transaction_id: string
  /** End-user's wallet to receive user_amount. EVM only in V1. */
  user_wallet_address: string
}

export interface DisburseResult {
  disbursement_id: string
  status: DisbursementStatus
  amount_usdc: number
  destination_wallet: string
  message?: string
}

export interface DisbursementDetail {
  disbursement_id: string
  transaction_id: string
  status: DisbursementStatus
  amount_usdc: number
  destination_wallet: string
  chain: string
  tx_hash: string | null
  created_at: string
}

// ---------- Earnings + Withdrawals ----------

export interface Earnings {
  pending: number
  available: number
  total_earned: number
  total_withdrawn: number
  total_disbursed: number
  settlement_token: string
}

export interface CreateWithdrawalParams {
  amount: number
}

export interface Withdrawal {
  withdrawal_id: string
  status: DisbursementStatus
  amount_usdc: number
  destination_wallet: string
  chain: string
  tx_hash: string | null
  created_at: string
}

// ---------- Webhook payload ----------

export interface WebhookPayload {
  event_type: WebhookEventType
  partner_user_id: string
  merchant_id: string
  transaction_id: string
  status: 'confirmed' | 'reversed'
  /** Raw commission from the affiliate network. */
  gross_commission: number
  /** Amount the user should receive. */
  user_amount: number
  /** Partner's revenue share. */
  partner_amount: number
  /** Actual rate applied (subcategory-aware if available). */
  earned_rate_pct: number
  /** Geo detected at click time. */
  geo_at_purchase: string | null
  /** Partner's fixed settlement token (e.g. 'USDC'). */
  settlement_token: string
  /** Laguna's internal conversion id (for support tickets). */
  conversion_id: string
  /** ISO timestamp when this status transition happened. */
  occurred_at: string
}
