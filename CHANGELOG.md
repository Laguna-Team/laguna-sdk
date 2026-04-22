# Changelog

All notable changes to `@laguna-team/whitelabel-sdk` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1] — 2026-04-22

### Changed

- Documentation cleanup: README now focuses purely on partner-facing usage; internal infra notes removed.
- Fixed typed import example in README to reference real exported types (`CreateLinkResult` instead of the non-existent `Link`).
- Removed an invalid per-call timeout example for resource methods. Timeouts are configured on the `LagunaClient` constructor only.

### No code changes

This is a docs-only release. SDK behaviour is identical to `0.1.0`.

## [0.1.0] — 2026-04-22

### Added

Initial public release.

- `LagunaClient` with the following resources: `catalog`, `merchants`, `subscriptions`, `links`, `disbursements`, `earnings`, `withdrawals`, `webhooks`.
- HMAC-SHA256 webhook signature verification helpers: `parseWebhook` (returns parsed payload) and `verifyWebhookSignature` (returns boolean).
- Typed errors: `LagunaError` base class plus `LagunaAuthError`, `LagunaValidationError`, `LagunaScopeError`, `LagunaRateLimitError`, `LagunaServerError`, `LagunaNetworkError`, `LagunaWebhookSignatureError`.
- Built-in retry with exponential backoff for transient 5xx + network failures.
- `Idempotency-Key` support on POST endpoints (`links.create` exposes it via the second-arg options).
- Strict TypeScript types for every request and response payload, including `WebhookPayload`.
- ESM + CJS dual package targeting Node 18+.
- Sandbox (`lg_test_*`) and live (`lg_live_*`) API key support against the same `https://api.laguna.network` base URL.

[Unreleased]: https://github.com/Laguna-Team/laguna-sdk/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/Laguna-Team/laguna-sdk/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Laguna-Team/laguna-sdk/releases/tag/v0.1.0
