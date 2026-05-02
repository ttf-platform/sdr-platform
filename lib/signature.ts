export interface SignatureVars {
  user_name?:       string | null
  user_title?:      string | null
  company?:         string | null
  company_website?: string | null
}

export function renderSignature(template: string | null, vars: SignatureVars): string {
  if (!template) return ''
  let result = template
    .replace(/\{\{user_name\}\}/g,       vars.user_name       ?? '')
    .replace(/\{\{user_title\}\}/g,      vars.user_title      ?? '')
    .replace(/\{\{company\}\}/g,         vars.company         ?? '')
    .replace(/\{\{company_website\}\}/g, vars.company_website ?? '')
  // Clean orphaned separators when fields are empty
  result = result
    .replace(/ · ,/g, ',')     // empty title before company: "Name · , Co" → "Name, Co"
    .replace(/^ · /gm, '')     // empty name, non-empty title: " · Title, Co" → "Title, Co"
    .replace(/,\s*$/gm, '')    // trailing comma when company empty: "Name · Title," → "Name · Title"
    .replace(/ · $/gm, '')     // trailing separator when title+company empty: "Name · " → "Name"
    .replace(/^,\s*/gm, '')    // leading comma when name+title empty: ", Co" → "Co"
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()
  return result
}

export function appendSignature(body: string, signature: string): string {
  if (!signature.trim()) return body
  return body.trimEnd() + '\n\n' + signature
}

export function stripSignature(body: string, signature: string): string {
  if (!signature.trim()) return body
  const trimmedSig  = signature.trimEnd()
  const trimmedBody = body.trimEnd()
  if (trimmedBody.endsWith(trimmedSig)) {
    return trimmedBody.slice(0, trimmedBody.length - trimmedSig.length).trimEnd()
  }
  return body
}
