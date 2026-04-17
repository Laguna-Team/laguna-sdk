import { createHmac } from 'crypto'
import { describe, expect, it } from 'vitest'
import { parseWebhook, verifyWebhookSignature } from './webhooks'
import { LagunaWebhookSignatureError } from './errors'

const secret = 'test-webhook-secret-deadbeef'
const sign = (body: string) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`

const samplePayload = {
  event_type: 'conversion.confirmed',
  partner_user_id: 'cust_abc123',
  merchant_id: 'shopee',
  transaction_id: 'txn_xyz',
  status: 'confirmed',
  gross_commission: 5.0,
  user_amount: 3.5,
  partner_amount: 0.5,
  earned_rate_pct: 7.0,
  geo_at_purchase: 'SG',
  settlement_token: 'USDC',
  conversion_id: 'conv_internal_id',
  occurred_at: '2026-04-17T12:00:00.000Z',
}

describe('verifyWebhookSignature', () => {
  it('returns true for a valid signature', () => {
    const body = JSON.stringify(samplePayload)
    expect(verifyWebhookSignature(body, sign(body), secret)).toBe(true)
  })

  it('returns false for a tampered body', () => {
    const original = JSON.stringify(samplePayload)
    const signature = sign(original)
    const tampered = JSON.stringify({ ...samplePayload, user_amount: 999 })
    expect(verifyWebhookSignature(tampered, signature, secret)).toBe(false)
  })

  it('returns false when secret is wrong', () => {
    const body = JSON.stringify(samplePayload)
    expect(verifyWebhookSignature(body, sign(body), 'wrong-secret')).toBe(false)
  })

  it('returns false when signature header is missing or null', () => {
    expect(verifyWebhookSignature('{}', null, secret)).toBe(false)
    expect(verifyWebhookSignature('{}', undefined, secret)).toBe(false)
    expect(verifyWebhookSignature('{}', '', secret)).toBe(false)
  })

  it('returns false for malformed signature header', () => {
    expect(verifyWebhookSignature('{}', 'not-a-signature', secret)).toBe(false)
    expect(verifyWebhookSignature('{}', 'md5=abc', secret)).toBe(false)
    expect(verifyWebhookSignature('{}', 'sha256=', secret)).toBe(false)
    expect(verifyWebhookSignature('{}', 'sha256=tooshort', secret)).toBe(false)
  })

  it('returns false for non-hex signature', () => {
    // 64 chars but not hex
    expect(verifyWebhookSignature('{}', 'sha256=' + 'z'.repeat(64), secret)).toBe(false)
  })

  it('returns false when comparing different-length digests', () => {
    // 32 hex chars (md5-like) — regex rejects, returns false
    expect(verifyWebhookSignature('{}', 'sha256=' + 'a'.repeat(32), secret)).toBe(false)
  })

  it('handles uppercase sha256= prefix', () => {
    const body = '{}'
    const sig = sign(body).replace('sha256=', 'SHA256=')
    expect(verifyWebhookSignature(body, sig, secret)).toBe(true)
  })

  it('handles uppercase hex digest', () => {
    const body = '{}'
    const sig = sign(body)
    const upper = `sha256=${sig.split('=')[1]!.toUpperCase()}`
    expect(verifyWebhookSignature(body, upper, secret)).toBe(true)
  })
})

describe('parseWebhook', () => {
  it('returns parsed payload when signature is valid', () => {
    const body = JSON.stringify(samplePayload)
    const event = parseWebhook(body, sign(body), secret)
    expect(event.event_type).toBe('conversion.confirmed')
    expect(event.user_amount).toBe(3.5)
  })

  it('throws LagunaWebhookSignatureError when signature is invalid', () => {
    const body = JSON.stringify(samplePayload)
    expect(() => parseWebhook(body, 'sha256=' + 'a'.repeat(64), secret)).toThrow(LagunaWebhookSignatureError)
  })

  it('throws SyntaxError when body is not JSON (after signature passes)', () => {
    const body = 'not-json'
    expect(() => parseWebhook(body, sign(body), secret)).toThrow(SyntaxError)
  })
})
