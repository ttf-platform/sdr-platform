import { randomBytes } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'

// -----------------------------------------------------------------------------
// Contrats
// -----------------------------------------------------------------------------

export const ATTACHMENTS_BUCKET = 'email-attachments'

// Cap taille : 10 Mo. Aligné avec la limite Instantly (single attachment
// <10 MB) et la limite Gmail/Outlook côté client. Au-delà, l'attachement
// devient un lien tracké au lieu d'être joint — c'est justement la raison
// d'être de cette feature.
export const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024

// Allowlist stricte. On refuse tout ce qui exécute (exe, dll, jar), les
// archives (zip, rar, 7z, tar, gz — souvent des vecteurs de macros
// planquées), et les documents Office macro-enabled (.docm/.xlsm/.pptm).
// Fichiers plats + docs signés + médias seulement.
const ALLOWED_MIME_TYPES: ReadonlySet<string> = new Set([
  // Documents
  'application/pdf',
  'application/msword',                                                        // .doc
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',   // .docx
  'application/vnd.ms-excel',                                                  // .xls
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',         // .xlsx
  'application/vnd.ms-powerpoint',                                             // .ppt
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
  // Texte
  'text/plain',
  'text/csv',
  'text/markdown',
  // Images
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  // NB : image/svg+xml INTENTIONNELLEMENT ABSENT. Un SVG peut contenir du
  // JS inline ; on refuse aussi bien au niveau extension (.svg bloqué) qu'au
  // niveau mime, pour empêcher un client de masquer un SVG derrière un nom
  // en .png (masquerade mime/extension). Cohérent avec le blocklist ci-dessous.
])

// Extensions bloquées défensivement en plus du mime allowlist. Certains
// browsers/clients envoient un mime générique (application/octet-stream)
// pour des fichiers exécutables — on garde une deuxième barrière sur le
// nom de fichier.
const BLOCKED_EXTENSIONS: ReadonlySet<string> = new Set([
  'exe', 'msi', 'bat', 'cmd', 'com', 'scr', 'ps1', 'sh', 'bash',
  'jar', 'dll', 'so', 'app', 'dmg',
  'zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz',
  'docm', 'xlsm', 'pptm', 'dotm', 'xltm', 'potm',
  'html', 'htm', 'svg',   // svg = XSS via <script> inline (cf. mime allowlist ci-dessus)
])

export interface ValidateFileInput {
  filename:  string
  mimeType:  string
  sizeBytes: number
}

export type ValidateFileResult =
  | { ok: true }
  | { ok: false; reason: string; code: 'size' | 'mime' | 'extension' | 'empty' | 'name' }

export function validateFile(input: ValidateFileInput): ValidateFileResult {
  if (!input.filename || input.filename.trim().length === 0) {
    return { ok: false, code: 'name', reason: 'Filename is required' }
  }
  if (input.filename.length > 255) {
    return { ok: false, code: 'name', reason: 'Filename too long (max 255 characters)' }
  }
  // Bloque tout path separator / control char qui pourrait ouvrir un
  // traversal (ex: '../etc/passwd', '\\backup', '\x00nullbyte'). Le nom
  // stocké dans la row + rendu dans l'UI doit être plat.
  if (/[\x00-\x1f\x7f/\\]/.test(input.filename)) {
    return { ok: false, code: 'name', reason: 'Filename contains invalid characters' }
  }

  if (input.sizeBytes <= 0) {
    return { ok: false, code: 'empty', reason: 'File is empty' }
  }
  if (input.sizeBytes > MAX_ATTACHMENT_SIZE_BYTES) {
    return {
      ok: false, code: 'size',
      reason: `File exceeds ${Math.round(MAX_ATTACHMENT_SIZE_BYTES / (1024 * 1024))} MB limit`,
    }
  }

  const ext = (input.filename.split('.').pop() ?? '').toLowerCase()
  if (BLOCKED_EXTENSIONS.has(ext)) {
    return { ok: false, code: 'extension', reason: `File type ".${ext}" is not allowed` }
  }

  if (!ALLOWED_MIME_TYPES.has(input.mimeType)) {
    return { ok: false, code: 'mime', reason: `MIME type "${input.mimeType}" is not allowed` }
  }

  return { ok: true }
}

// -----------------------------------------------------------------------------
// Token generation
// -----------------------------------------------------------------------------
// Base64url de 24 octets aléatoires = 32 chars, ~192 bits d'entropie.
// Non-devinable dans le cadre d'un adversaire raisonnable (largement
// au-delà des 128 bits recommandés). Format URL-safe (pas de +/= à
// échapper), lisible dans les logs.
export function generateAttachmentToken(): string {
  return randomBytes(24).toString('base64url')
}

// -----------------------------------------------------------------------------
// Storage-safe filename
// -----------------------------------------------------------------------------
// Supabase Storage refuse certaines clés (accents, espaces, apostrophes,
// caractères non ASCII) avec "Invalid key". Le VRAI filename est conservé
// dans la colonne `filename` (rendu chip, Content-Disposition sur download),
// mais la clé Storage doit être un slug ASCII strict.
//
// Transformation :
//   - split extension (dernière '.' non initiale) ; ext lowercase + [^a-z0-9] retiré
//   - base : NFKD strip diacritiques (é→e, à→a), [^A-Za-z0-9._-] → _, collapse
//     underscores, trim [._-] en bord, cap 80 chars, fallback 'file' si vide.
//
// Non exposé aux users : c'est purement un artefact interne pour Storage.
export function safeStorageName(filename: string): string {
  const dot  = filename.lastIndexOf('.')
  const ext  = dot > 0 ? filename.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : ''
  const base = (dot > 0 ? filename.slice(0, dot) : filename)
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')   // strip accents (é→e, à→a)
    .replace(/[^a-zA-Z0-9._-]/g, '_')                     // espaces/apostrophes/etc → _
    .replace(/_+/g, '_').replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 80) || 'file'
  return ext ? `${base}.${ext}` : base
}

// -----------------------------------------------------------------------------
// Signed URL
// -----------------------------------------------------------------------------
// Durée volontairement courte : 60 s. Le redirect /f/<token> génère une URL
// signée à la volée à chaque clic ; l'URL signée n'a pas à survivre plus
// longtemps que la redirection HTTP. Extension à 5 min max si un cas de
// preview inline émerge.
export const SIGNED_URL_TTL_SECONDS = 60

export async function createSignedUrl(storagePath: string, filename: string): Promise<string | null> {
  const admin = createAdminClient()
  const { data, error } = await admin.storage
    .from(ATTACHMENTS_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS, {
      download: filename,  // force Content-Disposition: attachment; filename="…"
    })
  if (error || !data?.signedUrl) {
    console.error('[attachments:createSignedUrl] failed', {
      storage_path: storagePath,
      error: error?.message ?? 'no signed url',
    })
    return null
  }
  return data.signedUrl
}
