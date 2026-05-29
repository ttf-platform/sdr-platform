export type ArticleCategory =
  | 'getting-started'
  | 'sending-infrastructure'
  | 'signals'
  | 'campaigns'
  | 'campaigns-ai'
  | 'approval-sending'
  | 'billing'
  | 'troubleshooting'
  | 'replies'

export interface ArticleMeta {
  title: string
  description: string
  slug: string
  category: ArticleCategory
  order: number
  last_updated: string
}

export const CATEGORY_LABELS: Record<ArticleCategory, string> = {
  'getting-started': 'Getting Started',
  'sending-infrastructure': 'Sending Infrastructure',
  'signals': 'Signals',
  'campaigns': 'Campaigns',
  'campaigns-ai': 'Campaigns & AI',
  'approval-sending': 'Approval & Sending',
  'billing': 'Billing & Account',
  'troubleshooting': 'Troubleshooting',
  'replies': 'Replies',
}
