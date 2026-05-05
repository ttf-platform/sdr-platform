/**
 * Centralized Anthropic SDK client (singleton).
 *
 * Created during Sprint Widget Help to avoid yet another duplication of
 * `new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })` (already
 * repeated in 10 files across the codebase).
 *
 * Currently used by lib/bot-ai.ts only. The 10 pre-existing files
 * (auto-fill, inbox/draft, regenerate, icp/parse, campaigns/suggest,
 * ai-write, morning-brief, draft-generation, ai-suggestions, personalization)
 * will be migrated to this singleton in a dedicated post-launch refactor
 * sprint, alongside the SDK upgrade from 0.20.0 to 0.37+.
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
