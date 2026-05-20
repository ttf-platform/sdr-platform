/**
 * Sanitizes a cell value to prevent CSV/XLSX formula injection (OWASP guidance).
 * Cells starting with =, +, -, @, \t, \r are interpreted as formulas by
 * Excel/LibreOffice/Google Sheets when the exported file is opened.
 *
 * Defense: prefix with single quote (') to neutralize formula interpretation.
 * The quote is a hidden control character in spreadsheet apps — visible content unchanged.
 */
const DANGEROUS_PREFIXES = ['=', '+', '-', '@', '\t', '\r']

export function sanitizeCell(value: unknown): string {
  if (value == null) return ''
  const str = String(value)
  if (str.length === 0) return str
  if (DANGEROUS_PREFIXES.includes(str[0])) {
    return `'${str}`
  }
  return str
}

/**
 * Sanitizes all string values in a row object for safe spreadsheet export.
 */
export function sanitizeRow<T extends Record<string, unknown>>(row: T): Record<keyof T, string> {
  const result = {} as Record<keyof T, string>
  for (const key in row) {
    result[key] = sanitizeCell(row[key])
  }
  return result
}
