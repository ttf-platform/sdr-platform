'use client'
import { useState, useRef } from 'react'
import Papa from 'papaparse'

// ─── Types ────────────────────────────────────────────────────────────────────
export interface ImportResult {
  imported: number
  skipped_dedup: number
  skipped_invalid: number
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

// ─── ImportCSVModal ────────────────────────────────────────────────────────────
export function ImportCSVModal({ campaignId, onClose, onImported }: {
  campaignId?: string
  onClose: () => void
  onImported: (result: ImportResult) => void
}) {
  const [step, setStep] = useState<'upload' | 'preview' | 'importing' | 'done'>('upload')
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows]       = useState<Record<string, string>[]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [warnings, setWarnings] = useState<{ email: string; campaign: string }[]>([])
  const [result, setResult]   = useState<ImportResult | null>(null)
  const [error, setError]     = useState('')

  function handleFile(file: File) {
    Papa.parse<Record<string, string>>(file, {
      header: true, skipEmptyLines: true,
      complete(parsed) {
        const hdrs = parsed.meta.fields ?? []
        setHeaders(hdrs)
        setRows(parsed.data)
        setMapping(detectColumns(hdrs))
        setStep('preview')
      },
    })
  }

  async function doImport() {
    setStep('importing')
    setError('')

    // Cross-campaign warning (only when importing into a specific campaign)
    let warns: { email: string; campaign: string }[] = []
    if (campaignId && rows.length > 0) {
      const emails = rows.map(r => buildCsvRow(r, mapping).email).filter(Boolean).join(',')
      if (emails) {
        const res = await fetch(`/api/prospects?emails=${encodeURIComponent(emails)}&exclude_campaign=${campaignId}`)
        const data = await res.json()
        warns = (data.matches ?? []).map((m: any) => ({
          email: m.email, campaign: m.campaigns?.name ?? 'another campaign',
        }))
      }
    }
    setWarnings(warns)

    const csvRows = rows.map(r => buildCsvRow(r, mapping)).filter(r => r.email)
    const res = await fetch('/api/prospects/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campaign_id: campaignId ?? null, mode: 'csv', data: { rows: csvRows } }),
    }).then(r => r.json())

    if (res.error) { setError(res.error); setStep('preview'); return }
    setResult(res)
    setStep('done')
    onImported(res)
  }

  return (
    <ModalShell title="Import CSV" onClose={onClose}>
      {step === 'upload' && <DropZone onFile={handleFile} />}

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

          {!mapping['email'] && (
            <p className="text-xs text-amber-600">⚠ No email column mapped — import will fail.</p>
          )}
          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="flex gap-2">
            <button onClick={() => { setStep('upload'); setRows([]); setHeaders([]) }}
              className="flex-1 border border-[#e8e3dc] text-[#6b5e4e] rounded-lg py-2 text-sm">Back</button>
            <button onClick={doImport} disabled={!mapping['email']}
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

      {step === 'done' && result && (
        <div className="flex flex-col gap-3">
          {warnings.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p className="text-xs font-semibold text-amber-700 mb-1">⚠ Cross-campaign overlap ({warnings.length})</p>
              <p className="text-xs text-amber-600 mb-2">These emails are already in other campaigns:</p>
              <div className="max-h-20 overflow-y-auto text-xs text-amber-700 space-y-0.5">
                {warnings.map((w, i) => <div key={i}>{w.email} → {w.campaign}</div>)}
              </div>
            </div>
          )}
          <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-700">
            <div className="font-semibold mb-1">Import complete</div>
            <div className="text-xs space-y-0.5">
              <div>✓ {result.imported} imported</div>
              {result.skipped_dedup    > 0 && <div>↩ {result.skipped_dedup} duplicates skipped</div>}
              {result.skipped_invalid  > 0 && <div>✕ {result.skipped_invalid} invalid emails skipped</div>}
            </div>
          </div>
          <button onClick={onClose} className="bg-[#1a1a2e] text-white rounded-lg py-2 text-sm font-semibold">Done</button>
        </div>
      )}
    </ModalShell>
  )
}

// ─── ManualAddModal ────────────────────────────────────────────────────────────
export function ManualAddModal({ campaignId, onClose, onImported }: {
  campaignId?: string
  onClose: () => void
  onImported: (result: ImportResult) => void
}) {
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
      body: JSON.stringify({ campaign_id: campaignId ?? null, mode: 'manual', data: form }),
    }).then(r => r.json())
    setLoading(false)
    if (res.error) { setError(res.error); return }
    onImported({ imported: 1, skipped_dedup: 0, skipped_invalid: 0 })
    onClose()
  }

  return (
    <ModalShell title="Add Prospect" onClose={onClose}>
      <div className="flex flex-col gap-3">
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
export function PasteModal({ campaignId, onClose, onImported }: {
  campaignId?: string
  onClose: () => void
  onImported: (result: ImportResult) => void
}) {
  const [text, setText]     = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState('')

  const emails = text.split(/[\n,;\s]+/).map(e => e.trim()).filter(e => e.includes('@'))

  async function submit() {
    setError(''); setLoading(true)
    const res = await fetch('/api/prospects/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campaign_id: campaignId ?? null, mode: 'paste', data: { emails } }),
    }).then(r => r.json())
    setLoading(false)
    if (res.error) { setError(res.error); return }
    onImported(res)
    onClose()
  }

  return (
    <ModalShell title="Paste Email List" onClose={onClose}>
      <div className="flex flex-col gap-3">
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
