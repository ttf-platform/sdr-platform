export interface SignatureVars {
  user_name?:       string | null
  user_title?:      string | null
  company?:         string | null
  company_website?: string | null
}

export function renderSignature(template: string | null, vars: SignatureVars): string {
  if (!template) return ''
  return template
    .replace(/\{\{user_name\}\}/g,       vars.user_name       ?? '')
    .replace(/\{\{user_title\}\}/g,      vars.user_title      ?? '')
    .replace(/\{\{company\}\}/g,         vars.company         ?? '')
    .replace(/\{\{company_website\}\}/g, vars.company_website ?? '')
}

export function appendSignature(body: string, signature: string): string {
  if (!signature.trim()) return body
  return body.trimEnd() + '\n\n' + signature
}
