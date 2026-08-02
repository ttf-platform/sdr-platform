'use client'
import { use, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'

// L9 — Page publique de desinscription. Sur le patron de
// app/[locale]/book/confirm/[token]/page.tsx :
//
//   1. AUCUNE auto-mutation au mount. Un GET vers /api/unsubscribe/*
//      redirige seulement (302), donc la page ne fait aucun POST tant que
//      l'utilisateur n'a pas clique sur le bouton. Les scanners d'URL
//      (Gmail, Outlook, antivirus d'entreprise) qui rendent la page ne
//      desabonnent PAS a l'insu de l'utilisateur.
//
//   2. STRIPE du jeton dans l'URL des le premier render. PostHog capture
//      les segments de chemin (capture_pageview: true dans app/providers.tsx).
//      history.replaceState remet /{locale}/unsubscribe/redacted/{kind}
//      immediatement — le jeton survit dans un ref pour le POST au clic.

type Kind = 'brief' | 'lifecycle'

export default function UnsubscribePage({
  params,
}: { params: Promise<{ token: string; kind: string }> }) {
  const { token: rawToken, kind: rawKind } = use(params)
  const t = useTranslations('unsubscribe')

  const kind: Kind | null = rawKind === 'brief' || rawKind === 'lifecycle' ? rawKind : null

  const [state, setState] = useState<
    | { status: 'ready' }
    | { status: 'submitting' }
    | { status: 'done' }
    | { status: 'error' }
  >({ status: 'ready' })

  useEffect(() => {
    // Strippe le jeton de l'URL immediatement — le composant garde `rawToken`
    // en local pour le POST au clic. Le fallback try/catch protege les
    // moteurs de rendu ou history.replaceState jetterait.
    if (typeof window !== 'undefined') {
      try { window.history.replaceState(null, '', window.location.pathname.replace(rawToken, 'redacted')) } catch { /* ignore */ }
    }
  }, [rawToken])

  async function onUnsubscribeClick() {
    if (!kind) return
    setState({ status: 'submitting' })
    try {
      const r = await fetch(`/api/unsubscribe/${rawToken}/${kind}`, { method: 'POST' })
      if (r.ok) setState({ status: 'done' })
      else     setState({ status: 'error' })
    } catch {
      setState({ status: 'error' })
    }
  }

  return (
    <div className="min-h-screen bg-[#f5f2ee] py-12 px-4">
      <div className="max-w-md mx-auto">
        <div className="bg-white border border-[#e8e3dc] rounded-xl p-6">
          {kind === null && (
            <div className="text-center py-4">
              <h1 className="text-lg font-semibold text-[#1a1a2e] mb-2">{t('badLinkTitle')}</h1>
              <p className="text-sm text-[#8a7e6e]">{t('badLinkBody')}</p>
            </div>
          )}
          {kind !== null && state.status === 'ready' && (
            <div className="text-center py-4">
              <h1 className="text-lg font-semibold text-[#1a1a2e] mb-2">
                {kind === 'brief' ? t('briefTitle') : t('lifecycleTitle')}
              </h1>
              <p className="text-sm text-[#8a7e6e] mb-6">
                {kind === 'brief' ? t('briefBody') : t('lifecycleBody')}
              </p>
              <button
                type="button"
                onClick={onUnsubscribeClick}
                className="bg-[#3b6bef] text-white text-sm font-semibold px-4 py-2 rounded-lg"
              >
                {t('confirmButton')}
              </button>
            </div>
          )}
          {state.status === 'submitting' && (
            <div className="text-center py-8">
              <div className="w-8 h-8 border-2 border-[#3b6bef] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-sm text-[#8a7e6e]">{t('submitting')}</p>
            </div>
          )}
          {state.status === 'done' && (
            <div className="text-center py-4">
              <h1 className="text-lg font-semibold text-[#1a1a2e] mb-2">{t('doneTitle')}</h1>
              <p className="text-sm text-[#8a7e6e]">{t('doneBody')}</p>
            </div>
          )}
          {state.status === 'error' && (
            <div className="text-center py-4">
              <h1 className="text-lg font-semibold text-[#1a1a2e] mb-2">{t('errorTitle')}</h1>
              <p className="text-sm text-[#8a7e6e] mb-4">{t('errorBody')}</p>
              <button
                type="button"
                onClick={() => setState({ status: 'ready' })}
                className="bg-[#3b6bef] text-white text-sm font-semibold px-4 py-2 rounded-lg"
              >
                {t('retry')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
