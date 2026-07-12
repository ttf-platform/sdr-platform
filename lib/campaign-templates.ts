/**
 * Campaign preset descriptor — id + emoji + either an i18nKey (standard
 * templates) or inline runtime strings (AI-generated ad-hoc presets).
 *
 * Standard templates:
 *   All user-visible strings live under
 *   components.campaignModals.templates.<i18nKey>.* in messages/{en,fr}.json.
 *   Consumers resolve them via useTranslations at render.
 *
 * AI-generated ad-hoc presets (see handleLaunchFromAI in the campaigns page):
 *   Carry inline `label` / `description` / `angle` / `value_prop` / `cta` /
 *   `target_persona` strings sourced from the AI suggestion API (already
 *   locale-aware) — bypass i18n lookup.
 *
 * `id` is the persisted analytics/DB value — DO NOT rename the standard IDs.
 * `blank` has no seed fields (angle/valueProp/cta/targetPersona).
 */
export interface CampaignTemplate {
  id: string
  emoji: string
  /** Standard templates: key under components.campaignModals.templates.<i18nKey>.*. */
  i18nKey?: string
  /** AI-generated presets: inline strings sourced from the AI suggestion API. */
  label?: string
  description?: string
  angle?: string | null
  value_prop?: string | null
  cta?: string | null
  target_persona?: string | null
}

export const CAMPAIGN_TEMPLATES: CampaignTemplate[] = [
  { id: 'recruitment-clients', emoji: '🎯', i18nKey: 'recruitmentClients' },
  { id: 'agency-clients',      emoji: '📣', i18nKey: 'agencyClients' },
  { id: 'consultant',          emoji: '💼', i18nKey: 'consultant' },
  { id: 'b2b-service',         emoji: '🤝', i18nKey: 'b2bService' },
  { id: 'blank',               emoji: '✦', i18nKey: 'blank' },
]
