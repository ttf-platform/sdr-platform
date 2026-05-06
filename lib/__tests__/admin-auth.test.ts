import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getAdminEmails, isAdminEmail } from '../admin-auth';

const ORIGINAL_ENV = process.env.SENTRA_ADMIN_EMAILS;

describe('getAdminEmails', () => {
  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.SENTRA_ADMIN_EMAILS;
    } else {
      process.env.SENTRA_ADMIN_EMAILS = ORIGINAL_ENV;
    }
  });

  it('returns empty list when env var is not set', () => {
    delete process.env.SENTRA_ADMIN_EMAILS;
    expect(getAdminEmails()).toEqual([]);
  });

  it('returns empty list when env var is empty string', () => {
    process.env.SENTRA_ADMIN_EMAILS = '';
    expect(getAdminEmails()).toEqual([]);
  });

  it('parses single email', () => {
    process.env.SENTRA_ADMIN_EMAILS = 'cyrus@noos.fr';
    expect(getAdminEmails()).toEqual(['cyrus@noos.fr']);
  });

  it('parses multiple emails comma-separated', () => {
    process.env.SENTRA_ADMIN_EMAILS = 'cyrus@noos.fr,max@hotmail.com';
    expect(getAdminEmails()).toEqual(['cyrus@noos.fr', 'max@hotmail.com']);
  });

  it('lowercases emails for case-insensitive matching', () => {
    process.env.SENTRA_ADMIN_EMAILS = 'Cyrus@NOOS.FR';
    expect(getAdminEmails()).toEqual(['cyrus@noos.fr']);
  });

  it('trims whitespace around emails', () => {
    process.env.SENTRA_ADMIN_EMAILS = ' cyrus@noos.fr , max@hotmail.com ';
    expect(getAdminEmails()).toEqual(['cyrus@noos.fr', 'max@hotmail.com']);
  });

  it('filters empty entries from trailing commas', () => {
    process.env.SENTRA_ADMIN_EMAILS = 'cyrus@noos.fr,,';
    expect(getAdminEmails()).toEqual(['cyrus@noos.fr']);
  });
});

describe('isAdminEmail', () => {
  beforeEach(() => {
    process.env.SENTRA_ADMIN_EMAILS = 'cyrus@noos.fr,max@hotmail.com';
  });
  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.SENTRA_ADMIN_EMAILS;
    } else {
      process.env.SENTRA_ADMIN_EMAILS = ORIGINAL_ENV;
    }
  });

  it('returns true for an admin email', () => {
    expect(isAdminEmail('cyrus@noos.fr')).toBe(true);
  });

  it('returns true for an admin email with different case', () => {
    expect(isAdminEmail('CYRUS@NOOS.FR')).toBe(true);
  });

  it('returns false for a non-admin email', () => {
    expect(isAdminEmail('random@example.com')).toBe(false);
  });

  it('returns false for null', () => {
    expect(isAdminEmail(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isAdminEmail(undefined)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isAdminEmail('')).toBe(false);
  });

  it('returns false when env var is not set', () => {
    delete process.env.SENTRA_ADMIN_EMAILS;
    expect(isAdminEmail('cyrus@noos.fr')).toBe(false);
  });
});
