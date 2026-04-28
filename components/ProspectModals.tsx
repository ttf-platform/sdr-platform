'use client'
import { useState, useRef } from 'react'
import Papa from 'papaparse'

// ─── Types ────────────────────────────────────────────────────────────────────
export interface ImportResult {
  imported_contacts: number
  updated_contacts: number
  imported_assignments: number
  skipped_assignments_dedup: number
  skipped_invalid: number
  total_contacts_now: number
}

export interface CampaignOption {
  id: string
  name: string
}

// ─── Lifecycle shared constants ───────────────────────────────────────────────
export const LIFECYCLE = ['Found', 'Emailed', 'Opened', 'Replied', 'Meeting'] as const
export const STATUS_IDX: Record<string, number> = {
  found: 0, emailed: 1, opened: 2, replied: 3, meeting: 4,
}

// Status badge Tailwind classes — aligned with Sprint 16b brief
// bounced + unsubscribed → red (negative outcomes)
export function statusBadgeClass(status: string): string {
  const map: Record<string, string> = {
    found:        'bg-[#f0ece6] text-[#6b5e4e]',
    emailed:      'bg-blue-50 text-blue-600',
    opened:       'bg-indigo-50 text-indigo-600',
    replied:      'bg-purple-50 text-purple-600',
    meeting:      'bg-green-50 text-green-700',
    bounced:      'bg-red-50 text-red-600',
    unsubscribed: 'bg-red-50 text-red-600',
  }
  return map[status] ?? 'bg-[#f0ece6] text-[#6b5e4e]'
}

// ─── LifecyclePill ────────────────────────────────────────────────────────────
// variant="row"   — compact inline dots used in table rows
// variant="panel" — larger labelled steps used in side panel
export function LifecyclePill({ status, variant = 'row' }: {
  status: string
  variant?: 'row' | 'panel'
}) {
  const current = STATUS_IDX[status] ?? 0

  if (variant === 'panel') {
    return (
      <div className="flex items-start justify-between relative">
        <div className="absolute top-2.5 left-[10%] right-[10%] h-px bg-[#e8e3dc]" />
        {LIFECYCLE.map((s, i) => (
          <div key={s} className="flex flex-col items-center gap-1.5 z-10">
            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center bg-white ${
              i < current   ? 'border-[#3b6bef] bg-[#3b6bef]' :
              i === current ? 'border-[#3b6bef]' :
                              'border-[#e8e3dc]'
            }`}>
              {i < current   && <div className="w-2 h-2 bg-white rounded-full" />}
              {i === current && <div className="w-2 h-2 bg-[#3b6bef] rounded-full" />}
            </div>
            <span className={`text-[9px] font-semibold ${i <= current ? 'text-[#3b6bef]' : 'text-[#b0a898]'}`}>{s}</span>
          </div>
        ))}
      </div>
    )
  }

  const label = status.charAt(0).toUpperCase() + status.slice(1)
  return (
    <div className="flex items-center" title={label}>
      {LIFECYCLE.map((s, i) => (
        <div key={s} className="flex items-center">
          {i > 0 && (
            <div className={`w-3 h-px mx-0.5 ${i <= current ? 'bg-[#3b6bef]' : 'bg-[#e8e3dc]'}`} />
          )}
          <div className={`w-2.5 h-2.5 rounded-full transition-colors ${
            i < current   ? 'bg-[#3b6bef]' :
            i === current ? 'bg-[#3b6bef] ring-2 ring-[#eef1fd]' :
                            'bg-[#e8e3dc]'
          }`} />
        </div>
      ))}
    </div>
  )
}

// ─── CSV helpers ──────────────────────────────────────────────────────────────
const CSV_ALIASES: Record<string, string[]> = {
  email:        ['email', 'e-mail', 'email address', 'mail'],
  first_name:   ['first_name', 'first name', 'firstname', 'given name', 'prénom', 'prenom'],
  last_name:    ['last_name', 'last name', 'lastname', 'surname', 'family name', 'nom', 'nom de famille'],
  name:         ['name', 'full name', 'fullname', 'nom complet', 'contact name'],
  company:      ['company', 'company name', 'organization', 'org', 'entreprise', 'account'],
  title:        ['title', 'job title', 'position', 'role', 'poste', 'fonction'],
  linkedin_url: ['linkedin_url', 'linkedin', 'linkedin url', 'linkedin profile'],
  website:      ['website', 'website url', 'url', 'web', 'site', 'domain'],
}

export function detectColumns(headers: string[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (const header of headers) {
    const n = header.toLowerCase().trim()
    for (const [field, aliases] of Object.entries(CSV_ALIASES)) {
      if (!result[field] && aliases.includes(n)) result[field] = header
    }
  }
  return result
}

export function buildCsvRow(raw: Record<string, string>, mapping: Record<string, string>) {
  const get = (f: string) => (mapping[f] ? (raw[mapping[f]] ?? '').trim() : '')
  let first_name = get('first_name')
  let last_name  = get('last_name')
  if (!first_name && !last_name && mapping['name']) {
    const parts = get('name').split(/\s+/)
    first_name = parts[0] ?? ''
    last_name  = parts.slice(1).join(' ')
  }
  return {
    email:        get('email'),
    first_name:   first_name || null,
    last_name:    last_name  || null,
    company:      get('company')      || null,
    title:        get('title')        || null,
    linkedin_url: get('linkedin_url') || null,
    website:      get('website')      || null,
  }
}

// ─── ModalShell ────────────────────────────────────────────────────────────────
export function ModalShell({ title, onClose, children }: {
  title: string; onClose: () => void; children: React.ReactNode
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-[#f0ece6]">
          <h2 className="text-base font-bold text-[#1a1a2e]">{title}</h2>
          <button onClick={onClose} className="text-[#8a7e6e] hover:text-[#1a1a2e] text-xl leading-none">✕</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

// ─── DropZone ──────────────────────────────────────────────────────────────────
export function DropZone({ onFile }: { onFile: (f: File) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  function handleDrop(e: React.DragEvent) {
    e.preventDefault(); setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) onFile(file)
  }

  return (
    <div
      onDragOver={e => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
        dragging ? 'border-[#3b6bef] bg-[#eef1fd]' : 'border-[#e8e3dc] hover:border-[#3b6bef] hover:bg-[#faf8f5]'
      }`}
    >
      <input ref={inputRef} type="file" accept=".csv" className="hidden"
        onChange={e => { if (e.target.files?.[0]) onFile(e.target.files[0]) }} />
      <div className="text-2xl mb-2">📄</div>
      <div className="text-sm font-semibold text-[#1a1a2e] mb-1">Drop CSV here or click to browse</div>
      <div className="text-xs text-[#8a7e6e]">Columns auto-detected: email, name, company, title, linkedin, website</div>
    </div>
  )
}

// ─── CampaignSelector — optional campaign dropdown (rendered only when campaignId not pre-set)
function CampaignSelector({ campaigns, value, onChange, preSet }: {
  campaigns?: CampaignOption[]
  value: string
  onChange: (id: string) => void
  preSet: boolean
}) {
  if (preSet) {
    return (
      <p className="text-xs text-[#8a7e6e] bg-[#f7f4f0] rounded-lg px-3 py-2">
        Prospects will be added to this campaign and also visible in your global Prospects list.
      </p>
    )
  }
  return (
    <div>
      <label className="text-xs font-semibold text-[#6b5e4e] mb-1 block">Campaign (optional)</label>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]">
        <option value="">No campaign — global list</option>
        {(campaigns ?? []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <p className="text-xs text-[#8a7e6e] mt-1">
        Leave empty to add to your global list, or select a campaign to attach them now. Either way they appear in /dashboard/prospects.
      </p>
    </div>
  )
}

// ─── ImportCSVModal ────────────────────────────────────────────────────────────
interface PreviewChecks {
  alreadyInCampaign: string[]
  crossCampaign: { email: string; campaigns: string[] }[]
  newEmails: string[]
  validEmailCount: number
}

export function ImportCSVModal({ campaignId, campaignName, campaigns, onClose, onImported }: {
  campaignId?: string
  campaignName?: string
  campaigns?: CampaignOption[]
  onClose: () => void
  onImported: (result: ImportResult) => void
}) {
  const [selectedCampaignId, setSelectedCampaignId] = useState(campaignId ?? '')
  const effectiveCampaignId = campaignId ?? (selectedCampaignId || undefined)

  const [step, setStep]               = useState<'upload' | 'preview' | 'importing' | 'done'>('upload')
  const [headers, setHeaders]         = useState<string[]>([])
  const [rows, setRows]               = useState<Record<string, string>[]>([])
  const [mapping, setMapping]         = useState<Record<string, string>>({})
  const [previewChecks, setPreviewChecks] = useState<PreviewChecks | null>(null)
  const [checkingPreview, setCheckingPreview] = useState(false)
  const [importedForCampaign, setImportedForCampaign] = useState<string | undefined>(undefined)
  const [result, setResult]           = useState<ImportResult | null>(null)
  const [error, setError]             = useState('')

  function handleFile(file: File) {
    Papa.parse<Record<string, string>>(file, {
      header: true, skipEmptyLines: true,
      complete(parsed) {
        const hdrs       = parsed.meta.fields ?? []
        const parsedRows = parsed.data
        const detected   = detectColumns(hdrs)
        setHeaders(hdrs)
        setRows(parsedRows)
        setMapping(detected)
        setPreviewChecks(null)
        setStep('preview')

        if (!effectiveCampaignId || parsedRows.length === 0) return

        const validEmails = parsedRows.map(r => buildCsvRow(r, detected).email).filter(Boolean)
        if (validEmails.length === 0) return

        setCheckingPreview(true)
        const emailsParam = encodeURIComponent(validEmails.join(','))

        // Two parallel lookups: already in this campaign + in other campaigns
        Promise.all([
          fetch(`/api/prospects?emails=${emailsParam}&campaign_id=${effectiveCampaignId}`).then(r => r.json()),
          fetch(`/api/prospects?emails=${emailsParam}&exclude_campaign=${effectiveCampaignId}`).then(r => r.json()),
        ]).then(([inCampaignData, crossData]) => {
          const inCampaignEmails = new Set<string>(
            (inCampaignData.matches ?? []).map((m: any) => m.email as string),
          )

          // Group cross-campaign matches by email
          const crossByEmail: Record<string, string[]> = {}
          for (const m of (crossData.matches ?? []) as any[]) {
            ;(crossByEmail[m.email] ??= []).push(m.campaigns?.name ?? 'another campaign')
          }

          const newEmails = validEmails.filter(e => !inCampaignEmails.has(e))

          setPreviewChecks({
            alreadyInCampaign: [...inCampaignEmails],
            crossCampaign: Object.entries(crossByEmail).map(([email, camps]) => ({ email, campaigns: camps })),
            newEmails,
            validEmailCount: validEmails.length,
          })
          setCheckingPreview(false)
        }).catch(() => setCheckingPreview(false))
      },
    })
  }

  async function doImport() {
    setStep('importing')
    setError('')
    setImportedForCampaign(effectiveCampaignId)
    const csvRows = rows.map(r => buildCsvRow(r, mapping)).filter(r => r.email)
    const res = await fetch('/api/prospects/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campaign_id: effectiveCampaignId ?? null, mode: 'csv', data: { rows: csvRows } }),
    }).then(r => r.json())
    if (res.error) { setError(res.error); setStep('preview'); return }
    setResult(res)
    setStep('done')
    onImported(res)
  }

  return (
    <ModalShell title="Import CSV" onClose={onClose}>
      {step === 'upload' && (
        <div className="flex flex-col gap-4">
          <CampaignSelector
            campaigns={campaigns}
            value={selectedCampaignId}
            onChange={setSelectedCampaignId}
            preSet={!!campaignId}
          />
          <DropZone onFile={handleFile} />
        </div>
      )}

      {step === 'preview' && (
        <div className="flex flex-col gap-4">
          <div>
            <div className="text-xs font-semibold text-[#6b5e4e] mb-2">Column mapping (auto-detected)</div>
            <div className="grid grid-cols-2 gap-2">
              {(['email','first_name','last_name','company','title','linkedin_url','website'] as const).map(field => (
                <div key={field}>
                  <label className="text-xs text-[#8a7e6e] mb-0.5 block capitalize">{field.replace(/_/g,' ')}</label>
                  <select value={mapping[field] ?? ''} onChange={e => setMapping(m => ({ ...m, [field]: e.target.value }))}
                    className="w-full border border-[#e8e3dc] rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-[#3b6bef]">
                    <option value="">— skip —</option>
                    {headers.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs font-semibold text-[#6b5e4e] mb-2">Preview ({rows.length} rows)</div>
            <div className="border border-[#e8e3dc] rounded-lg overflow-auto max-h-36">
              <table className="w-full text-xs">
                <thead className="bg-[#f7f4f0]">
                  <tr>
                    {['email','first_name','last_name','company','title'].map(f => (
                      <th key={f} className="text-left px-2 py-1.5 text-[#8a7e6e] font-semibold whitespace-nowrap capitalize">
                        {f.replace(/_/g,' ')}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 5).map((r, i) => {
                    const built = buildCsvRow(r, mapping)
                    return (
                      <tr key={i} className="border-t border-[#f0ece6]">
                        <td className="px-2 py-1.5">{built.email || <span className="text-red-400">—</span>}</td>
                        <td className="px-2 py-1.5">{built.first_name || '—'}</td>
                        <td className="px-2 py-1.5">{built.last_name  || '—'}</td>
                        <td className="px-2 py-1.5">{built.company    || '—'}</td>
                        <td className="px-2 py-1.5">{built.title      || '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {rows.length > 5 && <p className="text-xs text-[#b0a898] mt-1">+{rows.length - 5} more rows</p>}
          </div>

          {/* Overlap analysis — shown in preview step before import */}
          {effectiveCampaignId && (
            checkingPreview ? (
              <p className="text-xs text-[#8a7e6e] flex items-center gap-1.5">
                <span className="w-3 h-3 border border-[#8a7e6e]/40 border-t-[#8a7e6e] rounded-full animate-spin inline-block" />
                Checking for overlap…
              </p>
            ) : previewChecks && (
              <div className="flex flex-col gap-2">
                {/* 🟢 New to this campaign */}
                <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-xs text-green-700 flex items-center gap-2">
                  <span className="font-semibold">🟢 {previewChecks.newEmails.length}</span>
                  <span>new to this campaign — will be added</span>
                </div>

                {/* 🟠 Already in this campaign */}
                {previewChecks.alreadyInCampaign.length > 0 && (
                  <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 text-xs text-orange-700">
                    <p className="font-semibold mb-1">
                      🟠 {previewChecks.alreadyInCampaign.length} already in this campaign — will be skipped
                    </p>
                    <div className="max-h-20 overflow-y-auto space-y-0.5 text-orange-600">
                      {previewChecks.alreadyInCampaign.map(email => (
                        <div key={email}>{email}</div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 🔵 In other campaigns — informational only */}
                {previewChecks.crossCampaign.length > 0 && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-700">
                    <p className="font-semibold mb-1">
                      🔵 {previewChecks.crossCampaign.length} also in other campaigns
                    </p>
                    <div className="max-h-20 overflow-y-auto space-y-0.5 text-blue-600">
                      {previewChecks.crossCampaign.map(({ email, campaigns: camps }) => (
                        <div key={email}>
                          <span className="font-medium">{email}</span>
                          <span className="text-blue-500"> ({camps.join(', ')})</span>
                        </div>
                      ))}
                    </div>
                    <p className="text-blue-500 mt-1.5">Make sure you're not sending 2 sequences to the same person.</p>
                  </div>
                )}
              </div>
            )
          )}

          {!mapping['email'] && (
            <p className="text-xs text-amber-600">⚠ No email column mapped — import will fail.</p>
          )}
          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="flex gap-2">
            <button onClick={() => { setStep('upload'); setRows([]); setHeaders([]); setPreviewChecks(null) }}
              className="flex-1 border border-[#e8e3dc] text-[#6b5e4e] rounded-lg py-2 text-sm">Back</button>
            <button onClick={doImport} disabled={!mapping['email'] || checkingPreview}
              className="flex-1 bg-[#3b6bef] text-white rounded-lg py-2 text-sm font-semibold disabled:opacity-40">
              Import {rows.length} rows
            </button>
          </div>
        </div>
      )}

      {step === 'importing' && (
        <div className="py-8 text-center">
          <div className="w-8 h-8 border-2 border-[#3b6bef]/30 border-t-[#3b6bef] rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-[#6b5e4e]">Importing prospects…</p>
        </div>
      )}

      {step === 'done' && result && (() => {
        const hasCampaign  = !!importedForCampaign
        const nothingNew   = result.imported_contacts === 0 && result.imported_assignments === 0
        const fullSuccess  = hasCampaign && result.imported_assignments > 0 && result.skipped_assignments_dedup === 0
        const partial      = hasCampaign && result.imported_assignments > 0 && result.skipped_assignments_dedup > 0
        const noAssignment = !hasCampaign && result.imported_contacts > 0

        return (
          <div className="flex flex-col gap-3">
            {nothingNew && (
              <div className="bg-[#f7f4f0] border border-[#e8e3dc] rounded-lg p-3 text-sm text-[#6b5e4e]">
                <div className="font-semibold mb-1">Nothing new imported</div>
                <div className="text-xs text-[#8a7e6e]">
                  {result.skipped_assignments_dedup > 0
                    ? `All ${result.skipped_assignments_dedup} contacts were already in this campaign.`
                    : result.skipped_invalid > 0
                    ? `All ${result.skipped_invalid} rows had invalid emails.`
                    : 'No new contacts or assignments were created.'}
                </div>
              </div>
            )}

            {fullSuccess && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-700">
                <div className="font-semibold mb-1">All set!</div>
                <div className="text-xs space-y-0.5">
                  <div>✓ {result.imported_assignments} prospect{result.imported_assignments !== 1 ? 's' : ''} added to campaign</div>
                  {result.imported_contacts > 0 && <div>✓ {result.imported_contacts} new contact{result.imported_contacts !== 1 ? 's' : ''} created in workspace</div>}
                  {result.skipped_invalid > 0   && <div>✕ {result.skipped_invalid} invalid emails skipped</div>}
                </div>
              </div>
            )}

            {partial && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-700">
                <div className="font-semibold mb-1">Import complete</div>
                <div className="text-xs space-y-0.5">
                  <div>✓ {result.imported_assignments} added to campaign</div>
                  <div>⏭ {result.skipped_assignments_dedup} already in this campaign — skipped</div>
                  {result.imported_contacts > 0 && <div>✓ {result.imported_contacts} new contact{result.imported_contacts !== 1 ? 's' : ''} created</div>}
                  {result.skipped_invalid > 0   && <div>✕ {result.skipped_invalid} invalid emails skipped</div>}
                </div>
              </div>
            )}

            {noAssignment && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-700">
                <div className="font-semibold mb-1">Contacts added to workspace</div>
                <div className="text-xs space-y-0.5">
                  <div>✓ {result.imported_contacts} new contact{result.imported_contacts !== 1 ? 's' : ''} created</div>
                  {result.updated_contacts > 0 && <div>↻ {result.updated_contacts} contacts already in workspace</div>}
                  {result.skipped_invalid > 0  && <div>✕ {result.skipped_invalid} invalid emails skipped</div>}
                  <div className="text-blue-500 mt-1">No campaign assigned. Go to a campaign to add them.</div>
                </div>
              </div>
            )}

            {/* Fallback for edge cases not covered above */}
            {!nothingNew && !fullSuccess && !partial && !noAssignment && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-700">
                <div className="font-semibold mb-1">Import complete</div>
                <div className="text-xs space-y-0.5">
                  {result.imported_contacts      > 0 && <div>✓ {result.imported_contacts} new contacts created</div>}
                  {result.updated_contacts       > 0 && <div>↻ {result.updated_contacts} already in workspace</div>}
                  {result.imported_assignments   > 0 && <div>✓ {result.imported_assignments} added to campaign</div>}
                  {result.skipped_assignments_dedup > 0 && <div>⏭ {result.skipped_assignments_dedup} already in campaign — skipped</div>}
                  {result.skipped_invalid        > 0 && <div>✕ {result.skipped_invalid} invalid emails skipped</div>}
                </div>
              </div>
            )}

            <button onClick={onClose} className="bg-[#1a1a2e] text-white rounded-lg py-2 text-sm font-semibold">Done</button>
          </div>
        )
      })()}
    </ModalShell>
  )
}

// ─── ManualAddModal ────────────────────────────────────────────────────────────
export function ManualAddModal({ campaignId, campaigns, onClose, onImported }: {
  campaignId?: string
  campaigns?: CampaignOption[]
  onClose: () => void
  onImported: (result: ImportResult) => void
}) {
  const [selectedCampaignId, setSelectedCampaignId] = useState(campaignId ?? '')
  const effectiveCampaignId = campaignId ?? (selectedCampaignId || undefined)

  const [form, setForm] = useState({
    email: '', first_name: '', last_name: '', company: '', title: '', linkedin_url: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  async function submit() {
    setError(''); setLoading(true)
    const res = await fetch('/api/prospects/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campaign_id: effectiveCampaignId ?? null, mode: 'manual', data: form }),
    }).then(r => r.json())
    setLoading(false)
    if (res.error) { setError(res.error); return }
    onImported(res)
    onClose()
  }

  return (
    <ModalShell title="Add Prospect" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <CampaignSelector
          campaigns={campaigns}
          value={selectedCampaignId}
          onChange={setSelectedCampaignId}
          preSet={!!campaignId}
        />
        {[
          { key: 'email',        label: 'Email *',      type: 'email' },
          { key: 'first_name',   label: 'First name',   type: 'text'  },
          { key: 'last_name',    label: 'Last name',    type: 'text'  },
          { key: 'company',      label: 'Company',      type: 'text'  },
          { key: 'title',        label: 'Job title',    type: 'text'  },
          { key: 'linkedin_url', label: 'LinkedIn URL', type: 'url'   },
        ].map(f => (
          <div key={f.key}>
            <label className="text-xs font-semibold text-[#6b5e4e] mb-1 block">{f.label}</label>
            <input type={f.type} value={(form as any)[f.key]}
              onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
              className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]" />
          </div>
        ))}
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex gap-2 mt-1">
          <button onClick={onClose}
            className="flex-1 border border-[#e8e3dc] text-[#6b5e4e] rounded-lg py-2 text-sm">Cancel</button>
          <button onClick={submit} disabled={!form.email.trim() || loading}
            className="flex-1 bg-[#3b6bef] text-white rounded-lg py-2 text-sm font-semibold disabled:opacity-40">
            {loading ? 'Adding…' : 'Add Prospect'}
          </button>
        </div>
      </div>
    </ModalShell>
  )
}

// ─── PasteModal ────────────────────────────────────────────────────────────────
export function PasteModal({ campaignId, campaigns, onClose, onImported }: {
  campaignId?: string
  campaigns?: CampaignOption[]
  onClose: () => void
  onImported: (result: ImportResult) => void
}) {
  const [selectedCampaignId, setSelectedCampaignId] = useState(campaignId ?? '')
  const effectiveCampaignId = campaignId ?? (selectedCampaignId || undefined)

  const [text, setText]     = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState('')

  const emails = text.split(/[\n,;\s]+/).map(e => e.trim()).filter(e => e.includes('@'))

  async function submit() {
    setError(''); setLoading(true)
    const res = await fetch('/api/prospects/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campaign_id: effectiveCampaignId ?? null, mode: 'paste', data: { emails } }),
    }).then(r => r.json())
    setLoading(false)
    if (res.error) { setError(res.error); return }
    onImported(res)
    onClose()
  }

  return (
    <ModalShell title="Paste Email List" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <CampaignSelector
          campaigns={campaigns}
          value={selectedCampaignId}
          onChange={setSelectedCampaignId}
          preSet={!!campaignId}
        />
        <p className="text-xs text-[#8a7e6e]">Paste email addresses — one per line, or comma/space-separated.</p>
        <textarea value={text} onChange={e => setText(e.target.value)} rows={8}
          className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef] resize-none font-mono"
          placeholder={"alice@company.com\nbob@company.com\n..."} />
        {emails.length > 0 && <p className="text-xs text-[#6b5e4e]">{emails.length} emails detected</p>}
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex gap-2">
          <button onClick={onClose}
            className="flex-1 border border-[#e8e3dc] text-[#6b5e4e] rounded-lg py-2 text-sm">Cancel</button>
          <button onClick={submit} disabled={emails.length === 0 || loading}
            className="flex-1 bg-[#3b6bef] text-white rounded-lg py-2 text-sm font-semibold disabled:opacity-40">
            {loading ? 'Importing…' : `Import ${emails.length} emails`}
          </button>
        </div>
      </div>
    </ModalShell>
  )
}
