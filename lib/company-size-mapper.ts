const ENUM_RANGES = [
  { key: '1-10',     min: 1,    max: 10 },
  { key: '11-50',    min: 11,   max: 50 },
  { key: '51-200',   min: 51,   max: 200 },
  { key: '201-500',  min: 201,  max: 500 },
  { key: '501-1000', min: 501,  max: 1000 },
  { key: '1000+',    min: 1001, max: Infinity },
]

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
  if (ENUM_RANGES.some(r => r.key === value)) return [value]

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
  if (lower.includes('startup') || lower.includes('small') && !lower.includes('mid') && !lower.includes('medium')) {
    return ['1-10', '11-50']
  }
  if (lower.includes('mid') || lower.includes('medium')) {
    return ['51-200', '201-500']
  }
  if (lower.includes('large') || lower.includes('enterprise')) {
    return ['501-1000', '1000+']
  }
  if (lower.includes('smb') || lower.includes('small business')) {
    return ['1-10', '11-50', '51-200']
  }

  return []
}
