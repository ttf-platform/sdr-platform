import { describe, expect, it } from 'vitest'
import {
  dbUnavailableResponse,
  isNoRowsError,
  isTransientAuthError,
  isTransientDbError,
} from '../db-errors'

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
  it('is false for a real auth failure (400/401)', () => {
    expect(isTransientAuthError({ status: 400 })).toBe(false)
    expect(isTransientAuthError({ status: 401 })).toBe(false)
    expect(isTransientAuthError({ status: 403 })).toBe(false)
  })
  it('is true for >= 500', () => {
    expect(isTransientAuthError({ status: 500 })).toBe(true)
    expect(isTransientAuthError({ status: 503 })).toBe(true)
    expect(isTransientAuthError({ status: 599 })).toBe(true)
  })
  it('is true when status is missing (network-level failure)', () => {
    expect(isTransientAuthError({})).toBe(true)
    expect(isTransientAuthError({ message: 'fetch failed' })).toBe(true)
  })
  it('is false for null / non-object', () => {
    expect(isTransientAuthError(null)).toBe(false)
    expect(isTransientAuthError(undefined)).toBe(false)
    expect(isTransientAuthError('nope')).toBe(false)
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
