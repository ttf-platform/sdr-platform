/**
 * Centralized Anthropic SDK client (singleton).
 *
 * Created during Sprint Widget Help (Mar 2026) to consolidate inline
 * `new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })` duplication.
 *
 * Migration complete — Sprint Tech Debt (May 2026):
 *  - Routes using getAnthropicClient():
 *    auto-fill, prospect-emails/[id]/regenerate, campaigns/suggest,
 *    campaigns/[id]/steps/[step_id]/ai-write, morning-brief/generate
 *  - Libs using getAnthropicClient():
 *    bot-ai, draft-generation, ai-suggestions
 *  - Type-only imports (no instantiation):
 *    personalization, bug-reports, bot/message
 *
 * SDK upgraded from 0.20.0 to 0.97.1 in the same sprint.
 *
 * Why singleton:
 *  - One source of truth for client config (timeouts, retries, defaults)
 *  - Cheaper at runtime (single HTTP/2 connection pool reused)
 *  - Easier to swap for a mock in tests
 */

import Anthropic from '@anthropic-ai/sdk';

let _client: Anthropic | null = null;

export function getAnthropicClient(): Anthropic {
  if (_client) return _client;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. Configure it in your environment (.env.local for dev, Vercel env vars for Production/Preview).'
    );
  }

  _client = new Anthropic({
    apiKey,
    // Default timeout — bot tool-use loops can be slow with 5+ tool calls
    timeout: 60_000,
    maxRetries: 2,
  });

  return _client;
}

/**
 * Reset the cached client. Used by tests to swap in a mock.
 * Do NOT call from production code.
 */
export function __resetAnthropicClientForTests(client: Anthropic | null): void {
  _client = client;
}
