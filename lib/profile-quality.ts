// Pure module. No React deps. Importable server-side and client-side.

export interface ProfileForScore {
  // Company (Settings)
  user_industry?:          string | null
  user_company_size?:      string | null
  // Product (Settings)
  product_description?:    string | null
  value_proposition?:      string | null
  // ICP (Prospects)
  icp_description?:        string | null
  icp_industries?:         string[] | null
  icp_company_size?:       string | null
  icp_company_sizes?:      string[] | null
  target_titles?:          string | null
  target_regions?:         string | null
  pain_points?:            string | null
  tone?:                   string | null
  // Non-scored fields
  sender_name?:            string | null
  target_company_revenue?: string[] | null
}

interface Criterion {
  key:    keyof ProfileForScore
  label:  string
  points: number
  href:   string
  passes: (v: ProfileForScore) => boolean
}

export interface MissingCriterion {
  key:    keyof ProfileForScore
  label:  string
  points: number
  href:   string
}

// Total = 100. target_company_revenue + sender_name intentionally excluded from scoring.
export const CRITERIA: Criterion[] = [
  { key: 'user_industry',       label: 'Your industry',       points: 10, href: '/dashboard/profile#offre', passes: p => !!p.user_industry?.trim() },
  { key: 'user_company_size',   label: 'Your company size',   points:  5, href: '/dashboard/profile#offre', passes: p => !!p.user_company_size?.trim() },
  { key: 'product_description', label: 'Product description', points: 15, href: '/dashboard/profile#offre', passes: p => (p.product_description?.length ?? 0) >= 30 },
  { key: 'value_proposition',   label: 'Value proposition',   points: 15, href: '/dashboard/profile#offre', passes: p => (p.value_proposition?.length ?? 0) >= 20 },
  { key: 'icp_description',     label: 'ICP description',     points: 15, href: '/dashboard/profile#icp',   passes: p => (p.icp_description?.length ?? 0) >= 30 },
  { key: 'icp_industries',      label: 'Target industry',     points: 10, href: '/dashboard/profile#icp',   passes: p => (p.icp_industries?.filter(Boolean).length ?? 0) > 0 },
  { key: 'target_titles',       label: 'Target titles',       points: 10, href: '/dashboard/profile#icp',   passes: p => !!p.target_titles?.trim() },
  { key: 'target_regions',      label: 'Target regions',      points:  5, href: '/dashboard/profile#icp',   passes: p => !!p.target_regions?.trim() },
  { key: 'icp_company_sizes',   label: 'Target company size', points:  5, href: '/dashboard/profile#icp',   passes: p => (p.icp_company_sizes?.filter(Boolean).length ?? 0) > 0 || !!p.icp_company_size?.trim() },
  { key: 'pain_points',         label: 'Pain points',         points:  5, href: '/dashboard/profile#icp',   passes: p => (p.pain_points?.length ?? 0) >= 20 },
  { key: 'tone',                label: 'Email tone',          points:  5, href: '/dashboard/profile#icp',   passes: p => !!p.tone },
]
// Verification: 10+5+15+15+15+10+10+5+5+5+5 = 100 ✓

export function calculateProfileScore(profile: ProfileForScore): number {
  return CRITERIA.reduce((sum, c) => sum + (c.passes(profile) ? c.points : 0), 0)
}

export function getMissingCriteria(profile: ProfileForScore): string[] {
  return CRITERIA.filter(c => !c.passes(profile)).map(c => c.label)
}

export function getMissingCriteriaDetailed(profile: ProfileForScore): MissingCriterion[] {
  return CRITERIA
    .filter(c => !c.passes(profile))
    .map(({ key, label, points, href }) => ({ key, label, points, href }))
}
