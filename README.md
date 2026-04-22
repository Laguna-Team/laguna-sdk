# Laguna Whitelabel TypeScript SDK

[![npm version](https://img.shields.io/npm/v/@laguna-team/whitelabel-sdk.svg)](https://www.npmjs.com/package/@laguna-team/whitelabel-sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

The Laguna Whitelabel SDK provides convenient access to the Laguna Whitelabel API from applications written in server-side TypeScript or JavaScript. Embed crypto cashback into your app: discover affiliate merchants, mint tracked links, verify webhooks, and disburse USDC settlements.

## Documentation

See the [API reference](https://docs.laguna.network/whitelabel) for complete endpoint documentation. This README covers SDK usage; the API docs cover the underlying request/response shapes, error codes, and rate limits.

## Requirements

- Node.js 18+ (uses native `fetch` and `crypto.subtle`)
- A Laguna API key (sandbox `lg_test_*` or live `lg_live_*`) from your Laguna account manager

## Installation

```bash
npm install @laguna-team/whitelabel-sdk
```

```bash
pnpm add @laguna-team/whitelabel-sdk
```

```bash
yarn add @laguna-team/whitelabel-sdk
```

## Usage

The library needs to be configured with your account's API key. Pass it to `LagunaClient` on instantiation:

```ts
import { LagunaClient } from '@laguna-team/whitelabel-sdk'

const laguna = new LagunaClient({
  apiKey: process.env.LAGUNA_API_KEY!,
})

const link = await laguna.links.create({
  merchant_id: 'shopee',
  partner_user_id: 'user_abc123', // your internal user ID — opaque to Laguna
  geo: 'SG',
})

console.log(link.shortlink) // open this in the user's browser
```

### TypeScript

The library is written in TypeScript and ships with type definitions. All request and response payloads are strictly typed:

```ts
import type {
  CatalogResponse,
  MerchantDetail,
  CreateLinkParams,
  CreateLinkResult,
  WebhookPayload,
} from '@laguna-team/whitelabel-sdk'
```

## Resources

The SDK is organized by resource. Each resource exposes a small set of methods that mirror the REST endpoints.

### `catalog` — discover merchants

```ts
const { merchants } = await laguna.catalog.list({ geo: 'SG' })
// each merchant has `subscription_status`: 'pending' | 'approved' | 'rejected' | 'revoked' | null
```

### `subscriptions` — request access to merchants

Partners must be **approved-subscribed** to a merchant before minting links for it.

```ts
await laguna.subscriptions.request(['shopee', 'lazada'])
const subs = await laguna.subscriptions.list({ status: 'approved' })
await laguna.subscriptions.unsubscribe('shopee') // self-serve
```

### `merchants` — refresh live rates

```ts
const { merchants, cache_ttl } = await laguna.merchants.list({ geo: 'SG' })
// store rates in your DB; refresh every `cache_ttl` seconds
```

### `links` — mint a tracked link

```ts
const link = await laguna.links.create({
  merchant_id: 'shopee',
  partner_user_id: 'user_abc123',
  geo: 'SG',
})
```

### `disbursements` — pay out to a user wallet (Model 1)

```ts
const result = await laguna.disbursements.create({
  transaction_id: event.transaction_id, // idempotent on this
  user_wallet_address: '0xUSER_WALLET',
})

const status = await laguna.disbursements.get(result.disbursement_id)
console.log(status.tx_hash) // populated when status === 'completed'
```

### `earnings` — check accrued balance

```ts
const earnings = await laguna.earnings.get()
console.log(`${earnings.available} ${earnings.settlement_token} ready to withdraw`)
```

### `withdrawals` — settle to your registered wallet

```ts
const w = await laguna.withdrawals.create({ amount: 100 })
const status = await laguna.withdrawals.get(w.withdrawal_id)
```

The destination wallet address is taken from your partner record on file — never accepted in the request body. This prevents funds redirection if your API key is compromised.

## Webhooks

Laguna sends an HTTP POST to your registered webhook URL whenever a conversion is confirmed or reversed. Verify the `X-Laguna-Signature` header before processing the body:

```ts
import express from 'express'
import { parseWebhook, LagunaWebhookSignatureError } from '@laguna-team/whitelabel-sdk'

app.post(
  '/webhooks/laguna',
  express.raw({ type: 'application/json' }), // raw body required
  (req, res) => {
    try {
      const event = parseWebhook(
        req.body.toString('utf8'),
        req.headers['x-laguna-signature'] as string,
        process.env.LAGUNA_WEBHOOK_SECRET!,
      )

      // event is typed as WebhookPayload
      console.log(`${event.partner_user_id} earned ${event.user_amount} ${event.settlement_token}`)
      res.sendStatus(200)
    } catch (err) {
      if (err instanceof LagunaWebhookSignatureError) {
        return res.status(401).json({ error: 'Invalid signature' })
      }
      throw err
    }
  },
)
```

> **Important**: verify against the **raw** request body. `JSON.parse(...)` then `JSON.stringify(...)` produces different bytes (key order, whitespace) and the signature will fail.

If you need a boolean check without parsing, use `verifyWebhookSignature(rawBody, signatureHeader, secret)` — same primitive, returns `true | false` instead of the parsed payload.

## Handling errors

When the SDK can't process a request, it throws a typed error:

```ts
import {
  LagunaError,
  LagunaAuthError,        // 401 — invalid or revoked API key
  LagunaScopeError,       // 403 — merchant not subscribed
  LagunaValidationError,  // 400 / 422 — invalid request
  LagunaRateLimitError,   // 429 — exposes `retryAfterSeconds`
  LagunaServerError,      // 5xx — automatically retried up to `maxRetries`
  LagunaNetworkError,     // network failure or timeout
} from '@laguna-team/whitelabel-sdk'

try {
  await laguna.links.create({ merchant_id: 'unknown', partner_user_id: 'x' })
} catch (err) {
  if (err instanceof LagunaScopeError) {
    // subscribe to the merchant first
  } else if (err instanceof LagunaRateLimitError) {
    console.log(`Retry in ${err.retryAfterSeconds}s`)
  } else if (err instanceof LagunaError) {
    console.log(`${err.code}: ${err.message}`)
  }
}
```

## Configuration

```ts
const laguna = new LagunaClient({
  apiKey: 'lg_live_...',                   // required
  webhookSecret: '...',                    // optional — used by webhook helpers
  baseUrl: 'https://api.laguna.network',   // default
  timeoutMs: 30_000,                       // per-request timeout in ms
  maxRetries: 2,                           // for transient 5xx + network errors
  fetch: customFetch,                      // override (testing, polyfills)
})
```

### Sandbox vs production

- **Sandbox keys** (`lg_test_*`) — isolated test data, dry-run disbursements
- **Live keys** (`lg_live_*`) — production data, real on-chain disbursements

Both authenticate against `https://api.laguna.network`. The key prefix tells the server which dataset to use.

### Retries

Transient failures (HTTP 5xx and network errors) are retried automatically with exponential backoff. POST endpoints accept an optional `Idempotency-Key` header so retries are safe:

```ts
await laguna.links.create(
  { merchant_id: 'shopee', partner_user_id: 'user_abc123' },
  { idempotencyKey: 'order_xyz_link_attempt_1' },
)
```

### Timeouts

Set `timeoutMs` on the client (default 30s):

```ts
const laguna = new LagunaClient({
  apiKey: process.env.LAGUNA_API_KEY!,
  timeoutMs: 5_000,
})
```

## Versioning

This package follows [semver](https://semver.org/). Breaking changes are released only in major versions and noted in the [GitHub releases](https://github.com/Laguna-Team/laguna-sdk/releases).

The SDK pins the API version it targets internally — upgrading the SDK is the supported way to access new endpoints. The base URL stays the same across versions.

## Contributing

Issues and pull requests are welcome on [GitHub](https://github.com/Laguna-Team/laguna-sdk). For commercial questions or to obtain API keys, contact `team@laguna.network`.

## License

[MIT](./LICENSE) © Laguna
