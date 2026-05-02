'use client'
import { useState } from 'react'

export interface ExtractedFields {
  industry?:           string
  user_company_size?:  string
  product_description?: string
  value_proposition?:  string
  icp_description?:    string
  target_industry?:    string
  target_titles?:      string[]
  target_regions?:     string[]
  target_company_size?: string
  target_pain_points?: string
  email_tone?:         string
}

interface Props {
  extracted: ExtractedFields
  url:       string
  onApply:   (values: ExtractedFields) => void
  onCancel:  () => void
}

type FieldDef = { key: keyof ExtractedFields; label: string; type: 'input' | 'textarea' | 'array' | 'select'; section: string; options?: string[] }

const FIELDS: FieldDef[] = [
  { key: 'industry',           label: 'Your industry',        type: 'input',    section: 'COMPANY' },
  { key: 'user_company_size',  label: 'Your company size',    type: 'select',   section: 'COMPANY', options: ['1-10','11-50','51-200','201-500','501-1000','1000+'] },
  { key: 'product_description',label: 'Product description',  type: 'textarea', section: 'PRODUCT' },
  { key: 'value_proposition',  label: 'Value proposition',    type: 'textarea', section: 'PRODUCT' },
  { key: 'icp_description',    label: 'ICP description',      type: 'textarea', section: 'AUDIENCE' },
  { key: 'target_industry',    label: 'Target industry',      type: 'input',    section: 'AUDIENCE' },
  { key: 'target_titles',      label: 'Decision-maker titles',type: 'array',    section: 'AUDIENCE' },
  { key: 'target_regions',     label: 'Target regions',       type: 'array',    section: 'AUDIENCE' },
  { key: 'target_company_size',label: 'Target company size',  type: 'input',    section: 'AUDIENCE' },
  { key: 'target_pain_points', label: 'Pain points',          type: 'textarea', section: 'AUDIENCE' },
  { key: 'email_tone',         label: 'Email tone',           type: 'select',   section: 'AUDIENCE', options: ['professional','casual','technical','warm','friendly','direct'] },
]

const SECTIONS = ['COMPANY', 'PRODUCT', 'AUDIENCE']

export function AutoFillPreviewModal({ extracted, url, onApply, onCancel }: Props) {
  // Editable copies of the extracted values
  const [edited, setEdited]       = useState<ExtractedFields>({ ...extracted })
  // Which fields are selected for apply (default: all extracted)
  const [selected, setSelected]   = useState<Set<keyof ExtractedFields>>(
    () => new Set(Object.keys(extracted) as (keyof ExtractedFields)[]),
  )

  function toggleField(key: keyof ExtractedFields) {
    setSelected(prev => {
      const n = new Set(prev)
      n.has(key) ? n.delete(key) : n.add(key)
      return n
    })
  }

  function updateValue(key: keyof ExtractedFields, value: string) {
    setEdited(prev => ({ ...prev, [key]: value }))
  }

  function updateArray(key: keyof ExtractedFields, raw: string) {
    const arr = raw.split(',').map(s => s.trim()).filter(Boolean)
    setEdited(prev => ({ ...prev, [key]: arr }))
  }

  function handleApply() {
    const result: ExtractedFields = {}
    for (const key of selected) {
      const v = edited[key]
      if (v !== undefined) (result as any)[key] = v
    }
    onApply(result)
  }

  const selectedCount = selected.size

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      onClick={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="p-5 border-b border-[#f0ece6] shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-[#1a1a2e]">✨ Here&apos;s what we found</h2>
              <p className="text-xs text-[#8a7e6e] mt-0.5 truncate max-w-sm">{url}</p>
            </div>
            <button onClick={onCancel} className="text-[#8a7e6e] hover:text-[#1a1a2e] text-xl leading-none shrink-0">✕</button>
          </div>
          <p className="text-xs text-[#6b5e4e] mt-2">
            Review and edit before applying. Uncheck any field you don&apos;t want to fill.
          </p>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-5 flex flex-col gap-5">
          {SECTIONS.map(section => {
            const sectionFields = FIELDS.filter(f => f.section === section)
            const anyExtracted  = sectionFields.some(f => extracted[f.key] !== undefined)
            if (!anyExtracted) return null
            return (
              <div key={section}>
                <div className="text-[10px] font-bold text-[#8a7e6e] uppercase tracking-widest mb-3">{section}</div>
                <div className="flex flex-col gap-3">
                  {sectionFields.map(field => {
                    const hasValue  = extracted[field.key] !== undefined
                    const isChecked = selected.has(field.key)
                    const rawValue  = edited[field.key]
                    const displayValue = Array.isArray(rawValue)
                      ? (rawValue as string[]).join(', ')
                      : (rawValue as string | undefined) ?? ''

                    return (
                      <div key={field.key} className={`flex gap-3 items-start p-3 rounded-lg border transition-colors ${isChecked && hasValue ? 'border-[#e8e3dc] bg-white' : 'border-[#f0ece6] bg-[#faf8f5] opacity-60'}`}>
                        <input
                          type="checkbox"
                          checked={isChecked && hasValue}
                          disabled={!hasValue}
                          onChange={() => toggleField(field.key)}
                          className="mt-1 rounded border-[#e8e3dc] text-[#3b6bef] shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <label className="text-xs font-medium text-[#6b5e4e] block mb-1">{field.label}</label>
                          {!hasValue ? (
                            <p className="text-xs text-[#b0a898] italic">Not found on website</p>
                          ) : field.type === 'select' ? (
                            <select
                              value={displayValue}
                              onChange={e => updateValue(field.key, e.target.value)}
                              disabled={!isChecked}
                              className="w-full border border-[#e8e3dc] rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:border-[#3b6bef] disabled:opacity-50"
                            >
                              {field.options?.map(o => <option key={o} value={o}>{o}</option>)}
                            </select>
                          ) : field.type === 'textarea' ? (
                            <textarea
                              value={displayValue}
                              onChange={e => updateValue(field.key, e.target.value)}
                              disabled={!isChecked}
                              rows={2}
                              className="w-full border border-[#e8e3dc] rounded-lg px-2 py-1.5 text-xs resize-none focus:outline-none focus:border-[#3b6bef] disabled:opacity-50"
                            />
                          ) : field.type === 'array' ? (
                            <input
                              value={displayValue}
                              onChange={e => updateArray(field.key, e.target.value)}
                              disabled={!isChecked}
                              placeholder="comma-separated"
                              className="w-full border border-[#e8e3dc] rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-[#3b6bef] disabled:opacity-50"
                            />
                          ) : (
                            <input
                              value={displayValue}
                              onChange={e => updateValue(field.key, e.target.value)}
                              disabled={!isChecked}
                              className="w-full border border-[#e8e3dc] rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-[#3b6bef] disabled:opacity-50"
                            />
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div className="flex gap-2 p-5 border-t border-[#f0ece6] shrink-0">
          <button onClick={onCancel}
            className="flex-1 border border-[#e8e3dc] text-[#6b5e4e] rounded-lg py-2 text-sm">
            Cancel
          </button>
          <button
            onClick={handleApply}
            disabled={selectedCount === 0}
            className="flex-1 bg-[#3b6bef] text-white rounded-lg py-2 text-sm font-semibold disabled:opacity-40"
          >
            Apply ({selectedCount} field{selectedCount !== 1 ? 's' : ''})
          </button>
        </div>
      </div>
    </div>
  )
}
