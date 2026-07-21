'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import type { CampaignTemplate } from '@/lib/campaign-templates'
import { track } from '@/lib/track'
import { Modal } from '@/components/ui/Modal'
import { Tooltip } from '@/components/Tooltip'

const PROOF_MAX = 500

// ICP option lists + tone/language normalization : partagés avec la carte
// ICP éditable au niveau campagne (app/(dashboard)/dashboard/campaigns/[id]/page.tsx).
import {
  SIZE_OPTIONS, REV_OPTIONS,
  TONES, normalizeTone,
  LANGUAGES,
} from '@/lib/icp-options'
import type { ToneKey, LanguageValue } from '@/lib/icp-options'

interface Props {
  preset: CampaignTemplate | null
  isFromAI: boolean
  onClose: () => void
}

export function NewCampaignModal({ preset, isFromAI, onClose }: Props) {
  const t         = useTranslations('components.campaignModals.newCampaign')
  const tCommon   = useTranslations('components.campaignModals.common')
  const tTemplates = useTranslations('components.campaignModals.templates')
  const tLanguages = useTranslations('components.campaignModals.languages')
  const tErrors   = useTranslations('components.campaignModals.errors')
  const tTones    = useTranslations('dashboard.prospects.list.tones')

  const router     = useRouter()
  const isTemplate = !!preset && preset.id !== 'blank'

  // Standard template seeds resolve from i18n; AI presets carry inline strings.
  // We use tTemplates.raw() instead of tTemplates() so ICU-syntax parsing does
  // NOT run — the `angle` seeds contain the maison placeholder {{company}}
  // which is consumed later by the AI generation prompt and must be preserved
  // verbatim (ICU would reject it as MALFORMED_ARGUMENT).
  const seed = (field: 'label' | 'angle' | 'valueProp' | 'cta' | 'targetPersona'): string => {
    if (!isTemplate || !preset) return ''
    if (preset.i18nKey) {
      const raw = tTemplates.raw(`${preset.i18nKey}.${field}`)
      return typeof raw === 'string' ? raw : ''
    }
    const inlineField = field === 'valueProp'     ? 'value_prop'
                       : field === 'targetPersona' ? 'target_persona'
                       : field
    const v = (preset as unknown as Record<string, unknown>)[inlineField]
    return typeof v === 'string' ? v : ''
  }

  const [name,           setName]           = useState(isTemplate ? seed('label') : '')
  const [targetIndustry, setTargetIndustry] = useState('')
  const [targetTitles,   setTargetTitles]   = useState('')
  const [targetRegions,  setTargetRegions]  = useState('')
  const [selectedSizes,  setSelectedSizes]  = useState<string[]>([])
  const [selectedRevs,   setSelectedRevs]   = useState<string[]>([])
  const [angle,          setAngle]          = useState(seed('angle'))
  const [valueProp,      setValueProp]      = useState(seed('valueProp'))
  const [cta,            setCta]            = useState(seed('cta'))
  const [targetPersona,  setTargetPersona]  = useState(seed('targetPersona'))
  const [proofPoints,    setProofPoints]    = useState('')
  const [tone,           setTone]           = useState<ToneKey>('professional')
  const [language,       setLanguage]       = useState<LanguageValue>('English')
  const [creating,       setCreating]       = useState(false)
  const [error,          setError]          = useState('')
  const [nameError,      setNameError]      = useState('')
  const [nameFlashing,   setNameFlashing]   = useState(false)
  const nameInputRef  = useRef<HTMLInputElement>(null)
  const checkDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Mount check: if name is pre-filled (template / AI suggestion), verify availability
  useEffect(() => {
    if (name.trim()) scheduleNameCheck(name, 600)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Pre-fill structured ICP fields from workspace profile on mount (only if empty / no preset)
  useEffect(() => {
    fetch('/api/workspace-profile')
      .then(r => r.json())
      .then(d => {
        const p = d.profile
        if (!p) return
        if (p.icp_description && !targetPersona) setTargetPersona(p.icp_description)
        if (p.icp_industries?.length && !targetIndustry) setTargetIndustry(p.icp_industries.join(', '))
        if (p.target_titles && !targetTitles) setTargetTitles(p.target_titles)
        if (p.target_regions && !targetRegions) setTargetRegions(p.target_regions)
        if (p.icp_company_sizes?.length && !selectedSizes.length) setSelectedSizes(p.icp_company_sizes)
        if (p.target_company_revenue?.length && !selectedRevs.length) setSelectedRevs(p.target_company_revenue)
        if (p.product_description && !angle) setAngle(p.product_description)
        if (p.value_proposition && !valueProp) setValueProp(p.value_proposition)
        if (p.tone) setTone(normalizeTone(p.tone))
      })
      .catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function togglePill(arr: string[], val: string, setter: (v: string[]) => void) {
    setter(arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val])
  }

  async function checkNameAvailable(value: string) {
    const trimmed = value.trim()
    if (!trimmed) return
    const res = await fetch(`/api/campaigns/check-name?name=${encodeURIComponent(trimmed)}`).then(r => r.json()).catch(() => null)
    if (res && !res.available) {
      setNameError(tErrors('duplicateName'))
    }
  }

  function scheduleNameCheck(value: string, delayMs = 500) {
    if (checkDebounce.current) clearTimeout(checkDebounce.current)
    checkDebounce.current = setTimeout(() => checkNameAvailable(value), delayMs)
  }

  function handleNameBlur() {
    if (nameError) return // already showing error, don't re-check
    scheduleNameCheck(name, 0) // immediate on blur
  }

  function flashNameField() {
    setNameFlashing(true)
    nameInputRef.current?.focus()
    nameInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setTimeout(() => setNameFlashing(false), 900)
  }

  async function handleCreate() {
    if (!name.trim()) { setNameError(tErrors('requiredName')); flashNameField(); return }
    if (nameError) { flashNameField(); return }
    setCreating(true)
    setError('')
    setNameError('')

    const res = await fetch('/api/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name:            name.trim(),
        angle:           angle.trim()          || null,
        value_prop:      valueProp.trim()      || null,
        cta:             cta.trim()            || null,
        target_persona:  targetPersona.trim()  || null,
        proof_points:    proofPoints.trim()    || null,
        target_industry: targetIndustry.trim() || null,
        target_titles:   targetTitles.trim()   || null,
        target_regions:  targetRegions.trim()  || null,
        company_sizes:   selectedSizes.length  ? selectedSizes  : null,
        company_revenue: selectedRevs.length   ? selectedRevs   : null,
        tone,
        language,
      }),
    }).then(r => r.json())

    if (res.error === 'duplicate_name') {
      setNameError(tErrors('duplicateName'))
      setCreating(false)
      flashNameField()
      return
    }
    if (res.error) { setError(res.error); setCreating(false); return }
    track('campaign_created', { campaign_id: res.campaign.id, has_steps: false })
    router.push(`/dashboard/campaigns/${res.campaign.id}`)
  }

  const inputCls = 'w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]'
  const labelCls = 'block text-xs font-semibold text-[#4a4a5a] uppercase tracking-wider mb-1.5'

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={t('modalTitle')}
      size="lg"
      footer={
        <>
          <button
            onClick={onClose}
            disabled={creating}
            className="flex-1 border border-[#e8e3dc] text-[#6b5e4e] rounded-lg py-2 text-sm disabled:opacity-50"
          >
            {t('cancel')}
          </button>
          <button
            onClick={handleCreate}
            disabled={creating}
            className="flex-1 bg-[#3b6bef] hover:bg-[#2a5bdf] text-white rounded-lg py-2 text-sm font-semibold transition-colors disabled:opacity-50"
          >
            {creating ? t('creating') : t('createCta')}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-5">

        {/* Badges */}
        {isFromAI && (
          <div className="flex items-center gap-2 bg-[#eef1fd] border border-[#3b6bef]/20 rounded-lg px-3 py-2 text-xs text-[#3b6bef] font-medium">
            <span>{t('badgeAI')}</span>
          </div>
        )}
        {!isFromAI && isTemplate && (
          <div className="flex items-center gap-2 bg-[#f5f0e8] border border-[#c8a96e]/20 rounded-lg px-3 py-2 text-xs text-[#8b6914] font-medium">
            <span>{t('badgeTemplate')}</span>
          </div>
        )}

        {/* ICP: Ideal Customer Profile */}
        <div>
          <div className="mb-3 pb-1.5 border-b border-[#f0ece6]">
            <h3 className="text-xs font-bold text-[#1a1a2e] uppercase tracking-wider">{t('icpSectionTitle')}</h3>
            <p className="text-xs text-[#8a7e6e] mt-0.5">{t('icpSectionSubtitle')}</p>
          </div>
          <textarea
            aria-label="ICP description"
            value={targetPersona}
            onChange={e => setTargetPersona(e.target.value)}
            placeholder={t('icpPlaceholder')}
            rows={3}
            className={`${inputCls} resize-none`}
          />
        </div>

        {/* Campaign Name */}
        <div>
          <label className={labelCls} htmlFor="nc-campaign-name">{t('nameLabel')} <span className="text-red-500">*</span></label>
          <input
            id="nc-campaign-name"
            ref={nameInputRef}
            type="text"
            value={name}
            onChange={e => {
              const v = e.target.value
              setName(v)
              setNameError('')
              if (v.trim()) scheduleNameCheck(v, 500)
            }}
            onBlur={handleNameBlur}
            placeholder={t('namePlaceholder')}
            className={`${inputCls} ${nameError ? 'border-red-400' : ''} ${nameFlashing ? 'animate-pulse ring-2 ring-red-300' : ''}`}
          />
          {nameError && <p className="text-xs text-red-600 mt-1">{nameError}</p>}
        </div>

        {/* Define Your Ideal Customer */}
        <div>
          <div className="mb-3 pb-1.5 border-b border-[#f0ece6]">
            <h3 className="text-xs font-bold text-[#1a1a2e] uppercase tracking-wider">{t('defineIdealCustomerTitle')}</h3>
            <p className="text-xs text-[#8a7e6e] mt-0.5">{t('defineIdealCustomerSubtitle')}</p>
          </div>
          <div className="flex flex-col gap-4">
            <div>
              <label className={labelCls} htmlFor="nc-target-industry">{t('targetIndustryLabel')}</label>
              <input id="nc-target-industry" type="text" value={targetIndustry} onChange={e => setTargetIndustry(e.target.value)}
                placeholder={t('targetIndustryPlaceholder')} className={inputCls} />
            </div>
            <div>
              <label className={labelCls} htmlFor="nc-target-titles">{t('targetTitlesLabel')}</label>
              <input id="nc-target-titles" type="text" value={targetTitles} onChange={e => setTargetTitles(e.target.value)}
                placeholder={t('targetTitlesPlaceholder')} className={inputCls} />
            </div>
            <div>
              <label className={labelCls} htmlFor="nc-target-regions">{t('targetRegionsLabel')}</label>
              <input id="nc-target-regions" type="text" value={targetRegions} onChange={e => setTargetRegions(e.target.value)}
                placeholder={t('targetRegionsPlaceholder')} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>{t('companySizeLabel')}</label>
              <div className="flex flex-wrap gap-2">
                {SIZE_OPTIONS.map(opt => (
                  <button key={opt}
                    onClick={() => togglePill(selectedSizes, opt, setSelectedSizes)}
                    className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                      selectedSizes.includes(opt)
                        ? 'bg-[#3b6bef] border-[#3b6bef] text-white'
                        : 'border-[#e8e3dc] text-[#6b5e4e] hover:border-[#3b6bef]'
                    }`}>
                    {opt}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className={labelCls}>{t('companyRevenueLabel')}</label>
              <div className="flex flex-wrap gap-2">
                {REV_OPTIONS.map(opt => (
                  <button key={opt}
                    onClick={() => togglePill(selectedRevs, opt, setSelectedRevs)}
                    className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                      selectedRevs.includes(opt)
                        ? 'bg-[#3b6bef] border-[#3b6bef] text-white'
                        : 'border-[#e8e3dc] text-[#6b5e4e] hover:border-[#3b6bef]'
                    }`}>
                    {opt}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Your Pitch */}
        <div>
          <div className="mb-3 pb-1.5 border-b border-[#f0ece6]">
            <h3 className="text-xs font-bold text-[#1a1a2e] uppercase tracking-wider">{t('pitchTitle')}</h3>
          </div>
          <div className="flex flex-col gap-4">
            <div>
              <label className={labelCls} htmlFor="nc-product-angle">
                {t('productAngleLabel')} <span className="text-red-500">*</span>
              </label>
              <textarea
                id="nc-product-angle"
                value={angle}
                onChange={e => setAngle(e.target.value)}
                placeholder={t('productAnglePlaceholder')}
                rows={2}
                className={`${inputCls} resize-none`}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="nc-value-prop">
                {t('valuePropLabel')}{' '}
                <span className="text-[#a89e8e] font-normal normal-case tracking-normal">{tCommon('optional')}</span>
              </label>
              <textarea
                id="nc-value-prop"
                value={valueProp}
                onChange={e => setValueProp(e.target.value)}
                placeholder={t('valuePropPlaceholder')}
                rows={2}
                className={`${inputCls} resize-none`}
              />
            </div>
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <label className={`${labelCls} mb-0`} htmlFor="nc-proof-points">
                  {t('proofPointsLabel')}{' '}
                  <span className="text-[#a89e8e] font-normal normal-case tracking-normal">{tCommon('optional')}</span>
                </label>
                <Tooltip content={t('proofTooltip')} placement="top">
                  <svg className="w-3.5 h-3.5 text-[#b0a898] hover:text-[#3b6bef] transition-colors" viewBox="0 0 20 20" fill="currentColor" aria-label="About Proof points">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                  </svg>
                </Tooltip>
              </div>
              <textarea
                id="nc-proof-points"
                value={proofPoints}
                onChange={e => setProofPoints(e.target.value.slice(0, PROOF_MAX))}
                placeholder={t('proofPointsPlaceholder')}
                rows={2}
                maxLength={PROOF_MAX}
                aria-describedby="nc-proof-points-help"
                className={`${inputCls} resize-none`}
              />
              <p
                id="nc-proof-points-help"
                aria-live="polite"
                className={`text-xs mt-1 ${
                  proofPoints.length >= PROOF_MAX       ? 'text-red-600'
                  : proofPoints.length >= PROOF_MAX * 0.8 ? 'text-amber-600'
                  : 'text-[#8a7e6e]'
                }`}
              >
                {t('proofCounter', { count: proofPoints.length, max: PROOF_MAX })}
              </p>
            </div>
          </div>
        </div>

        {/* Tone & Language */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls} htmlFor="nc-tone">{t('toneLabel')}</label>
            <select id="nc-tone" value={tone} onChange={e => setTone(e.target.value as ToneKey)} className={inputCls}>
              {TONES.map(k => <option key={k} value={k}>{tTones(k)}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="nc-language">{t('languageLabel')}</label>
            <select id="nc-language" value={language} onChange={e => setLanguage(e.target.value as LanguageValue)} className={inputCls}>
              {LANGUAGES.map(v => <option key={v} value={v}>{tLanguages(v)}</option>)}
            </select>
          </div>
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    </Modal>
  )
}
