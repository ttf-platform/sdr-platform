/**
 * ICP-related option lists + tone/language normalization.
 *
 * Extracted from components/NewCampaignModal.tsx to be shared with the new
 * campaign-level ICP edit card (app/(dashboard)/dashboard/campaigns/[id]/page.tsx).
 * Behaviour is identical to the previous local constants — this file is a
 * pure module extraction, no logic change.
 *
 * Labels are resolved at render via useTranslations() by callers :
 *   TONES     → dashboard.prospects.list.tones.*
 *   LANGUAGES → components.campaignModals.languages.*
 */

export const SIZE_OPTIONS = ['1-10', '10-50', '50-200', '200-500', '500-1000', '1000+']
export const REV_OPTIONS  = ['<$1M', '$1M-$5M', '$5M-$10M', '$10M-$50M', '$50M-$200M', '$200M+']

// Values only. Tone labels resolved at render via useTranslations → tTones(k).
// Dynamic keys under dashboard.prospects.list.tones.* — reused across the app
// (Master ICP form, NewCampaignModal, campaign detail ICP card) to guarantee
// identical FR/EN copy.
export const TONES = ['professional', 'casual', 'direct', 'friendly', 'witty'] as const
export type ToneKey = typeof TONES[number]

export const TONE_ALIASES: Record<string, string> = { technical: 'direct', warm: 'friendly' }

export function normalizeTone(raw?: string | null): ToneKey {
  const t = (raw || '').toLowerCase()
  if ((TONES as readonly string[]).includes(t)) return t as ToneKey
  return (TONE_ALIASES[t] ?? 'professional') as ToneKey
}

// Canonical EN values persisted in DB and consumed by lib/ai-voice.ts —
// labels resolved via useTranslations → tLanguages(v).
export const LANGUAGES = ['English', 'French'] as const
export type LanguageValue = typeof LANGUAGES[number]
