# Laguna Whitelabel API Reference (non-SDK)

Raw REST reference for the Laguna Whitelabel API, for integrators not using
`@laguna-team/whitelabel-sdk` (other languages, direct HTTP). Generated from
the `laguna-agent-backend` and `backend_worker` source as of **2026-08-06**.
If you're on Node/TypeScript, prefer the [SDK](./README.md) — this document
describes the wire protocol it wraps.

> This file documents behavior observed in code, not a hand-maintained spec.
> Endpoints under **Internal** / **Admin** are not partner-facing and are
> listed only for completeness.

## Base URL

| API key prefix | Environment | Base URL |
|---|---|---|
| `lg_live_*` | Production | `https://api.laguna.network` |
| `lg_test_*` | Staging (sandbox) | `https://api-stg.laguna.network` |

All partner endpoints below are mounted under `/api/v1/...` (global `api`
prefix + controller `v1` prefix).

## Authentication

Two distinct auth modes share the same `Authorization: Bearer <token>`
header and the same route table. The server picks the mode by prefix-sniffing
the token.

### 1. Partner API key (server-to-server)

```
Authorization: Bearer lg_live_xxxxxxxx
Authorization: Bearer lg_test_xxxxxxxx
```

- `lg_test_*` keys operate in sandbox mode: conversions/links are flagged
  `isSandbox`, never touch live balances, and unlock `POST /v1/test/conversions`.
- Keys are SHA-256 hashed server-side and cached for 5 minutes — a revoked
  key can remain accepted for up to 5 minutes after revocation.
- Invalid prefix → `401 INVALID_API_KEY_FORMAT`. Unknown/revoked key →
  `401 INVALID_API_KEY`. Suspended partner → `401 PARTNER_SUSPENDED`.

### 2. JWT session (consumer / whitelabel wallet UI)

Used by Laguna-built whitelabel front-ends (e.g. MiniPay), not by
server-side partner integrations. A session token is minted via:

```
POST /api/v1/minipay/launch-session
```

Body: `{ partner_code?, uid?, address?, geo?, isBypass? }` (one of
`partner_code` or the `x-provider` header identifies the partner).
Returns `{ data: { access_tokens, refresh_token, authLevel, scopes,
partnerCode, userId } }`.

"Limited" JWT sessions are restricted to an explicit per-route scope list —
each scope only unlocks the routes below, enforced server-side regardless of
what the token claims:

| Scope | Unlocks |
|---|---|
| `merchant:read` | `GET /v1/catalog`, `/v1/merchants`, `/v1/merchants/:id`, `/v1/categories` |
| `link-refer:create` | `POST /v1/links` |
| `wallet:read` | `GET /v1/me/conversions`, `/v1/me/withdrawals`, `/v1/me/withdrawals/:id` |
| `wallet:withdraw` | `POST /v1/me/withdrawals` |

For `POST /v1/links` under JWT auth, `partner_user_id` is *derived* from the
token's wallet address — do not (and cannot) pass it in the body.

Public partner config lookup (branding, no auth): `GET /partner-config`
(`x-provider` header or `?partner_code=`, or infers from a JWT if present).

---

## Partner API key endpoints

All require `Authorization: Bearer lg_live_*|lg_test_*`. Endpoints marked
**subscribed** additionally require the partner to be **approved** for the
merchant (`403 MERCHANT_NOT_SUBSCRIBED` otherwise) — see [Subscriptions](#subscriptions).

### Catalog

#### `GET /v1/catalog`
Full merchant catalog, **not** scope-filtered — use this at integration time
to decide what to subscribe to.

Query: `geo?`, `category?`, `limit?` (default 50, max 200)

```jsonc
// 200
{
  "merchants": [
    {
      "merchant_id": "shopee",
      "name": "Shopee",
      "category": "Shopping",
      "logo_url": "https://...",
      "supported_geos": ["SG", "MY"],
      "headline_rate": 4.5,
      // null = never requested; otherwise 'pending' | 'approved' | 'rejected' | 'revoked'
      "subscription_status": "approved"
    }
  ],
  "total": 1
}
```

#### `GET /v1/categories`
Not in the SDK. Top-level category browse, no scope filter.

Query: `geo?`

```jsonc
// 200
{ "categories": [
  { "name": "Shopping", "merchantCount": 42, "topCashbackRate": 8.0, "exampleMerchants": ["shopee", "lazada"] }
]}
```

#### `GET /v1/merchants` — rate refresh (**subscribed only**, implicit)
Returns full rate detail for every **approved** merchant on this key. No
`?ids=` — the server already knows your scope. Empty scope → `{ merchants: [], total: 0, cache_ttl }`.

Query: `geo?`, `keyword?` (server-side search intersected with your approved set)

Response: `{ merchants: MerchantDetail[], total, cache_ttl }` — cache for
`cache_ttl` seconds (currently 3600) client-side; don't poll per user request.

#### `GET /v1/merchants/:id` — single merchant (**subscribed**)
Query: `geo?`. `403 MERCHANT_NOT_SUBSCRIBED` if not approved.

**`MerchantDetail` shape (full — the SDK's type only covers the first block):**

```jsonc
{
  "merchant_id": "shopee", "name": "Shopee", "logo_url": "...", "category": "Shopping",
  "best_rate": 4.5, "rate_note": "Up to 4.5% depending on category",
  "category_rates": [{ "sub_category": "Electronics", "rate": 3.0 }],
  "cookie_days": 7, "payout_days": 45,
  "supported_geos": ["SG", "MY"], "cache_ttl": 3600, "available": true,

  // --- i18n (added 2026-07-14/15, not in SDK types) ---
  "i18n": {
    "category": { "en": "Shopping", "vi": "Mua sắm" },
    "category_rates": [{ "sub_category": "Electronics", "translations": { "en": "Electronics" } }]
  },

  // --- additive fields for compatibility with the main backend's merchant-list shape ---
  "description": "...", "url": "https://shopee.sg", "imgUrl": ["..."],
  "slugId": "shopee", "canonicalMerchantId": "shopee",
  "highestRate": 4.5, "maxCashbackRate": 4.5,
  "rateCashbackMax": 4.5, "rateCashbackMin": 1.0,
  "dayEndText": null, "isUpsize": false, "infoTier": null, "configTierToken": null,
  "iconTokenMax": null, "iconTokenMin": null, "isDisplayTier": false, "cashbackHighestIcon": null,
  "dos": null, "donts": null, "trackingTimeLine": [], "termAndCondition": null,
  "trackTime": 7, "withdrawableTime": 45, "isClickId": false,
  "tags": [], "thirdPartyType": null, "position": null, "backgroundColor": null
}
```

Treat everything after the first block as **unstable/undocumented
compatibility fields** — they mirror the internal admin merchant-list shape
and may change without notice. Rely only on the first block for a public
contract.

### Subscriptions

Partners must be **approved**-subscribed before minting links or seeing
rates for a merchant.

- `GET /v1/subscriptions?status=pending|approved|rejected|revoked` →
  `{ subscriptions: Subscription[], total }`
- `POST /v1/subscriptions` body `{ merchant_ids: string[] }` → creates
  `pending` requests (admin review) →
  `{ created: [{ id, merchant_id, status, requested_at }], total, message }`
- `DELETE /v1/subscriptions/:merchant_id` — self-serve, immediate →
  `{ merchant_id, status: 'revoked', message }`

### Links

#### `POST /v1/links` — mint a tracked shortlink (**subscribed**)

```jsonc
// request — geo is REQUIRED (server 400s without it; the SDK's TS type
// currently marks it optional — see audit notes)
{ "merchant_id": "shopee", "partner_user_id": "user_abc123", "geo": "SG", "target_url": "https://shopee.sg/product/abc" }
```

```jsonc
// 201
{ "shortlink": "https://go.laguna.network/r/AbC123xy", "shortcode": "AbC123xy", "merchant_id": "shopee", "partner_user_id": "user_abc123" }
```

Errors: `400` missing `merchant_id`/`geo` or no route for that geo; `403`
`partner_user_id` missing (API-key mode) or merchant not subscribed.
Idempotency-Key header supported. Rate limit: **100,000 links/partner/day**
→ `429` (see [Rate limits](#rate-limits)).

#### `GET /v1/links` — not in the SDK
List the partner's minted links with click/conversion counts.

Query: `partner_user_id?`, `limit?`, `offset?`

```jsonc
{ "links": [
  { "id": "...", "shortcode": "AbC123xy", "merchant_id": "shopee", "merchant_name": "Shopee",
    "partner_user_id": "user_abc123", "status": "active",
    "click_count": 3, "conversion_count": 1, "created_at": "2026-08-01T00:00:00.000Z" }
], "total": 1 }
```

### Sandbox test mode — `POST /v1/test/conversions` (not in the SDK)

**Sandbox key only** (`lg_test_*`; a live key gets `403`). Fabricates a
confirmed conversion on one of your own already-clicked links and delivers
real signed `conversion.pending` → `conversion.confirmed` webhooks, so you
can exercise your full integration without a real purchase. Flagged
`isSimulated` downstream — never touches live balances or triggers payout.

Flow: mint link (sandbox key) → open `/r/<shortcode>` once (registers a
click) → `POST /v1/test/conversions`.

```jsonc
// request
{ "shortcode": "AbC123xy", "order_value": 100, "gross_rate_pct": 5 } // or link_id instead of shortcode
```

```jsonc
// response
{ "ok": true, "conversion_id": "...", "conversion_status": "confirmed", "net_commission": 4.2,
  "partner_id": "...", "partner_user_id": "user_abc123", "shortcode": "AbC123xy",
  "network_order_id": "...", "webhook_event_id": "...", "webhook_status": "delivered" }
```

### Disbursements — Model 1 only

#### `POST /v1/disburse`
Idempotent on `transaction_id` (must match a **confirmed** conversion's
`network_order_id` for this partner). `403 WRONG_PAYOUT_MODE` if the partner
isn't on `model_1_user_wallet`.

```jsonc
// request
{ "transaction_id": "order_xyz", "user_wallet_address": "0x..." }
```
```jsonc
// 200/201
{ "disbursement_id": "...", "status": "processing", "amount_usdc": 4.2,
  "destination_wallet": "0x...", "withdrawable_code": "AbC12345", // ← not in SDK's DisburseResult type
  "message": "Disbursement queued. Poll GET /v1/disbursements/:id for status." }
```
Repeat calls with the same `transaction_id` after completion →
`409-ish` domain error `DISBURSEMENT_ALREADY_PROCESSED`.

#### `GET /v1/disbursements/:id`
```jsonc
{ "disbursement_id": "...", "transaction_id": "order_xyz", "withdrawable_code": "AbC12345",
  "status": "completed", "amount_usdc": 4.2, "destination_wallet": "0x...",
  "chain": "base", "tx_hash": "0x...", "created_at": "..." }
```

### Earnings + withdrawals — Models 2/3

`GET /v1/earnings` → `{ pending, available, total_earned, total_withdrawn, total_disbursed, settlement_token }`.

`POST /v1/withdrawals` (not for Model 1 — use `/v1/disburse`) body
`{ amount }`. Destination wallet always comes from the partner record, never
the request body. Response includes `payout_token` and `withdrawable_code` —
**both missing from the SDK's `Withdrawal` type**.

`GET /v1/withdrawals/:id` — same shape.

### Consumer wallet endpoints — JWT auth only, not reachable via the SDK

- `GET /v1/me/conversions?page=&perPage=` — current JWT user's conversion
  history + wallet balance summary (`wallet.{totalBalance,availableBalance,pendingBalance,...}`).
- `POST /v1/me/withdrawals` body `{ amount }` — user pulls from their
  whitelabel wallet (Model 1 only).
- `GET /v1/me/withdrawals?page=&perPage=`, `GET /v1/me/withdrawals/:id`.

---

## Webhooks

Fired to `partner.webhookUrl` on conversion state changes:
`conversion.pending` (on click→order postback) → `conversion.confirmed` or
`conversion.reversed`.

> **The SDK's `WebhookEventType` union only lists `conversion.confirmed` and
> `conversion.reversed` — `conversion.pending` is a real event type you will
> receive and is currently untyped in the SDK.**

Request: `POST <your webhookUrl>`, JSON body, headers:

| Header | Value |
|---|---|
| `Content-Type` | `application/json` |
| `X-Laguna-Signature` | `sha256=<hex hmac>` — **only sent if you've configured a webhook secret**; omitted entirely otherwise |
| `X-Laguna-Partner-Id` | your partner id |
| `X-Laguna-Event-Type` | `conversion.pending` \| `conversion.confirmed` \| `conversion.reversed` |
| `X-Laguna-Event-Id` | idempotency key for this delivery attempt |
| `X-Laguna-Attempt` | attempt number, starting at 1 |

Signature: `hex(HMAC_SHA256(secret, raw_json_body))`, compared against the
`sha256=` prefix — identical scheme to `verifyWebhookSignature()` in the SDK.

Body (`WebhookPayload` — matches the SDK's type):
```jsonc
{
  "event_type": "conversion.confirmed", "partner_user_id": "user_abc123", "merchant_id": "shopee",
  "transaction_id": "order_xyz", "status": "confirmed",
  "gross_commission": 10.0, "user_amount": 4.2, "partner_amount": 2.0,
  "earned_rate_pct": 4.5, "geo_at_purchase": "SG", "settlement_token": "USDC",
  "conversion_id": "...", "occurred_at": "2026-08-06T00:00:00.000Z"
}
```

Retry schedule on non-2xx / network error / timeout (5s):
**1m → 5m → 30m → 2h → 8h**, then `dead_letter` (requires manual replay by
Laguna ops — there's no partner-facing endpoint to trigger a replay).

If you never respond 2xx and don't have a webhook configured at all, nothing
is sent — settlement still happens, but you'll only see it by polling
`GET /v1/links`, `/v1/disbursements/:id`, `/v1/earnings`, etc.

## Errors

All error bodies: `{ "message": "...", "code"?: "...", ... }` (code present
for domain exceptions; generic HTTP errors only have `message`).

| HTTP | code | Meaning |
|---|---|---|
| 401 | `INVALID_API_KEY_FORMAT` | Bearer token isn't `lg_live_*`/`lg_test_*` and isn't a valid JWT |
| 401 | `INVALID_API_KEY` | Key not found or revoked |
| 401 | `PARTNER_SUSPENDED` | Partner account suspended |
| 403 | `MERCHANT_NOT_SUBSCRIBED` | Not approved for this merchant — `POST /v1/subscriptions` first |
| 403 | `WRONG_PAYOUT_MODE` | e.g. calling `/v1/disburse` on a Model 2/3 partner, or `/v1/withdrawals` on Model 1 |
| 400 | `WALLET_REQUIRED` | Partner has no wallet on file (withdrawals) |
| 400 | `CONVERSION_NOT_FOUND` | `transaction_id` doesn't match a confirmed conversion for this partner |
| 409-ish (domain) | `DISBURSEMENT_ALREADY_PROCESSED` | Retried a `transaction_id` that already completed |
| 429 | `rate_limit_exceeded` | See below |
| 400/422 | — | Validation errors, generic `message` |
| 5xx | — | Server error |

## Rate limits

There is **no general per-request rate limit** on the whitelabel API today.
The only enforced limit is **link minting**: 100,000 `POST /v1/links` per
partner per UTC day. On breach:

```jsonc
// 429
{ "statusCode": 429, "error": "rate_limit_exceeded",
  "message": "Daily partner_mint_link limit exceeded (100000/day). Resets at midnight UTC.",
  "limit": 100000, "window": "1d", "retryAfter": 3421 }
```

> **Note for SDK users:** the retry delay is in the JSON body (`retryAfter`,
> seconds), *not* a `Retry-After` HTTP header. The SDK's
> `LagunaRateLimitError.retryAfterSeconds` reads the header, which the
> server never sets — so today it will always come back `undefined`. Read
> `retryAfter` from the parsed response body instead until this is fixed.

## Caching

`GET /v1/merchants` and `/v1/merchants/:id` return `cache_ttl` (currently
3600s) — cache rates for that long server-side rather than calling on every
end-user page view. `GET /v1/catalog` has no `cache_ttl`; it's meant for
integration-time discovery, not a hot path.
