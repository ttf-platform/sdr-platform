'use client'

import { useEffect, useState } from 'react'
import { NextIntlClientProvider, useTranslations } from 'next-intl'
import { readDashboardLocaleSync, DEFAULT_DASHBOARD_LOCALE, type DashboardLocale } from '@/lib/locale'
import enMessages from '../../../messages/en.json'
import frMessages from '../../../messages/fr.json'

type CheckStatus = 'ok' | 'degraded' | 'down'
type CheckResult = { status: CheckStatus; latency_ms?: number; error?: string }
type HealthResponse = {
  status: CheckStatus
  timestamp: string
  checks: Record<string, CheckResult>
}

const REFRESH_INTERVAL_MS = 30_000

const MESSAGES_BY_LOCALE: Record<DashboardLocale, typeof enMessages> = {
  en: enMessages,
  fr: frMessages,
}

const STATUS_STYLES: Record<CheckStatus, { color: string; bg: string; border: string; emoji: string }> = {
  ok:       { color: 'text-green-700', bg: 'bg-green-50', border: 'border-green-200', emoji: '🟢' },
  degraded: { color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200', emoji: '🟡' },
  down:     { color: 'text-red-700',   bg: 'bg-red-50',   border: 'border-red-200',   emoji: '🔴' },
}

function StatusContent() {
  const t = useTranslations('status')
  const [data, setData] = useState<HealthResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  // Internal keys (database/stripe/anthropic/resend) come from /api/health and
  // must stay unchanged. Only the user-facing labels are generic — vendor
  // invisibility (see CLAUDE.md §Branding).
  function serviceLabel(service: string): string {
    switch (service) {
      case 'database':  return t('serviceDatabase')
      case 'stripe':    return t('servicePayments')
      case 'anthropic': return t('serviceAI')
      case 'resend':    return t('serviceEmail')
      default:          return service
    }
  }

  function statusLabel(s: CheckStatus): string {
    switch (s) {
      case 'ok':       return t('statusOk')
      case 'degraded': return t('statusDegraded')
      case 'down':     return t('statusDown')
    }
  }

  async function fetchHealth() {
    try {
      const res = await fetch('/api/health', { cache: 'no-store' })
      const json = await res.json()
      setData(json)
      setError(null)
      setLastRefresh(new Date())
    } catch (e) {
      setError(e instanceof Error ? e.message : t('errorLoad'))
    }
  }

  useEffect(() => {
    fetchHealth()
    const interval = setInterval(fetchHealth, REFRESH_INTERVAL_MS)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-[#1a1a2e] mb-2">{t('pageHeading')}</h1>
        <p className="text-sm text-[#8a7e6e]">{t('pageDescription')}</p>
      </header>

      {error && !data && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">{t('errorUnable')}</div>
      )}

      {!data && !error && (
        <div className="text-sm text-[#8a7e6e]">{t('loading')}</div>
      )}

      {data && (() => {
        const overall = STATUS_STYLES[data.status]
        return (
          <div className="flex flex-col gap-4">
            <div className={`${overall.bg} ${overall.border} border rounded-2xl p-6`}>
              <div className="flex items-center gap-3 mb-1">
                <span className="text-2xl">{overall.emoji}</span>
                <h2 className={`text-xl font-bold ${overall.color}`}>{statusLabel(data.status)}</h2>
              </div>
              <p className="text-xs text-[#8a7e6e]">{t('lastChecked', { timestamp: new Date(data.timestamp).toLocaleString() })}</p>
            </div>

            <div className="bg-white border border-[#e8e3dc] rounded-xl divide-y divide-[#e8e3dc]">
              {Object.entries(data.checks).map(([service, check]) => {
                const conf = STATUS_STYLES[check.status]
                return (
                  <div key={service} className="flex items-center justify-between px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className="text-lg">{conf.emoji}</span>
                      <div>
                        <p className="text-sm font-medium text-[#1a1a2e]">{serviceLabel(service)}</p>
                        {check.error && <p className="text-xs text-red-600">{check.error}</p>}
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={`text-xs font-medium ${conf.color}`}>{check.status.toUpperCase()}</p>
                      {check.latency_ms != null && <p className="text-xs text-[#8a7e6e]">{check.latency_ms}ms</p>}
                    </div>
                  </div>
                )
              })}
            </div>

            <p className="text-xs text-[#8a7e6e] text-center">
              {t.rich('contactLine', {
                link: (chunks) => (
                  <a href="mailto:hello@mirvo.ai" className="text-[#3b6bef] hover:underline">{chunks}</a>
                ),
              })}
            </p>
            {lastRefresh && (
              <p className="text-xs text-[#8a7e6e] text-center">
                {t('refreshedAt', { time: lastRefresh.toLocaleTimeString() })}
              </p>
            )}
          </div>
        )
      })()}
    </>
  )
}

export function StatusClient() {
  const [locale, setLocale] = useState<DashboardLocale>(DEFAULT_DASHBOARD_LOCALE)

  useEffect(() => {
    const cookieLocale = readDashboardLocaleSync()
    if (cookieLocale !== DEFAULT_DASHBOARD_LOCALE) setLocale(cookieLocale)
  }, [])

  return (
    <NextIntlClientProvider locale={locale} messages={MESSAGES_BY_LOCALE[locale]}>
      <StatusContent />
    </NextIntlClientProvider>
  )
}
