// Pure module — no React deps. Importable server-side and client-side.

export interface ProfileForScore {
  product_description?:     string | null
  icp_description?:         string | null
  sender_name?:             string | null       // kept as field, no score impact
  value_proposition?:       string | null
  icp_industries?:          string[] | null
  icp_company_size?:        string | null
  icp_company_sizes?:       string[] | null
  pain_points?:             string | null
  target_titles?:           string | null
  target_regions?:          string | null
  target_company_revenue?:  string[] | null
}

interface Criterion {
  key: keyof ProfileForScore
  label: string
  points: number
  passes: (v: ProfileForScore) => boolean
}

// Total = 100. sender_name intentionally excluded from scoring.
export const CRITERIA: Criterion[] = [
  { key: 'product_description',    label: 'company description',          points: 20, passes: p => (p.product_description?.length    ?? 0) >= 30 },
  { key: 'value_proposition',      label: 'value proposition',            points: 20, passes: p => (p.value_proposition?.length      ?? 0) >= 20 },
  { key: 'icp_description',        label: 'ideal customer description',   points: 20, passes: p => (p.icp_description?.length        ?? 0) >= 30 },
  { key: 'icp_industries',         label: 'target industry',              points: 10, passes: p => (p.icp_industries?.filter(Boolean).length ?? 0) > 0 },
  { key: 'target_titles',          label: 'target titles',                points: 10, passes: p => !!p.target_titles?.trim() },
  { key: 'icp_company_size',       label: 'target company size',          points:  5, passes: p => (p.icp_company_sizes?.filter(Boolean).length ?? 0) > 0 || !!p.icp_company_size?.trim() },
  { key: 'target_regions',         label: 'target regions',               points:  5, passes: p => !!p.target_regions?.trim() },
  { key: 'target_company_revenue', label: 'company revenue range',        points:  5, passes: p => (p.target_company_revenue?.filter(Boolean).length ?? 0) > 0 },
  { key: 'pain_points',            label: 'pain points / buying signals', points:  5, passes: p => (p.pain_points?.length             ?? 0) >= 20 },
]

export function calculateProfileScore(profile: ProfileForScore): number {
  return CRITERIA.reduce((sum, c) => sum + (c.passes(profile) ? c.points : 0), 0)
}

export function getMissingCriteria(profile: ProfileForScore): string[] {
  return CRITERIA.filter(c => !c.passes(profile)).map(c => c.label)
}
