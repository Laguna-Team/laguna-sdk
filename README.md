# @laguna/whitelabel-sdk

[![npm version](https://img.shields.io/npm/v/@laguna/whitelabel-sdk.svg)](https://www.npmjs.com/package/@laguna/whitelabel-sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](https://www.typescriptlang.org/)

Official TypeScript SDK for the **Laguna Whitelabel API** — embed crypto cashback in your app.

- ✅ Zero runtime dependencies (uses native `fetch` and Node's `crypto`)
- ✅ Strict TypeScript types for every endpoint and webhook payload
- ✅ Built-in retry with exponential backoff for transient failures
- ✅ HMAC-SHA256 webhook signature verification with constant-time compare
- ✅ Idempotency-Key support on POST endpoints
- ✅ ESM + CJS dual package, Node 18+

## Install

```bash
npm install @laguna/whitelabel-sdk
# or
pnpm add @laguna/whitelabel-sdk
# or
yarn add @laguna/whitelabel-sdk
```

## Quick start

```ts
import { LagunaClient } from '@laguna/whitelabel-sdk'

const laguna = new LagunaClient({
  apiKey: process.env.LAGUNA_API_KEY!,           // lg_live_... or lg_test_...
  webhookSecret: process.env.LAGUNA_WEBHOOK_SECRET!,
})

// 1. Discover merchants at integration time
const catalog = await laguna.catalog.list({ geo: 'SG' })

// 2. Subscribe (admin will approve)
await laguna.subscriptions.request(['shopee', 'lazada'])

// 3. After approval, refresh rates server-side on a cron
const { merchants, cache_ttl } = await laguna.merchants.list({ geo: 'SG' })
// → store rates in your DB; refresh every `cache_ttl` seconds

// 4. When a user taps a merchant
const link = await laguna.links.create({
  merchant_id: 'shopee',
  partner_user_id: 'cust_abc123',  // your internal user ID — opaque to Laguna
  geo: 'SG',
})
// → open `link.shortlink` in the user's browser
```

## The three payout models

How cashback reaches your users depends on the model agreed at onboarding:

| Model | Disbursement | Best for |
|---|---|---|
| **1 — User Wallet** | You call `POST /v1/disburse` after each webhook. Laguna sends `user_amount` on-chain to the user's wallet. | Web3 wallets, crypto-native apps |
| **2 — Partner Wallet** | Laguna auto-sends `user_amount + partner_amount` to your registered wallet on every confirmed conversion. You credit your user off-platform. | Apps with in-app rewards, loyalty points, non-crypto users |
| **3 — Manual Settlement** | Funds accumulate at Laguna. Settled at agreed cadence (weekly/monthly) via off-platform transfer. | Fiat-first, batch settlement, traditional finance |

Your model is fixed at onboarding — contact your Laguna account manager to discuss.

## Verifying webhooks

When a confirmed purchase fires the webhook, verify the `X-Laguna-Signature` header before processing:

```ts
// Express (with raw body parser)
import express from 'express'
import { LagunaClient, parseWebhook } from '@laguna/whitelabel-sdk'

const laguna = new LagunaClient({
  apiKey: process.env.LAGUNA_API_KEY!,
  webhookSecret: process.env.LAGUNA_WEBHOOK_SECRET!,
})

app.post('/webhook/laguna',
  express.raw({ type: 'application/json' }),  // CRITICAL: raw body needed for signature
  async (req, res) => {
    try {
      const event = parseWebhook(
        req.body.toString('utf8'),
        req.headers['x-laguna-signature'] as string,
        process.env.LAGUNA_WEBHOOK_SECRET!
      )

      // Type-safe! event is WebhookPayload
      console.log(`User ${event.partner_user_id} earned ${event.user_amount} ${event.settlement_token}`)

      // Model 1: trigger on-chain disburse to user wallet
      if (event.event_type === 'conversion.confirmed') {
        const userWallet = await db.getUserWallet(event.partner_user_id)
        await laguna.disbursements.create({
          transaction_id: event.transaction_id,  // idempotent on this
          user_wallet_address: userWallet,
        })
      }

      res.sendStatus(200)
    } catch (err) {
      res.status(401).json({ error: 'Invalid signature' })
    }
  }
)
```

**Important**: Always verify against the raw request body. `JSON.parse` then `JSON.stringify` produces different bytes (key order, whitespace) and the signature will fail.

## Disbursement (Model 1)

```ts
import { LagunaClient } from '@laguna/whitelabel-sdk'

// In your webhook handler, after verifying signature:
const result = await laguna.disbursements.create({
  transaction_id: event.transaction_id,
  user_wallet_address: '0xUSER_WALLET_ADDRESS',
})

// result.disbursement_id — poll for status
const status = await laguna.disbursements.get(result.disbursement_id)
console.log(status.tx_hash)  // populated when status === 'completed'
```

The `transaction_id` acts as an idempotency key — safely retry on network failure.

## Earnings + withdrawals

```ts
// Check current balance
const earnings = await laguna.earnings.get()
console.log(`${earnings.available} ${earnings.settlement_token} ready to withdraw`)

// Manual withdraw (Model 2 fallback / Model 3 primary)
const w = await laguna.withdrawals.create({ amount: 100 })
const status = await laguna.withdrawals.get(w.withdrawal_id)
```

Wallet address comes from your partner record — never accepted in the request body. This prevents funds redirection if your API key is compromised.

## Subscription model

Partners must be **approved-subscribed** to a merchant before they can query rates or mint links for it.

```ts
// 1. Discover what's available (no scope filter)
const catalog = await laguna.catalog.list({ geo: 'SG' })
//    → each merchant has subscription_status: 'pending' | 'approved' | 'rejected' | 'revoked' | null

// 2. Request access — Laguna admin reviews
const result = await laguna.subscriptions.request(['shopee', 'lazada', 'zalora'])
//    → result.created with status: 'pending'

// 3. Check your subscriptions
const subs = await laguna.subscriptions.list({ status: 'approved' })

// 4. Self-serve unsubscribe (immediate)
await laguna.subscriptions.unsubscribe('shopee')
```

Trying to mint a link for a non-subscribed merchant throws `LagunaScopeError`.

## Error handling

All SDK errors extend `LagunaError`:

```ts
import {
  LagunaError,
  LagunaAuthError,        // 401 — invalid/revoked API key
  LagunaScopeError,       // 403 — merchant not subscribed
  LagunaValidationError,  // 400/422 — invalid request
  LagunaRateLimitError,   // 429 — has retryAfterSeconds
  LagunaServerError,      // 5xx — auto-retried
  LagunaNetworkError,     // network failure / timeout
} from '@laguna/whitelabel-sdk'

try {
  await laguna.links.create({ merchant_id: 'unknown', partner_user_id: 'x' })
} catch (err) {
  if (err instanceof LagunaScopeError) {
    console.log('Need to subscribe first')
  } else if (err instanceof LagunaRateLimitError) {
    console.log(`Rate limited, retry in ${err.retryAfterSeconds}s`)
  } else if (err instanceof LagunaError) {
    console.log(`Laguna error ${err.code}: ${err.message}`)
  }
}
```

## Configuration

```ts
const laguna = new LagunaClient({
  apiKey: 'lg_live_...',                   // required
  webhookSecret: '...',                    // required for webhooks.verify()
  baseUrl: 'https://api.laguna.network',   // default
  timeoutMs: 30_000,                       // per-request timeout
  maxRetries: 2,                           // for transient 5xx + network errors
  fetch: customFetch,                      // override (testing, polyfills)
})
```

## TypeScript

Every endpoint returns a strict type. Webhook payloads are typed via `WebhookPayload`:

```ts
import type { WebhookPayload, MerchantDetail } from '@laguna/whitelabel-sdk'
```

## Sandbox vs production

- **Live keys** (`lg_live_*`): production data, real on-chain disbursements
- **Sandbox keys** (`lg_test_*`): isolated test data, dry-run disbursements

Both auth against the same `https://api.laguna.network`. The prefix tells the server which dataset to use.

## API reference

Full reference: https://laguna.network/developers/whitelabel  *(coming soon)*

## Support

- Issues: https://github.com/Laguna-10xlab/laguna-whitelabel-sdk/issues
- Email: team@laguna.network
- Docs: https://docs.laguna.network

## License

MIT © Laguna
