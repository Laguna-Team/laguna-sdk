import { createHmac, timingSafeEqual } from 'crypto'
import { LagunaWebhookSignatureError } from './errors'
import type { WebhookPayload } from './types'

/**
 * Constant-time HMAC-SHA256 verification of a Laguna webhook signature.
 *
 * The signature header is `X-Laguna-Signature: sha256=<hex>`. We extract the
 * hex digest, compute our own digest over `rawBody` using `secret`, and
 * compare both with `timingSafeEqual` to avoid timing-attack leakage.
 *
 * IMPORTANT: pass the raw request body as a string, NOT a parsed JSON object.
 * Re-serializing JSON can produce different bytes (key order, whitespace) and
 * the signature will fail to verify.
 */
export function verifyWebhookSignature(rawBody: string, signatureHeader: string | null | undefined, secret: string): boolean {
  if (!signatureHeader || typeof signatureHeader !== 'string') return false

  const match = /^sha256=([a-f0-9]{64})$/i.exec(signatureHeader.trim())
  if (!match) return false
  const provided = match[1]!

  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')

  // Both buffers must be the same length for timingSafeEqual.
  // Fixed length (64 hex chars) is enforced by the regex above + sha256 output.
  const a = Buffer.from(provided, 'hex')
  const b = Buffer.from(expected, 'hex')
  if (a.length !== b.length) return false

  return timingSafeEqual(a, b)
}

/**
 * Convenience wrapper: verify + JSON.parse in one step. Throws
 * `LagunaWebhookSignatureError` if signature is invalid; throws
 * `SyntaxError` if body isn't valid JSON.
 *
 * @example
 * ```ts
 * app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
 *   try {
 *     const event = parseWebhook(
 *       req.body.toString('utf8'),
 *       req.headers['x-laguna-signature'],
 *       process.env.LAGUNA_WEBHOOK_SECRET!
 *     )
 *     // event is typed as WebhookPayload
 *     await creditUser(event.partner_user_id, event.user_amount)
 *     res.sendStatus(200)
 *   } catch (err) {
 *     res.status(401).json({ error: 'Invalid signature' })
 *   }
 * })
 * ```
 */
export function parseWebhook(rawBody: string, signatureHeader: string | null | undefined, secret: string): WebhookPayload {
  if (!verifyWebhookSignature(rawBody, signatureHeader, secret)) {
    throw new LagunaWebhookSignatureError()
  }
  return JSON.parse(rawBody) as WebhookPayload
}
