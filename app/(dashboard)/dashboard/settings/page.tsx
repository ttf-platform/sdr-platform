'use client'
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { useTranslations, useLocale } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { Tooltip } from '@/components/Tooltip'
import { StatusBadge } from '@/components/StatusBadge'
import { ChangePasswordModal } from '@/components/ChangePasswordModal'
import { DeleteAccountModal } from '@/components/DeleteAccountModal'
import { renderSignature } from '@/lib/signature'
import { useWorkspace } from '@/lib/hooks/useWorkspace'
import { NotificationPreferencesSection } from '@/components/settings/NotificationPreferencesSection'

const supabase = createClient()

const COMPANY_SIZES      = ['1-10', '10-50', '50-200', '200-500', '500-1000', '1000+']
const WORKSPACE_TIMEZONES = [
  'America/Toronto','America/New_York','America/Chicago','America/Denver',
  'America/Los_Angeles','America/Vancouver','Europe/London','Europe/Paris',
  'Europe/Berlin','Asia/Tokyo','Asia/Singapore','Australia/Sydney','UTC',
]

const DEFAULT_SIGNATURE = '--\n{{user_name}} · {{user_title}}, {{company}}\n{{company_website}}'

const inputCls  = 'w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]'
const labelCls  = 'text-xs font-bold text-[#6b5e4e]'
const cardCls   = 'bg-white border border-[#e8e3dc] rounded-xl p-5 flex flex-col'
const sectionHd = 'text-xs font-bold text-[#8a7e6e] uppercase tracking-wider'

function QualityBadge({ pct }: { pct: string }) {
  return <span className="text-xs text-[#8a7e6e] bg-[#f0ece6] px-1.5 py-0.5 rounded-full whitespace-nowrap">{pct}</span>
}

function FieldOk({ show }: { show: boolean }) {
  const t = useTranslations('dashboard.settings.common')
  if (!show) return null
  return <p className="text-xs mt-1 text-green-600">{t('ok')}</p>
}

function SaveButton({ section, saving, saved, onSave, missing = [], dirty }: {
  section:  string
  saving:   string | null
  saved:    string | null
  onSave:   () => void
  missing?: string[]
  dirty?:   boolean
}) {
  const t = useTranslations('dashboard.settings.common')
  const isSaving   = saving === section
  const hasMissing = missing.length > 0
  const isClean    = dirty === false

  const isDisabled = isSaving || isClean || hasMissing

  const btn = (
    <button
      type="button"
      onClick={!isDisabled ? onSave : undefined}
      disabled={isSaving}
      className={`bg-[#3b6bef] text-white px-4 py-2 rounded-lg text-sm font-medium transition-opacity
        ${hasMissing ? 'opacity-50 cursor-not-allowed' : isClean ? 'opacity-40 cursor-default' : 'disabled:opacity-40'}`}>
      {saved === section ? t('saved') : isSaving ? t('saving') : t('save')}
    </button>
  )

  return (
    <div className="flex justify-end pt-3 mt-auto">
      {hasMissing
        ? <Tooltip content={t('requiredFields', { fields: missing.join(', ') })}>{btn}</Tooltip>
        : btn}
    </div>
  )
}

function previewSignature(
  template: string,
  name: string, userTitle: string, companyName: string, companyWebsite: string,
): string {
  return renderSignature(template, { user_name: name, user_title: userTitle, company: companyName, company_website: companyWebsite })
}

const SNAP_DEFAULTS = {
  name:                   '',
  user_title:             '',
  company_name:           '',
  sender_name:            '',
  company_website:        '',
  timezone:               'America/Toronto',
  user_industry:          '',
  user_company_size:      '',
  product_description:    '',
  value_proposition:      '',
  email_signature:        DEFAULT_SIGNATURE,
  signature_in_initial:   true  as boolean,
  signature_in_followups: false as boolean,
}

export default function SettingsPage() {
  const t = useTranslations('dashboard.settings')
  const tCommon = useTranslations('dashboard.settings.common')
  const locale = useLocale()
  // Session + workspace_members are owned by WorkspaceProvider.
  const { user, workspace } = useWorkspace()
  const workspaceId = workspace?.workspace_id ?? null
  const [campaignCount, setCampaignCount] = useState(0)
  const [emailCount,    setEmailCount]    = useState(0)
  const [savingSection, setSavingSection] = useState<string|null>(null)
  const [savedSection,  setSavedSection]  = useState<string|null>(null)
  const [profileLoaded, setProfileLoaded] = useState(false)
  const [touched,       setTouched]       = useState<Set<string>>(new Set())
  const [toast,         setToast]         = useState<{ type: 'error' | 'info'; msg: string; link?: string; linkLabel?: string; persistent?: boolean } | null>(null)
  const [snapshot,      setSnapshot]      = useState(SNAP_DEFAULTS)
  const [changePasswordOpen, setChangePasswordOpen] = useState(false)
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadNonce, setLoadNonce] = useState(0)
  const pathname = usePathname()
  useEffect(() => { setToast(t => t?.persistent ? null : t) }, [pathname])

  const [form, setForm] = useState({
    // Account
    name:                    '',
    user_title:              '',
    // Company
    company_name:            '',
    sender_name:             '',
    company_website:         '',
    timezone:                'America/Toronto',
    user_industry:           '',
    user_company_size:       '',
    // Product
    product_description:     '',
    value_proposition:       '',
    // ICP + Tone: loaded from DB for badge scoring; managed from Prospects page
    tone:                    'professional',
    icp_description:         '',
    icp_industries:          [] as string[],
    icp_company_sizes:       [] as string[],
    pain_points:             '',
    target_titles:           '',
    target_regions:          '',
    company_revenue:         [] as string[],
    // Email Signature
    email_signature:         DEFAULT_SIGNATURE,
    signature_in_initial:    true,
    signature_in_followups:  false,
  })

  function isDirtyAccount()   { return form.name !== snapshot.name || form.user_title !== snapshot.user_title }
  function isDirtyCompany()   { return form.company_name !== snapshot.company_name || form.sender_name !== snapshot.sender_name || form.timezone !== snapshot.timezone }
  function isDirtySignature() { return form.email_signature !== snapshot.email_signature || form.signature_in_initial !== snapshot.signature_in_initial || form.signature_in_followups !== snapshot.signature_in_followups }

  function touch(field: string) {
    setTouched(prev => { const n = new Set(prev); n.add(field); return n })
  }

  function inputBorder(field: string, value: string) {
    if (touched.has(field) && !value.trim()) return `${inputCls} border-red-300 focus:border-red-400`
    return inputCls
  }

  // Profile + campaign counts. Session + workspace_members are now loaded
  // by WorkspaceProvider (lib/hooks/useWorkspace); this effect runs once the
  // provider hands us a workspaceId. Retry loops for session + member were
  // preserved verbatim inside the provider (see commit 0c858050 fix for
  // fresh signup skeleton), so this call-site can assume workspaceId is
  // valid the moment it fires.
  useEffect(() => {
    if (!user || !workspaceId) return
    let cancelled = false

    async function load() {
      setLoadError(null)

      // Profile + counts — non-fatal: an empty profile still renders (default form).
      try {
        const [{ data: p }, { count: cc }, { data: camps }] = await Promise.all([
          supabase.from('workspace_profiles').select('*').eq('workspace_id', workspaceId).maybeSingle(),
          supabase.from('campaigns').select('*', { count: 'exact', head: true }).eq('workspace_id', workspaceId),
          supabase.from('campaigns').select('sent_count').eq('workspace_id', workspaceId),
        ])
        if (cancelled) return
        setCampaignCount(cc || 0)
        setEmailCount(camps?.reduce((a, c) => a + (c.sent_count || 0), 0) || 0)

        if (p) {
          const loaded = {
            name:                   user!.user_metadata?.full_name || '',
            user_title:             p.user_title              || '',
            company_name:           p.company_name            || '',
            sender_name:            p.sender_name             || '',
            company_website:        p.company_website         || '',
            timezone:               (p.booking_config as any)?.timezone || 'America/Toronto',
            user_industry:          p.user_industry           || '',
            user_company_size:      p.user_company_size       || '',
            product_description:    p.product_description     || '',
            value_proposition:      p.value_proposition       || '',
            tone:                   p.tone                    || 'professional',
            icp_description:        p.icp_description         || '',
            icp_industries:         p.icp_industries          ?? [],
            icp_company_sizes:      p.icp_company_sizes       ?? (p.icp_company_size ? [p.icp_company_size] : []),
            pain_points:            p.pain_points             || '',
            target_titles:          p.target_titles           || '',
            target_regions:         p.target_regions          || '',
            company_revenue:        p.target_company_revenue  ?? [],
            email_signature:        p.email_signature         ?? DEFAULT_SIGNATURE,
            signature_in_initial:   p.signature_in_initial    ?? true,
            signature_in_followups: p.signature_in_followups  ?? false,
          }
          setForm(loaded)
          setSnapshot({
            name:                   loaded.name,
            user_title:             loaded.user_title,
            company_name:           loaded.company_name,
            sender_name:            loaded.sender_name,
            company_website:        loaded.company_website,
            timezone:               loaded.timezone,
            user_industry:          loaded.user_industry,
            user_company_size:      loaded.user_company_size,
            product_description:    loaded.product_description,
            value_proposition:      loaded.value_proposition,
            email_signature:        loaded.email_signature,
            signature_in_initial:   loaded.signature_in_initial,
            signature_in_followups: loaded.signature_in_followups,
          })
        } else {
          // profile row missing — seed name from auth metadata so the form
          // isn't literally empty on first render. Save creates the row.
          setForm(f => ({ ...f, name: user!.user_metadata?.full_name || '' }))
        }
        setProfileLoaded(true)
      } catch (err) {
        if (cancelled) return
        setLoadError(err instanceof Error ? err.message : 'unknown')
      }
    }

    load()
    return () => { cancelled = true }
  }, [user, workspaceId, loadNonce])

  async function saveAccount() {
    setSavingSection('account')
    const ops: Promise<any>[] = [
      supabase.auth.updateUser({ data: { full_name: form.name } }),
    ]
    if (workspaceId) {
      ops.push(fetch('/api/workspace/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: workspaceId, user_title: form.user_title, user_name: form.name }),
      }))
    }
    await Promise.all(ops)
    setSnapshot(s => ({ ...s, name: form.name, user_title: form.user_title }))
    setSavingSection(null)
    setSavedSection('account')
    setTimeout(() => setSavedSection(null), 2000)
  }

  async function saveSection(section: string, fields: Record<string, unknown>, onSuccess?: () => void) {
    setSavingSection(section)
    const res = await fetch('/api/workspace/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace_id: workspaceId, ...fields }),
    })
    setSavingSection(null)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setToast({ type: 'error', msg: data.error || tCommon('failedToSave') })
      setTimeout(() => setToast(null), 4000)
      return
    }
    setSavedSection(section)
    setTimeout(() => setSavedSection(null), 2000)
    onSuccess?.()
    if (section === 'signature') {
      setToast({ type: 'info', msg: t('toasts.signatureSaved') })
      setTimeout(() => setToast(null), 7000)
    }
  }

  async function saveCompany() {
    if (!form.company_name.trim()) return
    setSavingSection('company')
    const res = await fetch('/api/workspace/profile', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        workspace_id:       workspaceId,
        company_name:       form.company_name,
        sender_name:        form.sender_name,
        workspace_timezone: form.timezone,
      }),
    })
    setSavingSection(null)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setToast({ type: 'error', msg: data.error || tCommon('failedToSave') })
      setTimeout(() => setToast(null), 4000)
      return
    }
    setSnapshot(s => ({
      ...s,
      company_name: form.company_name,
      sender_name:  form.sender_name,
      timezone:     form.timezone,
    }))
    setSavedSection('company')
    setTimeout(() => setSavedSection(null), 2000)
  }

  const ws = (workspace?.workspaces as any)

  const sigPreview = previewSignature(
    form.email_signature,
    form.name, form.user_title, form.company_name, form.company_website,
  )

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-12">

      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 ${toast.type === 'error' ? 'bg-red-600' : 'bg-[#3b6bef]'} text-white px-5 py-3 rounded-xl shadow-xl text-sm font-medium flex items-start gap-3 max-w-sm`}>
          <span className="shrink-0 mt-0.5">{toast.type === 'error' ? '⚠' : 'ℹ'}</span>
          <div className="flex-1 min-w-0">
            <p>{toast.msg}</p>
            {toast.link && (
              <a href={toast.link} onClick={() => setToast(null)} className="underline opacity-90 hover:opacity-100 text-white mt-1 block">
                {toast.linkLabel ?? toast.link}
              </a>
            )}
          </div>
          <button type="button" aria-label={t('toasts.closeAriaLabel')} onClick={() => setToast(null)} className="opacity-70 hover:opacity-100 text-base leading-none shrink-0"><span aria-hidden="true">✕</span></button>
        </div>
      )}

      {/* Header */}
      <div className="mb-6">
        <div className="text-xs text-[#8a7e6e] mb-1">
          <Link href="/dashboard" className="hover:text-[#1a1a2e]">{t('header.breadcrumbDashboard')}</Link> / {t('header.breadcrumbCurrent')}
        </div>
        <h1 className="text-2xl font-bold text-[#1a1a2e]">{t('header.title')}</h1>
        <p className="text-sm text-[#8a7e6e]">{t('header.subtitle')}</p>
      </div>

      {/* Load error — terminal state with retry, never a silent skeleton */}
      {loadError && !profileLoaded && (
        <div className="bg-white border border-[#e8e3dc] rounded-xl p-6 text-center max-w-md mx-auto">
          <p className="text-sm text-[#4a4a5a] mb-4">{t('load.error')}</p>
          <button
            type="button"
            onClick={() => setLoadNonce(n => n + 1)}
            className="bg-[#3b6bef] text-white px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90"
          >
            {t('load.retry')}
          </button>
        </div>
      )}

      {/* Loading skeleton */}
      {!profileLoaded && !loadError && (
        <div className="flex flex-col gap-6 animate-pulse">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-[#f5f2ee] rounded-xl h-56" />
            <div className="bg-[#f5f2ee] rounded-xl h-56" />
          </div>
          <div className="bg-[#f5f2ee] rounded-xl h-72" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-[#f5f2ee] rounded-xl h-96" />
            <div className="bg-[#f5f2ee] rounded-xl h-64" />
          </div>
        </div>
      )}

      {profileLoaded && <>

      {/* Row 1: Account + Plan */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-6 items-stretch">

        {/* ACCOUNT */}
        <div className={cardCls}>
          <div className={`${sectionHd} mb-4`}>{t('account.sectionTitle')}</div>
          <div className="flex flex-col gap-3 flex-1">
            <div className="flex items-center justify-between pb-3 border-b border-[#f0ece6]">
              <span className="text-sm text-[#6b5e4e] truncate">{user?.email}</span>
              <span className="text-xs bg-[#f0ece6] text-[#8a7e6e] px-2 py-1 rounded ml-2">{t('account.emailBadge')}</span>
            </div>
            <div>
              <label className={`${labelCls} mb-1 block`} htmlFor="set-your-name">
                {t('account.yourName')} <span className="text-red-500">*</span>
              </label>
              <input
                id="set-your-name"
                value={form.name}
                onChange={e => setForm({...form, name: e.target.value})}
                onBlur={() => touch('name')}
                className={inputBorder('name', form.name)}
                placeholder={t('account.yourNamePlaceholder')}
              />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <label className={labelCls} htmlFor="set-your-title">{t('account.yourTitle')}</label>
                <span className="text-xs text-[#b0a898] bg-[#f5f2ee] px-1.5 py-0.5 rounded-full">{tCommon('optional')}</span>
                <StatusBadge variant="gray">{tCommon('usedInSignature')}</StatusBadge>
              </div>
              <input
                id="set-your-title"
                value={form.user_title}
                onChange={e => setForm({...form, user_title: e.target.value})}
                className={inputCls}
                placeholder={t('account.yourTitlePlaceholder')}
              />
              <p className="text-xs text-[#8a7e6e] mt-1">{t('account.yourTitleHint')}</p>
            </div>
          </div>
          <SaveButton
            section="account"
            saving={savingSection}
            saved={savedSection}
            onSave={saveAccount}
            missing={form.name.trim() ? [] : [t('account.yourName')]}
            dirty={isDirtyAccount()}
          />
        </div>

        {/* PLAN */}
        <div className={cardCls}>
          <div className={`${sectionHd} mb-4`}>{t('plan.sectionTitle')}</div>
          <div className="bg-[#eef1fd] border border-[#dde6fd] rounded-xl p-4 mb-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium text-[#3b6bef]">
                  {tCommon('planTier', { tier: ws?.plan_tier ?? 'starter' })}
                  {t('plan.trialSuffix', { status: ws?.subscription_status ?? 'other' })}
                </div>
                <div className="text-xs text-[#6b5e4e]">{t('plan.freeTrialNote')}</div>
              </div>
              <Link href="/dashboard/billing" className="bg-[#3b6bef] text-white text-xs px-3 py-1.5 rounded-lg font-medium">{t('plan.upgradeCta')}</Link>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-center">
            <div className="border border-[#e8e3dc] rounded-xl p-3">
              <div className="text-xl font-bold text-[#1a1a2e]">{campaignCount}</div>
              <div className="text-xs text-[#8a7e6e] mt-1">{t('plan.campaignsLabel')}</div>
            </div>
            <div className="border border-[#e8e3dc] rounded-xl p-3">
              <div className="text-xl font-bold text-[#1a1a2e]">{emailCount}</div>
              <div className="text-xs text-[#8a7e6e] mt-1">{t('plan.emailsSentLabel')}</div>
            </div>
            <div className="border border-[#e8e3dc] rounded-xl p-3">
              <div className="text-xl font-bold text-[#1a1a2e]">{new Date(user?.created_at || '').toLocaleDateString(locale === 'fr' ? 'fr-FR' : 'en-US', { month: 'short', year: 'numeric' })}</div>
              <div className="text-xs text-[#8a7e6e] mt-1">{t('plan.memberSinceLabel')}</div>
            </div>
          </div>
        </div>
      </div>

      {/* EMAIL SIGNATURE: full width, between Account+Plan and Company+Product */}
      <div className={`${cardCls} mt-6`}>
        <div className={`${sectionHd} mb-1`}>{t('signature.sectionTitle')}</div>
        <p className="text-xs text-[#8a7e6e] mb-4">
          {t('signature.description')}
        </p>

        <textarea
          value={form.email_signature}
          onChange={e => setForm({...form, email_signature: e.target.value})}
          rows={5}
          maxLength={1000}
          className={`${inputCls} font-mono resize-none`}
          placeholder={DEFAULT_SIGNATURE}
        />
        <div className="flex justify-end mt-1.5">
          <span className="text-xs text-[#b0a898]">{t('signature.counter', { count: form.email_signature.length })}</span>
        </div>

        {/* Live preview */}
        <div className="mt-4">
          <div className={`${sectionHd} mb-2`}>{t('signature.previewTitle')}</div>
          <div className="bg-[#f9f7f4] border border-[#e8e3dc] rounded-lg px-4 py-3 text-sm font-mono whitespace-pre-wrap text-[#4a3f35] leading-relaxed min-h-[3.5rem]">
            {sigPreview || <span className="text-[#c0b8b0] italic">{t('signature.emptyPreview')}</span>}
          </div>
        </div>

        {/* Toggles */}
        <div className="mt-4 flex flex-col gap-2.5">
          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={form.signature_in_initial}
              onChange={e => setForm({...form, signature_in_initial: e.target.checked})}
              className="w-4 h-4 accent-[#3b6bef]"
            />
            <span className="text-sm text-[#1a1a2e]">{t('signature.includeInInitial')}</span>
          </label>
          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={form.signature_in_followups}
              onChange={e => setForm({...form, signature_in_followups: e.target.checked})}
              className="w-4 h-4 accent-[#3b6bef]"
            />
            <span className="text-sm text-[#1a1a2e]">{t('signature.includeInFollowups')}</span>
            <span className="text-xs text-[#b0a898]">{t('signature.followupsHint')}</span>
          </label>
        </div>

        <SaveButton
          section="signature"
          saving={savingSection}
          saved={savedSection}
          onSave={() => saveSection('signature', {
            email_signature:        form.email_signature,
            signature_in_initial:   form.signature_in_initial,
            signature_in_followups: form.signature_in_followups,
          }, () => setSnapshot(s => ({ ...s, email_signature: form.email_signature, signature_in_initial: form.signature_in_initial, signature_in_followups: form.signature_in_followups })))}
          dirty={isDirtySignature()}
        />
      </div>

      {/* Row 2: Company + Product */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6 items-stretch">

        {/* COMPANY */}
        <div className={cardCls}>
          <div className={`${sectionHd} mb-4`}>{t('company.sectionTitle')}</div>
          <div className="flex flex-col gap-3 flex-1">
            <div>
              <label className={`${labelCls} mb-1 block`} htmlFor="set-company-name">{t('company.companyName')} <span className="text-red-500">*</span></label>
              <input
                id="set-company-name"
                value={form.company_name}
                onChange={e => setForm({...form, company_name: e.target.value})}
                onBlur={() => touch('company_name')}
                className={inputBorder('company_name', form.company_name)}
              />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <label className={labelCls} htmlFor="set-display-name">{t('company.displayName')}</label>
                <span className="text-xs text-[#b0a898] bg-[#f5f2ee] px-1.5 py-0.5 rounded-full">{tCommon('optional')}</span>
                <Tooltip content={t('company.displayNameTooltip')}>
                  <svg className="w-4 h-4 text-gray-400 hover:text-gray-600 cursor-help" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </Tooltip>
              </div>
              <input id="set-display-name" value={form.sender_name} onChange={e => setForm({...form, sender_name: e.target.value})}
                className={inputCls} placeholder={t('company.displayNamePlaceholder')} />
            </div>
            <div>
              <label className={`${labelCls} mb-1 block`} htmlFor="set-workspace-timezone">{t('company.workspaceTimezone')}</label>
              <select id="set-workspace-timezone" value={form.timezone} onChange={e => setForm({...form, timezone: e.target.value})}
                className={`${inputCls} bg-white`}>
                {WORKSPACE_TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
              </select>
              <p className="text-xs text-[#b0a898] mt-1">{t('company.timezoneHint')}</p>
            </div>
          </div>
          <SaveButton
            section="company"
            saving={savingSection}
            saved={savedSection}
            missing={form.company_name.trim() ? [] : [t('company.companyName')]}
            onSave={saveCompany}
            dirty={isDirtyCompany()}
          />
        </div>

        {/* Offer + ICP live at /dashboard/profile now — the previous PRODUCT card
            (with company_website + parse + product_description + value_proposition)
            was moved there so that the parse writes ICP columns and the user
            sees every field update on the same page. */}
        <div className={`${cardCls} bg-[#f7f8ff] border-[#dde6fd]`}>
          <div className="flex items-center gap-1.5 mb-2">
            <span className={sectionHd}>{t('profileLink.sectionTitle')}</span>
            <StatusBadge variant="blueprint">{t('profileLink.badge')}</StatusBadge>
          </div>
          <p className="text-sm text-[#4a4a5a] mb-4 flex-1">{t('profileLink.description')}</p>
          <Link
            href="/dashboard/profile"
            className="inline-flex items-center gap-1 self-start bg-[#3b6bef] hover:bg-[#2a5bdf] text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            {t('profileLink.cta')} →
          </Link>
        </div>
      </div>

      {/* PROSPECT RESEARCH: full width */}
      <div className={`${cardCls} mt-6`}>
        <div className={`${sectionHd} mb-1`}>{t('prospectResearch.sectionTitle')}</div>
        <p className="text-xs text-[#8a7e6e] mb-3">{t('prospectResearch.subtitle')}</p>
        <div className="border border-[#e8e3dc] rounded-xl p-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-8 h-8 bg-[#3b6bef] rounded-lg flex items-center justify-center text-white text-sm">🔍</div>
            <div>
              <div className="text-sm font-medium text-[#1a1a2e]">{t('prospectResearch.creditsLabel')}</div>
              <div className="text-xs text-[#8a7e6e]">
                {t('prospectResearch.creditsPerMonth', { count: ({ starter: 200, pro: 500, power: 750 } as Record<string, number>)[ws?.plan_tier ?? ''] ?? 200 })}
              </div>
            </div>
          </div>
          <div className="text-xs text-[#8a7e6e]">
            {t('prospectResearch.planLinePrefix', { tier: tCommon('planTier', { tier: ws?.plan_tier ?? 'starter' }) })}<Link href="/dashboard/billing" className="text-[#3b6bef] hover:underline">{t('prospectResearch.viewUsageCta')}</Link>
          </div>
        </div>
      </div>

      {/* SENDING DOMAINS: full width */}
      <div className={`${cardCls} mt-6`}>
        <header className="flex items-center gap-2 mb-2">
          <span className="text-xl" aria-hidden>📬</span>
          <h2 className="text-xs font-bold uppercase tracking-wider text-[#8a7e6e]">{t('sendingDomains.sectionTitle')}</h2>
          <Tooltip content={t('sendingDomains.tooltip')} placement="top">
            <svg className="w-3.5 h-3.5 text-[#8a7e6e] cursor-help" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </Tooltip>
        </header>
        <p className="text-sm text-[#4a4a5a] mb-4">{t('sendingDomains.description')}</p>
        <Link
          href="/dashboard/settings/sending-domains"
          className="inline-flex items-center gap-1 text-xs border border-[#e8e3dc] px-3 py-1.5 rounded-lg text-[#6b5e4e] hover:bg-[#f5f2ee] transition-colors"
        >
          {t('sendingDomains.configureCta')}
        </Link>
      </div>

      {/* NOTIFICATIONS: full width */}
      <NotificationPreferencesSection />

      {/* ADVANCED SETTINGS: full width */}
      <div className={`${cardCls} mt-6`}>
        <div className={`${sectionHd} mb-4`}>{t('advanced.sectionTitle')}</div>
        {[
          { title: t('advanced.apiKeysTitle'),          desc: t('advanced.apiKeysDesc') },
          { title: t('advanced.mailboxRotationTitle'),  desc: t('advanced.mailboxRotationDesc') },
          { title: t('advanced.gdprTitle'),             desc: t('advanced.gdprDesc') },
          { title: t('advanced.dataExportTitle'),       desc: t('advanced.dataExportDesc') },
        ].map(item => (
          <div key={item.title} className="flex items-center justify-between py-3 border-b border-[#f0ece6] last:border-0">
            <div>
              <div className="text-sm font-medium text-[#1a1a2e]">{item.title}</div>
              <div className="text-xs text-[#8a7e6e]">{item.desc}</div>
            </div>
            <StatusBadge variant="orange">{tCommon('comingSoon')}</StatusBadge>
          </div>
        ))}
      </div>

      {/* DANGER ZONE: full width */}
      <div className="bg-white border-2 border-red-100 rounded-xl p-5 mt-6">
        <div className="text-xs font-bold text-red-500 uppercase tracking-wider mb-4">{t('danger.sectionTitle')}</div>
        <div className="flex items-center justify-between py-2 border-b border-[#f0ece6]">
          <div>
            <div className="text-sm font-medium text-[#1a1a2e]">{t('danger.changePassword')}</div>
            <div className="text-xs text-[#8a7e6e]">{t('danger.changePasswordDesc')}</div>
          </div>
          <button
            type="button"
            onClick={() => setChangePasswordOpen(true)}
            className="text-sm border border-[#e8e3dc] px-3 py-1.5 rounded-lg text-[#6b5e4e] hover:bg-[#f5f2ee] transition-colors"
          >
            {t('danger.changePassword')}
          </button>
        </div>
        <div className="flex items-center justify-between py-2 mt-2">
          <div>
            <div className="text-sm font-medium text-red-600">{t('danger.deleteAccount')}</div>
            <div className="text-xs text-[#8a7e6e]">{t('danger.deleteAccountDesc')}</div>
          </div>
          <button
            type="button"
            onClick={() => setDeleteAccountOpen(true)}
            className="text-sm border border-red-200 text-red-500 px-3 py-1.5 rounded-lg hover:bg-red-50 transition-colors"
          >
            {t('danger.deleteAccount')}
          </button>
        </div>
      </div>

      </>}

      <ChangePasswordModal isOpen={changePasswordOpen} onClose={() => setChangePasswordOpen(false)} />
      <DeleteAccountModal isOpen={deleteAccountOpen} onClose={() => setDeleteAccountOpen(false)} email={user?.email} />

    </div>
  )
}
