import { LagunaAuthError, LagunaError, LagunaNetworkError, LagunaRateLimitError, LagunaScopeError, LagunaServerError, LagunaValidationError } from './errors'
import {
  CatalogResponse,
  CreateLinkParams,
  CreateLinkResult,
  CreateWithdrawalParams,
  DisburseParams,
  DisburseResult,
  DisbursementDetail,
  Earnings,
  MerchantDetail,
  MerchantsListResponse,
  Subscription,
  SubscriptionListResponse,
  SubscriptionRequestResult,
  SubscriptionStatus,
  Withdrawal,
} from './types'
import { verifyWebhookSignature } from './webhooks'

export interface LagunaClientConfig {
  /** Your Bearer token (lg_live_* or lg_test_*). Required. */
  apiKey: string
  /** Override the API base URL. Defaults to https://api.laguna.network */
  baseUrl?: string
  /** Per-request timeout in milliseconds. Default 30000 (30s). */
  timeoutMs?: number
  /** Number of retries for transient failures (5xx, network). Default 2. */
  maxRetries?: number
  /** Custom fetch impl (for testing or polyfills in older Node). Defaults to global fetch. */
  fetch?: typeof globalThis.fetch
}

const DEFAULT_BASE_URL = 'https://api.laguna.network'
const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_RETRIES = 2

/**
 * Main client for the Laguna Whitelabel API.
 *
 * @example
 * ```ts
 * const laguna = new LagunaClient({ apiKey: process.env.LAGUNA_API_KEY! })
 *
 * // Discover merchants
 * const catalog = await laguna.catalog.list({ geo: 'SG' })
 *
 * // Mint a link for a user
 * const link = await laguna.links.create({
 *   merchant_id: 'shopee',
 *   partner_user_id: 'cust_abc123',
 *   geo: 'SG'
 * })
 *
 * // Verify a webhook on your server
 * if (laguna.webhooks.verify(rawBody, signature)) { ... }
 * ```
 */
export class LagunaClient {
  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly timeoutMs: number
  private readonly maxRetries: number
  private readonly fetchImpl: typeof globalThis.fetch
  private readonly webhookSecret: string | undefined

  /** Catalog discovery — full merchant browse, no scope filter. */
  readonly catalog: CatalogResource
  /** Subscribed merchants — rate refresh + single merchant detail. */
  readonly merchants: MerchantsResource
  /** Subscription management — request/list/unsubscribe. */
  readonly subscriptions: SubscriptionsResource
  /** Link minting. */
  readonly links: LinksResource
  /** Disbursements (Model 1). */
  readonly disbursements: DisbursementsResource
  /** Earnings + withdrawals. */
  readonly earnings: EarningsResource
  readonly withdrawals: WithdrawalsResource
  /** Webhook signature verification. Pass `webhookSecret` to enable verify(). */
  readonly webhooks: WebhooksResource

  constructor(config: LagunaClientConfig & { webhookSecret?: string }) {
    if (!config.apiKey) throw new Error('LagunaClient: apiKey is required')
    this.apiKey = config.apiKey
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '')
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES
    this.fetchImpl = config.fetch ?? globalThis.fetch
    this.webhookSecret = config.webhookSecret

    if (!this.fetchImpl) {
      throw new Error('LagunaClient: global fetch is not available. Use Node 18+ or pass a custom fetch impl.')
    }

    // Resource sub-clients
    this.catalog = new CatalogResource(this)
    this.merchants = new MerchantsResource(this)
    this.subscriptions = new SubscriptionsResource(this)
    this.links = new LinksResource(this)
    this.disbursements = new DisbursementsResource(this)
    this.earnings = new EarningsResource(this)
    this.withdrawals = new WithdrawalsResource(this)
    this.webhooks = new WebhooksResource(this.webhookSecret)
  }

  /** Internal: low-level request with retry + error mapping. */
  async request<T>(method: 'GET' | 'POST' | 'DELETE', path: string, options: { query?: Record<string, string | number | undefined>; body?: unknown; idempotencyKey?: string } = {}): Promise<T> {
    const url = this.buildUrl(path, options.query)
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json',
      'User-Agent': '@laguna-team/whitelabel-sdk',
    }
    if (options.body !== undefined) headers['Content-Type'] = 'application/json'
    if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey

    let lastError: unknown
    const attempts = this.maxRetries + 1

    for (let attempt = 1; attempt <= attempts; attempt++) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs)

      try {
        const response = await this.fetchImpl(url, {
          method,
          headers,
          body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
          signal: controller.signal,
        })
        clearTimeout(timeout)

        const text = await response.text()
        const json: unknown = text ? safeJsonParse(text) : null

        if (response.ok) return json as T

        // Map to typed errors
        if (response.status === 401) {
          throw new LagunaAuthError(extractMessage(json) || 'Authentication failed', response.status, json)
        }
        if (response.status === 403) {
          throw new LagunaScopeError(extractMessage(json) || 'Forbidden — check merchant scope', response.status, json)
        }
        if (response.status === 422 || response.status === 400) {
          throw new LagunaValidationError(extractMessage(json) || 'Invalid request', response.status, json)
        }
        if (response.status === 429) {
          const retryAfter = response.headers.get('retry-after')
          throw new LagunaRateLimitError(extractMessage(json) || 'Rate limit exceeded', response.status, retryAfter ? parseInt(retryAfter, 10) : undefined, json)
        }
        if (response.status >= 500) {
          // Retry transient 5xx
          if (attempt < attempts) {
            await sleep(backoffMs(attempt))
            continue
          }
          throw new LagunaServerError(extractMessage(json) || `Server error (${response.status})`, response.status, json)
        }

        // Other 4xx (404 etc.)
        throw new LagunaError(extractMessage(json) || `HTTP ${response.status}`, `HTTP_${response.status}`, response.status, json)
      } catch (err) {
        clearTimeout(timeout)
        if (err instanceof LagunaError && !(err instanceof LagunaServerError)) throw err
        lastError = err

        // Network errors / aborts → retry
        const isNetworkError = err instanceof Error && (err.name === 'AbortError' || err.name === 'TypeError' || (err as { code?: string }).code !== undefined)
        if (isNetworkError && attempt < attempts) {
          await sleep(backoffMs(attempt))
          continue
        }
        if (err instanceof LagunaError) throw err
        throw new LagunaNetworkError(`Network error after ${attempt} attempt(s): ${(err as Error).message}`, err)
      }
    }

    // Unreachable in practice — loop always returns/throws
    throw new LagunaNetworkError('Request failed', lastError)
  }

  private buildUrl(path: string, query?: Record<string, string | number | undefined>): string {
    const url = new URL(`${this.baseUrl}/api/v1/${path.replace(/^\//, '')}`)
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v))
      }
    }
    return url.toString()
  }
}

// ---------- Resources ----------

class CatalogResource {
  constructor(private readonly client: LagunaClient) {}

  /**
   * GET /v1/catalog — full merchant catalog (no scope filter).
   * Use this at integration time to discover what to subscribe to.
   */
  list(filters?: { geo?: string; category?: string; limit?: number }): Promise<CatalogResponse> {
    return this.client.request('GET', 'catalog', { query: filters })
  }
}

class MerchantsResource {
  constructor(private readonly client: LagunaClient) {}

  /**
   * GET /v1/merchants — rate refresh. Returns ALL approved-subscribed
   * merchants for this API key. Cache the response on your server for
   * `cache_ttl` seconds — do not call this on every user request.
   */
  list(filters?: { geo?: string }): Promise<MerchantsListResponse> {
    return this.client.request('GET', 'merchants', { query: filters })
  }

  /**
   * GET /v1/merchants/:id — single merchant detail.
   * Throws LagunaScopeError if not subscribed.
   */
  get(merchantId: string, filters?: { geo?: string }): Promise<MerchantDetail> {
    return this.client.request('GET', `merchants/${encodeURIComponent(merchantId)}`, { query: filters })
  }
}

class SubscriptionsResource {
  constructor(private readonly client: LagunaClient) {}

  list(filter?: { status?: SubscriptionStatus }): Promise<SubscriptionListResponse> {
    return this.client.request('GET', 'subscriptions', { query: filter })
  }

  /** Request subscription(s). Status starts at 'pending' until admin approves. */
  request(merchantIds: string[]): Promise<{ created: SubscriptionRequestResult[]; total: number; message: string }> {
    return this.client.request('POST', 'subscriptions', { body: { merchant_ids: merchantIds } })
  }

  /** Self-serve unsubscribe — immediate. */
  unsubscribe(merchantId: string): Promise<{ merchant_id: string; status: SubscriptionStatus; message: string }> {
    return this.client.request('DELETE', `subscriptions/${encodeURIComponent(merchantId)}`)
  }
}

class LinksResource {
  constructor(private readonly client: LagunaClient) {}

  /**
   * Mint a tracked shortlink. Open it in the user's browser — Laguna's
   * tracking takes over from there.
   */
  create(params: CreateLinkParams, options?: { idempotencyKey?: string }): Promise<CreateLinkResult> {
    return this.client.request('POST', 'links', { body: params, idempotencyKey: options?.idempotencyKey })
  }
}

class DisbursementsResource {
  constructor(private readonly client: LagunaClient) {}

  /**
   * POST /v1/disburse — Model 1 only. Sends user_amount on-chain to the
   * given user wallet. Idempotent on transaction_id.
   */
  create(params: DisburseParams): Promise<DisburseResult> {
    return this.client.request('POST', 'disburse', { body: params, idempotencyKey: params.transaction_id })
  }

  /** Poll status. */
  get(disbursementId: string): Promise<DisbursementDetail> {
    return this.client.request('GET', `disbursements/${encodeURIComponent(disbursementId)}`)
  }
}

class EarningsResource {
  constructor(private readonly client: LagunaClient) {}

  get(): Promise<Earnings> {
    return this.client.request('GET', 'earnings')
  }
}

class WithdrawalsResource {
  constructor(private readonly client: LagunaClient) {}

  /** Create a withdrawal — Models 2 (fallback) + 3 (manual settlement). */
  create(params: CreateWithdrawalParams): Promise<Withdrawal> {
    return this.client.request('POST', 'withdrawals', { body: params })
  }

  get(withdrawalId: string): Promise<Withdrawal> {
    return this.client.request('GET', `withdrawals/${encodeURIComponent(withdrawalId)}`)
  }
}

class WebhooksResource {
  constructor(private readonly secret: string | undefined) {}

  /**
   * Verify the X-Laguna-Signature header on an inbound webhook.
   *
   * @param rawBody The exact request body string — DO NOT JSON.parse first
   * @param signatureHeader The value of the X-Laguna-Signature request header
   *                        (format: `sha256=<hex>`)
   * @returns true if the signature matches, false otherwise
   * @throws Error if no webhookSecret was configured on the client
   */
  verify(rawBody: string, signatureHeader: string | null | undefined): boolean {
    if (!this.secret) {
      throw new Error('LagunaClient: webhookSecret not configured. Pass it to the constructor to enable verify().')
    }
    return verifyWebhookSignature(rawBody, signatureHeader, this.secret)
  }
}

// ---------- Helpers ----------

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function extractMessage(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined
  const obj = body as Record<string, unknown>
  if (typeof obj.message === 'string') return obj.message
  if (typeof obj.error === 'string') return obj.error
  return undefined
}

function backoffMs(attempt: number): number {
  // Exponential backoff with jitter: 200ms, 600ms, 1.4s, 3s, ...
  const base = 200 * Math.pow(2, attempt - 1)
  const jitter = Math.random() * 100
  return Math.min(base + jitter, 5000)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
