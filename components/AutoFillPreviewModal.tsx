'use client'
import { useState } from 'react'
import { useTranslations } from 'next-intl'

export interface ExtractedFields {
  industry?:            string
  user_company_size?:   string          // strict single enum value
  product_description?: string
  value_proposition?:   string
  icp_description?:     string
  target_industry?:     string
  target_titles?:       string[]
  target_regions?:      string[]
  target_company_size?: string[]        // generous multi-range array
  target_pain_points?:  string
  email_tone?:          string
}

interface Props {
  extracted: ExtractedFields
  url:       string
  onApply:   (values: ExtractedFields) => void
  onCancel:  () => void
}

// Must match COMPANY_SIZES in prospects/page.tsx and settings/page.tsx
const SIZE_OPTIONS = ['1-10', '10-50', '50-200', '200-500', '500-1000', '1000+']

// Labels resolved at render via useTranslations. Field key and section key
// are the canonical i18n lookup keys (matching messages/{en,fr}.json under
// components.autoFill.fields.* / components.autoFill.sections.*).
type FieldDef = {
  key:     keyof ExtractedFields
  type:    'input' | 'textarea' | 'array' | 'select' | 'multisize'
  section: 'COMPANY' | 'PRODUCT' | 'AUDIENCE'
  options?: string[]
}

const FIELDS: FieldDef[] = [
  { key: 'industry',            type: 'input',     section: 'COMPANY' },
  { key: 'user_company_size',   type: 'select',    section: 'COMPANY', options: SIZE_OPTIONS },
  { key: 'product_description', type: 'textarea',  section: 'PRODUCT' },
  { key: 'value_proposition',   type: 'textarea',  section: 'PRODUCT' },
  { key: 'icp_description',     type: 'textarea',  section: 'AUDIENCE' },
  { key: 'target_industry',     type: 'input',     section: 'AUDIENCE' },
  { key: 'target_titles',       type: 'array',     section: 'AUDIENCE' },
  { key: 'target_regions',      type: 'array',     section: 'AUDIENCE' },
  { key: 'target_company_size', type: 'multisize', section: 'AUDIENCE' },
  { key: 'target_pain_points',  type: 'textarea',  section: 'AUDIENCE' },
  { key: 'email_tone',          type: 'select',    section: 'AUDIENCE',
    options: ['professional', 'casual', 'technical', 'warm'] },
]

const SECTIONS = ['COMPANY', 'PRODUCT', 'AUDIENCE'] as const

function toStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string')
  if (typeof v === 'string') return [v]
  return []
}

export function AutoFillPreviewModal({ extracted, url, onApply, onCancel }: Props) {
  const t = useTranslations('components.autoFill.preview')
  const tFields = useTranslations('components.autoFill.fields')
  const tSections = useTranslations('components.autoFill.sections')
  const [edited, setEdited]     = useState<ExtractedFields>({ ...extracted })
  const [selected, setSelected] = useState<Set<keyof ExtractedFields>>(
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
    setEdited(prev => ({ ...prev, [key]: raw.split(',').map(s => s.trim()).filter(Boolean) }))
  }

  function toggleSizeOption(key: keyof ExtractedFields, option: string) {
    setEdited(prev => {
      const current = toStringArray(prev[key])
      const next    = current.includes(option)
        ? current.filter(v => v !== option)
        : [...current, option]
      return { ...prev, [key]: next }
    })
  }

  function handleApply() {
    const result: ExtractedFields = {}
    selected.forEach(key => {
      const v = (edited as Record<string, unknown>)[key]
      if (v !== undefined) (result as Record<string, unknown>)[key] = v
    })
    onApply(result)
  }

  const selectedCount = selected.size

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      onClick={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[calc(100vh-2rem)] flex flex-col">

        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-[#f0ece6] shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-[#1a1a2e]">{t('title')}</h2>
              <p className="text-xs text-[#8a7e6e] mt-0.5 truncate max-w-sm">{url}</p>
            </div>
            <button onClick={onCancel} className="p-2 text-[#8a7e6e] hover:text-[#1a1a2e] text-xl leading-none shrink-0">✕</button>
          </div>
          <p className="text-xs text-[#6b5e4e] mt-2">{t('subtitle')}</p>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-5 flex flex-col gap-5">
          {SECTIONS.map(section => {
            const sectionFields = FIELDS.filter(f => f.section === section)
            const anyExtracted  = sectionFields.some(f => extracted[f.key] !== undefined)
            if (!anyExtracted) return null
            return (
              <div key={section}>
                <div className="text-[10px] font-bold text-[#8a7e6e] uppercase tracking-widest mb-3">{tSections(section)}</div>
                <div className="flex flex-col gap-3">
                  {sectionFields.map(field => {
                    const hasValue  = extracted[field.key] !== undefined
                    const isChecked = selected.has(field.key)
                    const rawValue  = edited[field.key]

                    const displayValue = Array.isArray(rawValue)
                      ? (rawValue as string[]).join(', ')
                      : (rawValue as string | undefined) ?? ''

                    const sizeValues = field.type === 'multisize' ? toStringArray(rawValue) : []

                    return (
                      <div key={field.key}
                        className={`flex gap-3 items-start p-3 rounded-lg border transition-colors
                          ${isChecked && hasValue ? 'border-[#e8e3dc] bg-white' : 'border-[#f0ece6] bg-[#faf8f5] opacity-60'}`}>
                        <input
                          type="checkbox"
                          checked={isChecked && hasValue}
                          disabled={!hasValue}
                          onChange={() => toggleField(field.key)}
                          className="mt-1 rounded border-[#e8e3dc] text-[#3b6bef] shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <label className="text-xs font-medium text-[#6b5e4e] block mb-1">{tFields(field.key)}</label>
                          {!hasValue ? (
                            <p className="text-xs text-[#b0a898] italic">{t('notFound')}</p>
                          ) : field.type === 'multisize' ? (
                            <div className="flex flex-wrap gap-1.5">
                              {SIZE_OPTIONS.map(opt => {
                                const active = sizeValues.includes(opt)
                                return (
                                  <button
                                    key={opt}
                                    type="button"
                                    disabled={!isChecked}
                                    onClick={() => toggleSizeOption(field.key, opt)}
                                    className={`px-2 py-0.5 rounded-full text-xs border transition-colors
                                      ${active
                                        ? 'bg-[#3b6bef] text-white border-[#3b6bef]'
                                        : 'bg-white text-[#6b5e4e] border-[#e8e3dc] hover:border-[#3b6bef]'}
                                      disabled:opacity-40 disabled:cursor-not-allowed`}
                                  >
                                    {opt}
                                  </button>
                                )
                              })}
                            </div>
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
                              placeholder={t('arrayPlaceholder')}
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
            {t('cancel')}
          </button>
          <button
            onClick={handleApply}
            disabled={selectedCount === 0}
            className="flex-1 bg-[#3b6bef] text-white rounded-lg py-2 text-sm font-semibold disabled:opacity-40"
          >
            {t('applyCta', { count: selectedCount })}
          </button>
        </div>
      </div>
    </div>
  )
}
