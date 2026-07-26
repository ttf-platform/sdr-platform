import { describe, expect, it } from 'vitest'
import {
  isNoRowsError,
  isTransientAuthError,
  isTransientDbError,
} from '../db-errors'
import { dbUnavailableResponse } from '../db-errors-response'

describe('isNoRowsError', () => {
  it('is true only for PGRST116', () => {
    expect(isNoRowsError({ code: 'PGRST116' })).toBe(true)
  })
  it('is false for any other PostgREST / Postgres error code', () => {
    expect(isNoRowsError({ code: '57014' })).toBe(false)         // statement_timeout
    expect(isNoRowsError({ code: '23505' })).toBe(false)         // unique_violation
    expect(isNoRowsError({ code: 'PGRST301' })).toBe(false)      // JWT expired
    expect(isNoRowsError({ code: 'network_error' })).toBe(false)
  })
  it('is false for nullish / non-object inputs', () => {
    expect(isNoRowsError(null)).toBe(false)
    expect(isNoRowsError(undefined)).toBe(false)
    expect(isNoRowsError('PGRST116')).toBe(false)                // string ≠ object.code
    expect(isNoRowsError({})).toBe(false)
  })
})

describe('isTransientDbError', () => {
  it('is false for null / no error', () => {
    expect(isTransientDbError(null)).toBe(false)
    expect(isTransientDbError(undefined)).toBe(false)
  })
  it('is false for PGRST116 (no-rows is a legit signal, not transient)', () => {
    expect(isTransientDbError({ code: 'PGRST116' })).toBe(false)
  })
  it('is true for any other non-null error object (5xx, timeout, network)', () => {
    expect(isTransientDbError({ code: '57014' })).toBe(true)     // statement_timeout
    expect(isTransientDbError({ message: 'ECONNRESET' })).toBe(true)
    expect(isTransientDbError({})).toBe(true)                    // opaque error still counts
    expect(isTransientDbError(new Error('boom'))).toBe(true)
  })
})

describe('isTransientAuthError', () => {
  it('is false for a real auth failure (400 invalid_refresh_token / 401 / 403)', () => {
    // auth-js AuthApiError carries the real GoTrue status. 400 =
    // invalid_refresh_token / invalid_grant → user must go to /login.
    expect(isTransientAuthError({ status: 400 })).toBe(false)
    expect(isTransientAuthError({ status: 401 })).toBe(false)
    expect(isTransientAuthError({ status: 403 })).toBe(false)
  })
  it('is true for >= 500', () => {
    expect(isTransientAuthError({ status: 500 })).toBe(true)
    expect(isTransientAuthError({ status: 503 })).toBe(true)
    expect(isTransientAuthError({ status: 599 })).toBe(true)
  })
  it('is true when status is missing (defensive against library shape drift)', () => {
    expect(isTransientAuthError({})).toBe(true)
    expect(isTransientAuthError({ message: 'fetch failed' })).toBe(true)
  })
  it('is false for null / non-object', () => {
    expect(isTransientAuthError(null)).toBe(false)
    expect(isTransientAuthError(undefined)).toBe(false)
    expect(isTransientAuthError('nope')).toBe(false)
  })
  // ─── auth-js@2.105.4 network-error shapes ────────────────────────────
  // fetch.js:36 + :122 throw new AuthRetryableFetchError(msg, 0) on any
  // fetch-level failure (offline, DNS, mid-request abort). The previous
  // `>= 500` check misclassified these as terminal → false 401 lockouts.
  it('is true for a plain { status: 0 } (auth-js network failure)', () => {
    expect(isTransientAuthError({ status: 0 })).toBe(true)
  })
  it('is true when auth-js marks the error retryable (name field, canonical marker)', () => {
    // lib/errors.js:243 : isAuthRetryableFetchError() checks the class name.
    expect(isTransientAuthError({ name: 'AuthRetryableFetchError', status: 0 })).toBe(true)
    expect(isTransientAuthError({ name: 'AuthRetryableFetchError' })).toBe(true)
  })
  it('is true for 429 (GoTrue rate-limit → retryable)', () => {
    expect(isTransientAuthError({ status: 429 })).toBe(true)
  })
})

describe('dbUnavailableResponse', () => {
  it('returns 503 with Retry-After 5, JSON body { error, code: DB_UNAVAILABLE }', async () => {
    const res = dbUnavailableResponse()
    expect(res.status).toBe(503)
    expect(res.headers.get('Retry-After')).toBe('5')
    const body = await res.json()
    // `error` stays a string so existing client toasts (body.error) keep working.
    expect(typeof body.error).toBe('string')
    expect(body.code).toBe('DB_UNAVAILABLE')
  })
})
