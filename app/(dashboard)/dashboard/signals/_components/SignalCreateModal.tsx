'use client'
import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'

type Signal = {
  id: string
  name: string
  description: string | null
  source_type: 'template' | 'custom'
  template_id: string | null
  is_active: boolean
  is_sample: boolean
  total_matches_count: number
  last_run_at: string | null
  created_at: string
  updated_at: string
  monitoring_config: Record<string, unknown>
}

type BuildPromptResult = {
  feasible: boolean
  note?: string
  suggested_name: string
  suggested_description: string
  monitoring_config: Record<string, unknown>
}

type TemplateId = 'hiring_role' | 'recent_funding' | 'tech_stack_change'
type Mode = null | 'template' | 'custom'
type TemplateStep = 'pick' | 'form'
type CustomStep = 'describe' | 'building' | 'preview'

const COMPANY_SIZE_OPTS = ['1-10', '11-50', '51-200', '201-1000', '1000+']
const FUNDING_STAGE_OPTS = ['Seed', 'Series A', 'Series B', 'Series C+']
const TECH_EVENT_OPTS = ['installed', 'uninstalled', 'both']

export function SignalCreateModal({
  isOpen,
  onClose,
  onCreated,
}: {
  isOpen: boolean
  onClose: () => void
  onCreated: (signal: Signal) => void
}) {
  const [mode, setMode] = useState<Mode>(null)
  const [templateStep, setTemplateStep] = useState<TemplateStep>('pick')
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateId | null>(null)
  const [customStep, setCustomStep] = useState<CustomStep>('describe')

  // Template form fields
  const [signalName, setSignalName] = useState('')
  const [roleText, setRoleText] = useState('')
  const [companySizes, setCompanySizes] = useState<string[]>([])
  const [fundingStages, setFundingStages] = useState<string[]>([])
  const [minFunding, setMinFunding] = useState('')
  const [techTools, setTechTools] = useState('')
  const [techEvent, setTechEvent] = useState<'installed' | 'uninstalled' | 'both'>('both')

  // Custom mode fields
  const [customDescription, setCustomDescription] = useState('')
  const [buildResult, setBuildResult] = useState<BuildPromptResult | null>(null)
  const [previewName, setPreviewName] = useState('')
  const [previewDescription, setPreviewDescription] = useState('')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function reset() {
    setMode(null)
    setTemplateStep('pick')
    setSelectedTemplate(null)
    setCustomStep('describe')
    setSignalName('')
    setRoleText('')
    setCompanySizes([])
    setFundingStages([])
    setMinFunding('')
    setTechTools('')
    setTechEvent('both')
    setCustomDescription('')
    setBuildResult(null)
    setPreviewName('')
    setPreviewDescription('')
    setSaving(false)
    setError('')
  }

  function handleClose() {
    reset()
    onClose()
  }

  function selectTemplate(tpl: TemplateId) {
    setSelectedTemplate(tpl)
    setMode('template')
    setTemplateStep('form')
    const defaultNames: Record<TemplateId, string> = {
      hiring_role:       'Hiring [role]',
      recent_funding:    'Recent funding',
      tech_stack_change: 'Tech stack change',
    }
    setSignalName(defaultNames[tpl])
    setTemplateStep('form')
  }

  async function buildWithAI() {
    if (customDescription.length < 20) return
    setCustomStep('building')
    setError('')
    try {
      const res = await fetch('/api/signals/build-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: customDescription }),
      }).then(r => r.json())
      setBuildResult(res)
      setPreviewName(res.suggested_name ?? '')
      setPreviewDescription(res.suggested_description ?? '')
      setCustomStep('preview')
    } catch {
      setError('Failed to connect to Mirvo AI. Please try again.')
      setCustomStep('describe')
    }
  }

  async function saveTemplate() {
    if (!selectedTemplate || !signalName.trim()) return
    setSaving(true)
    setError('')

    const monitoring_config: Record<string, unknown> = {}
    if (selectedTemplate === 'hiring_role') {
      monitoring_config.role = roleText
      if (companySizes.length) monitoring_config.company_sizes = companySizes
    } else if (selectedTemplate === 'recent_funding') {
      if (fundingStages.length) monitoring_config.funding_stages = fundingStages
      if (minFunding.trim()) monitoring_config.min_funding = minFunding.trim()
    } else if (selectedTemplate === 'tech_stack_change') {
      monitoring_config.tools = techTools.split(',').map(t => t.trim()).filter(Boolean)
      monitoring_config.event_type = techEvent
    }

    const res = await fetch('/api/signals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: signalName.trim(),
        source_type: 'template',
        template_id: selectedTemplate,
        monitoring_config,
      }),
    }).then(r => r.json())

    if (res.signal) {
      reset()
      onCreated(res.signal)
    } else {
      setError(res.error ?? 'Failed to save signal')
      setSaving(false)
    }
  }

  async function saveCustom() {
    if (!buildResult?.feasible || !previewName.trim()) return
    setSaving(true)
    setError('')

    const res = await fetch('/api/signals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: previewName.trim(),
        description: previewDescription.trim() || undefined,
        source_type: 'custom',
        prompt_natural_language: customDescription,
        monitoring_config: buildResult.monitoring_config ?? {},
      }),
    }).then(r => r.json())

    if (res.signal) {
      reset()
      onCreated(res.signal)
    } else {
      setError(res.error ?? 'Failed to save signal')
      setSaving(false)
    }
  }

  // ── Render helpers ──────────────────────────────────────────────────────────

  function togglePill<T extends string>(arr: T[], val: T, setter: (v: T[]) => void) {
    setter(arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val])
  }

  // Modal title based on state
  function getTitle() {
    if (mode === null) return 'Create a new signal'
    if (mode === 'template' && templateStep === 'form') {
      const labels: Record<TemplateId, string> = {
        hiring_role: 'Hiring role signal',
        recent_funding: 'Recent funding signal',
        tech_stack_change: 'Tech stack change signal',
      }
      return labels[selectedTemplate!] ?? 'Configure signal'
    }
    if (mode === 'custom' && customStep === 'describe') return 'Custom signal'
    if (mode === 'custom' && customStep === 'building') return 'Analyzing your signal…'
    if (mode === 'custom' && customStep === 'preview') return 'AI suggestion ready'
    return 'Create a new signal'
  }

  function renderContent() {
    // ── Mode picker ──────────────────────────────────────────────────────────
    if (mode === null) {
      return (
        <div className="flex flex-col gap-5">
          <p className="text-sm text-[#8a7e6e]">How would you like to create your signal?</p>

          {/* Template section — 3 individually clickable cards */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-sm">🎯</span>
              <div>
                <p className="text-sm font-semibold text-[#1a1a2e]">Use a template</p>
                <p className="text-xs text-[#8a7e6e]">Quick start with pre-built signals for common use cases</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {([
                { id: 'hiring_role' as TemplateId, emoji: '💼', label: 'Hiring [role]', desc: 'Job postings for specific roles' },
                { id: 'recent_funding' as TemplateId, emoji: '💰', label: 'Recent funding', desc: 'Funding announcements at companies' },
                { id: 'tech_stack_change' as TemplateId, emoji: '🔧', label: 'Tech stack change', desc: 'Tools installed on websites' },
              ]).map(t => (
                <button
                  key={t.id}
                  onClick={() => selectTemplate(t.id)}
                  className="text-left bg-[#f7f8ff] border border-[#dde6fd] rounded-xl p-3 hover:border-[#3b6bef] hover:bg-[#eef1fd] transition-colors"
                >
                  <div className="text-lg mb-1.5">{t.emoji}</div>
                  <div className="text-xs font-semibold text-[#3b6bef] mb-1 leading-snug">{t.label}</div>
                  <div className="text-[11px] text-[#8a7e6e] leading-snug">{t.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Custom option */}
          <button
            onClick={() => setMode('custom')}
            className="text-left border border-[#e8e3dc] rounded-xl p-4 hover:border-[#3b6bef] hover:bg-[#f7f8ff] transition-colors group"
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-base">✨</span>
                  <span className="font-semibold text-sm text-[#1a1a2e] group-hover:text-[#3b6bef]">Custom signal</span>
                  <span className="bg-[#eef1fd] text-[#3b6bef] text-[10px] font-semibold px-2 py-0.5 rounded-full border border-[#dde6fd]">
                    Mirvo AI
                  </span>
                </div>
                <p className="text-xs text-[#8a7e6e]">Describe in plain English what to monitor</p>
              </div>
              <span className="text-[#3b6bef] text-sm font-semibold">→</span>
            </div>
          </button>
        </div>
      )
    }

    // ── Template: form ───────────────────────────────────────────────────────
    if (mode === 'template' && templateStep === 'form') {
      return (
        <div className="flex flex-col gap-4">
          <div>
            <label className="text-xs font-semibold text-[#6b5e4e] mb-1 block">Signal name</label>
            <input
              type="text"
              value={signalName}
              onChange={e => setSignalName(e.target.value)}
              className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-[#3b6bef]"
            />
          </div>

          {selectedTemplate === 'hiring_role' && (
            <>
              <div>
                <label className="text-xs font-semibold text-[#6b5e4e] mb-1 block">
                  Role to monitor <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={roleText}
                  onChange={e => setRoleText(e.target.value)}
                  placeholder="e.g. Head of Sales, SDR, RevOps Manager"
                  className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-[#3b6bef]"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-[#6b5e4e] mb-2 block">Company size (optional)</label>
                <div className="flex flex-wrap gap-2">
                  {COMPANY_SIZE_OPTS.map(s => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => togglePill(companySizes, s, setCompanySizes)}
                      className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                        companySizes.includes(s)
                          ? 'bg-[#1a1a2e] text-white border-[#1a1a2e]'
                          : 'border-[#e8e3dc] text-[#6b5e4e] hover:border-[#1a1a2e]'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {selectedTemplate === 'recent_funding' && (
            <>
              <div>
                <label className="text-xs font-semibold text-[#6b5e4e] mb-2 block">Funding stage (optional)</label>
                <div className="flex flex-wrap gap-2">
                  {FUNDING_STAGE_OPTS.map(s => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => togglePill(fundingStages, s, setFundingStages)}
                      className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                        fundingStages.includes(s)
                          ? 'bg-[#1a1a2e] text-white border-[#1a1a2e]'
                          : 'border-[#e8e3dc] text-[#6b5e4e] hover:border-[#1a1a2e]'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-[#6b5e4e] mb-1 block">Minimum amount (optional)</label>
                <input
                  type="text"
                  value={minFunding}
                  onChange={e => setMinFunding(e.target.value)}
                  placeholder="e.g. $10M+"
                  className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-[#3b6bef]"
                />
              </div>
            </>
          )}

          {selectedTemplate === 'tech_stack_change' && (
            <>
              <div>
                <label className="text-xs font-semibold text-[#6b5e4e] mb-1 block">
                  Tools to monitor <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={techTools}
                  onChange={e => setTechTools(e.target.value)}
                  placeholder="e.g. HubSpot, Salesforce, Outreach"
                  className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-[#3b6bef]"
                />
                <p className="text-[11px] text-[#8a7e6e] mt-1">Comma-separated list of tools</p>
              </div>
              <div>
                <label className="text-xs font-semibold text-[#6b5e4e] mb-2 block">Event type</label>
                <div className="flex gap-2">
                  {TECH_EVENT_OPTS.map(e => (
                    <button
                      key={e}
                      type="button"
                      onClick={() => setTechEvent(e as typeof techEvent)}
                      className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                        techEvent === e
                          ? 'bg-[#1a1a2e] text-white border-[#1a1a2e]'
                          : 'border-[#e8e3dc] text-[#6b5e4e] hover:border-[#1a1a2e]'
                      }`}
                    >
                      {e.charAt(0).toUpperCase() + e.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
      )
    }

    // ── Custom: describe ─────────────────────────────────────────────────────
    if (mode === 'custom' && customStep === 'describe') {
      return (
        <div className="flex flex-col gap-4">
          <div>
            <label className="text-xs font-semibold text-[#6b5e4e] mb-1 block">
              Describe what to detect, in plain English
            </label>
            <textarea
              value={customDescription}
              onChange={e => setCustomDescription(e.target.value)}
              rows={5}
              className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-[#3b6bef] resize-none"
              placeholder={'Example: "B2B SaaS companies that recently lost their Head of Sales (LinkedIn departures in last 60 days)"'}
            />
            <p className="text-[11px] text-[#8a7e6e] mt-1">
              Min. 20 characters. Describe a publicly observable event.
            </p>
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
      )
    }

    // ── Custom: building ─────────────────────────────────────────────────────
    if (mode === 'custom' && customStep === 'building') {
      return (
        <div className="py-8 text-center flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-[#3b6bef] border-t-transparent rounded-full animate-spin" />
          <p className="text-sm font-medium text-[#1a1a2e]">Mirvo AI is analyzing your signal…</p>
          <p className="text-xs text-[#8a7e6e]">Checking feasibility and generating monitoring config</p>
        </div>
      )
    }

    // ── Custom: preview ──────────────────────────────────────────────────────
    if (mode === 'custom' && customStep === 'preview' && buildResult) {
      if (!buildResult.feasible) {
        return (
          <div className="flex flex-col gap-4">
            <div className="bg-red-50 border border-red-200 rounded-xl p-4">
              <p className="text-red-500 font-semibold text-sm mb-2">✗ This signal isn&apos;t feasible to monitor publicly</p>
              <p className="text-xs text-red-700 leading-relaxed">{buildResult.note}</p>
            </div>
            <div className="bg-[#f7f8ff] border border-[#dde6fd] rounded-xl p-4">
              <p className="text-xs font-semibold text-[#3b6bef] mb-2">Public observable events you could try instead:</p>
              <ul className="space-y-1">
                {[
                  'Job postings (LinkedIn Jobs, careers pages)',
                  'Funding announcements (press releases, Crunchbase)',
                  'Tech stack changes (BuiltWith, job post mentions)',
                  'Layoffs (layoffs.fyi, press coverage)',
                  'Press mentions / PR coverage (news, Business Wire)',
                  'Leadership changes (LinkedIn profile updates)',
                ].map(item => (
                  <li key={item} className="text-xs text-[#6b5e4e] flex items-start gap-1.5">
                    <span className="text-[#3b6bef] mt-0.5 flex-shrink-0">·</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )
      }

      const cfg = buildResult.monitoring_config as Record<string, unknown>
      return (
        <div className="flex flex-col gap-4">
          <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex items-center gap-2">
            <span className="text-green-600 font-semibold text-sm">✓ This signal is feasible to monitor</span>
          </div>

          {buildResult.note && (
            <p className="text-xs text-[#8a7e6e] leading-relaxed">{buildResult.note}</p>
          )}

          <div>
            <label className="text-xs font-semibold text-[#6b5e4e] mb-1 block">Signal name</label>
            <input
              type="text"
              value={previewName}
              onChange={e => setPreviewName(e.target.value)}
              className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-[#3b6bef]"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-[#6b5e4e] mb-1 block">Description</label>
            <textarea
              value={previewDescription}
              onChange={e => setPreviewDescription(e.target.value)}
              rows={2}
              className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-[#3b6bef] resize-none"
            />
          </div>

          <div className="bg-[#f7f8ff] border border-[#dde6fd] rounded-xl p-4">
            <p className="text-xs font-semibold text-[#3b6bef] mb-3">How we'll monitor it</p>
            <div className="flex flex-col gap-1.5 text-xs text-[#4a4a5a]">
              {!!cfg.source && (
                <div className="flex gap-2">
                  <span className="text-[#8a7e6e] w-20 flex-shrink-0">Source</span>
                  <span className="font-medium">{String(cfg.source).replace(/_/g, ' ')}</span>
                </div>
              )}
              {!!cfg.search_strategy && (
                <div className="flex gap-2">
                  <span className="text-[#8a7e6e] w-20 flex-shrink-0">Strategy</span>
                  <span className="leading-relaxed">{String(cfg.search_strategy)}</span>
                </div>
              )}
              {Array.isArray(cfg.match_keywords) && cfg.match_keywords.length > 0 && (
                <div className="flex gap-2">
                  <span className="text-[#8a7e6e] w-20 flex-shrink-0">Keywords</span>
                  <span>{(cfg.match_keywords as string[]).slice(0, 5).join(', ')}{(cfg.match_keywords as string[]).length > 5 ? ` +${(cfg.match_keywords as string[]).length - 5} more` : ''}</span>
                </div>
              )}
              {typeof cfg.freshness_days === 'number' && (
                <div className="flex gap-2">
                  <span className="text-[#8a7e6e] w-20 flex-shrink-0">Freshness</span>
                  <span>{cfg.freshness_days} days</span>
                </div>
              )}
            </div>
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
      )
    }

    return null
  }

  function renderFooter() {
    if (mode === null) return null

    if (mode === 'template' && templateStep === 'form') {
      const canSave = signalName.trim().length > 0 && (
        selectedTemplate !== 'hiring_role' || roleText.trim().length > 0
      ) && (
        selectedTemplate !== 'tech_stack_change' || techTools.trim().length > 0
      )
      return (
        <div className="flex gap-3 w-full">
          <button
            onClick={() => { setMode(null); setTemplateStep('pick'); setSelectedTemplate(null) }}
            className="border border-[#e8e3dc] text-[#6b5e4e] rounded-lg px-4 py-2 text-sm hover:bg-[#f7f4f0] transition-colors"
          >
            ← Back
          </button>
          <button
            onClick={saveTemplate}
            disabled={!canSave || saving}
            className="flex-1 bg-[#1a1a2e] text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-40 hover:bg-[#2a2a3e] transition-colors"
          >
            {saving ? 'Saving…' : 'Save signal'}
          </button>
        </div>
      )
    }

    if (mode === 'custom' && customStep === 'describe') {
      return (
        <div className="flex gap-3 w-full">
          <button
            onClick={() => setMode(null)}
            className="border border-[#e8e3dc] text-[#6b5e4e] rounded-lg px-4 py-2 text-sm hover:bg-[#f7f4f0] transition-colors"
          >
            ← Back
          </button>
          <button
            onClick={buildWithAI}
            disabled={customDescription.length < 20}
            className="flex-1 bg-[#3b6bef] text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-40 hover:bg-[#2a5bdf] transition-colors"
          >
            Build with AI →
          </button>
        </div>
      )
    }

    if (mode === 'custom' && customStep === 'building') {
      return null
    }

    if (mode === 'custom' && customStep === 'preview') {
      if (!buildResult?.feasible) {
        return (
          <button
            onClick={() => setCustomStep('describe')}
            className="border border-[#e8e3dc] text-[#6b5e4e] rounded-lg px-4 py-2 text-sm hover:bg-[#f7f4f0] transition-colors"
          >
            ← Back to description
          </button>
        )
      }
      return (
        <div className="flex gap-3 w-full">
          <button
            onClick={() => setCustomStep('describe')}
            className="border border-[#e8e3dc] text-[#6b5e4e] rounded-lg px-4 py-2 text-sm hover:bg-[#f7f4f0] transition-colors whitespace-nowrap"
          >
            ← Try different description
          </button>
          <button
            onClick={saveCustom}
            disabled={!previewName.trim() || saving}
            className="flex-1 bg-[#1a1a2e] text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-40 hover:bg-[#2a2a3e] transition-colors"
          >
            {saving ? 'Saving…' : 'Save signal →'}
          </button>
        </div>
      )
    }

    return null
  }

  const footer = renderFooter()

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={getTitle()}
      size="lg"
      footer={footer ?? undefined}
    >
      {renderContent()}
    </Modal>
  )
}
