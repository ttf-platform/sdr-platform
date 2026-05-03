// Canonical enum values — must match COMPANY_SIZES in prospects/page.tsx and settings/page.tsx
const ENUM_RANGES = [
  { key: '1-10',     min: 1,    max: 10 },
  { key: '10-50',    min: 10,   max: 50 },
  { key: '50-200',   min: 50,   max: 200 },
  { key: '200-500',  min: 200,  max: 500 },
  { key: '500-1000', min: 500,  max: 1000 },
  { key: '1000+',    min: 1000, max: Infinity },
]

const VALID_SIZES = ENUM_RANGES.map(r => r.key)

// Maps a free-text AI company size to one or more canonical enum keys (for target_company_size)
export function mapCompanySize(aiValue: string | string[] | undefined): string[] {
  if (!aiValue) return []

  if (Array.isArray(aiValue)) {
    return aiValue
      .filter((v): v is string => typeof v === 'string')
      .flatMap(v => mapCompanySize(v))
      .filter((v, i, arr) => arr.indexOf(v) === i)
  }

  const value = aiValue.trim()
  if (!value) return []

  // Exact enum match
  if (VALID_SIZES.includes(value)) return [value]

  // Pattern "X+" (e.g. "1000+", "500+")
  const plusMatch = value.match(/^(\d+)\+$/)
  if (plusMatch) {
    const aiMin = parseInt(plusMatch[1])
    return ENUM_RANGES.filter(r => r.max >= aiMin).map(r => r.key)
  }

  // Range pattern (e.g. "11-1000", "11 to 1000", "11–1000")
  const rangeMatch = value.match(/(\d+)\s*(?:-|to|à|–)\s*(\d+)/i)
  if (rangeMatch) {
    const aiMin = parseInt(rangeMatch[1])
    const aiMax = parseInt(rangeMatch[2])
    return ENUM_RANGES
      .filter(r => r.max >= aiMin && r.min <= aiMax)
      .map(r => r.key)
  }

  // Textual mapping
  const lower = value.toLowerCase()
  if (lower.includes('startup') || (lower.includes('small') && !lower.includes('mid') && !lower.includes('medium'))) {
    return ['1-10', '10-50']
  }
  if (lower.includes('smb') || lower.includes('small business')) {
    return ['1-10', '10-50', '50-200']
  }
  if (lower.includes('mid') || lower.includes('medium')) {
    return ['50-200', '200-500']
  }
  if (lower.includes('large') || lower.includes('enterprise')) {
    return ['500-1000', '1000+']
  }

  return []
}

// Strict version for user_company_size — only exact enum match, returns single string or undefined
export function mapUserCompanySize(aiValue: string | undefined): string | undefined {
  if (!aiValue || typeof aiValue !== 'string') return undefined
  const value = aiValue.trim()
  return VALID_SIZES.includes(value) ? value : undefined
}
