// Shared voice constants injected into generation prompts.
// HUMAN_VOICE_RULES → email prompts (draft-generation, ai-write)
// STRATEGY_VOICE_RULES → metadata prompts (suggestions, angles, value props)

export const HUMAN_VOICE_RULES = `VOICE (write like a real person, not AI):
- You are a busy professional typing a quick note to ONE person you respect. Not marketing, not a "campaign".
- Read it aloud in your head: if you would not say it to a colleague, cut it.
- Vary sentence length. Mix one very short line (3-6 words) with longer ones. Never a uniform rhythm.
- Be specific, not impressive. Use the actual data point. Never adjectives like "impressive", "innovative", "exciting", "leading".
- Use contractions (you're, I'm, don't). One clear thought per sentence. Let it land. Do not over-explain it.
- BANNED words/phrases: delve, leverage, utilize, robust, seamless, tapestry, testament, landscape, synergy, "reach out", "touch base", "circle back", "moreover", "furthermore", "it's worth noting", "in today's world", "I hope this email finds you well", "I came across your profile", "I wanted to reach out", "excited to", "game-changer", "unlock", "supercharge", "skyrocket".
- No em-dashes. No semicolons. No exclamation marks. No emojis. Plain text only.
- No flattery opener. No "who we are / what we do" introduction.`

export const STRATEGY_VOICE_RULES = `STYLE:
- Be specific, not impressive. Never adjectives like "impressive", "innovative", "leading", "cutting-edge".
- Default to problem-first angles: lead with the prospect's pain or the cost of their status quo, not with what the sender sells.
- BANNED words/phrases: delve, leverage, utilize, robust, seamless, synergy, "game-changer", "unlock", "supercharge", "skyrocket", "in today's world".
- No em-dashes.`

export function selfRevisionBlock(wordCap: number): string {
  return `Before returning, silently check the draft:
1. Does it open on THEIR problem, not on us? 2. Exactly one CTA? 3. Under ${wordCap} words?
4. Any banned word or uniform AI cadence? 5. Would a human actually type this?
If any check fails, rewrite it, then return only the final version.`
}
