/**
 * app/(dashboard)/dashboard/settings/calendar/page.tsx
 *
 * LC21 (1) — panneau Google Calendar.
 *
 * Trois etats seulement (non_connecte | connecte | permissions_a_completer),
 * un bouton Connecter, un bouton Deconnecter, lecture de ?status pour le
 * message post-OAuth, et la mention permanente demandee par le brief. Aucune
 * synchronisation n'est activee dans ce lot.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

type ConnectionState = {
  status:        'non_connecte' | 'connecte' | 'permissions_a_completer';
  account_email: string;
  connected_at:  string | null;
  updated_at:    string | null;
};

const STATUS_KEYS = new Set([
  'connecte',
  'refus_google',
  'etat_invalide',
  'identite_invalide',
  'jeton_absent',
  'compte_different',
  'retire',
  'retire_local_seulement',
  'aucun_raccordement',
  'borne_espace',
]);

const cardCls   = 'bg-white border border-[#e8e3dc] rounded-xl p-5 flex flex-col gap-4';
const sectionHd = 'text-xs font-bold text-[#8a7e6e] uppercase tracking-wider';

export default function CalendarSettingsPage() {
  const t       = useTranslations('dashboard.settings.googleCalendar.page');
  const tStatus = useTranslations('dashboard.settings.googleCalendar.page.status');
  const params  = useSearchParams();
  const status  = params?.get('status') ?? null;

  const [state,   setState]   = useState<ConnectionState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy,    setBusy]    = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch('/api/calendar/google/connection', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? t('loadError'));
      } else {
        setState(data as ConnectionState);
      }
    } catch {
      setError(t('loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  async function connect() {
    setBusy(true);
    try {
      const res  = await fetch('/api/calendar/google/init', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.url) {
        const reason = typeof data?.reason === 'string' && STATUS_KEYS.has(data.reason) ? data.reason : null;
        setError(reason ? tStatus(reason) : t('connectError'));
        setBusy(false);
        return;
      }
      window.location.assign(data.url as string);
    } catch {
      setError(t('connectError'));
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      await fetch('/api/calendar/google/connection', { method: 'DELETE' });
      await load();
    } catch {
      setError(t('disconnectError'));
    } finally {
      setBusy(false);
    }
  }

  const statusMsg = status && STATUS_KEYS.has(status) ? tStatus(status) : null;

  return (
    <div className="min-h-screen bg-[#f5f2ee]">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-6">
          <Link
            href="/dashboard/settings"
            className="mb-3 inline-flex items-center gap-1 text-xs text-[#4a4a5a] hover:text-[#1a1a1a]"
          >
            {t('back')}
          </Link>
          <h1 className="text-2xl font-bold text-[#1a1a2e]">{t('title')}</h1>
          <p className="text-sm text-[#8a7e6e]">{t('subtitle')}</p>
        </header>

        {statusMsg && (
          <div
            role="status"
            className="mb-4 rounded-xl border border-[#dde6fd] bg-[#eef1fd] px-4 py-3 text-sm text-[#1a1a2e]"
          >
            {statusMsg}
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {error}
          </div>
        )}

        <section className={cardCls}>
          <div className={sectionHd}>{t('sectionHeader')}</div>

          {loading ? (
            <div className="h-16 animate-pulse rounded-lg bg-[#f5f2ee]" />
          ) : state?.status === 'connecte' ? (
            <>
              <p className="text-sm text-[#1a1a2e]">{t('connectedLabel')} <span className="font-medium">{state.account_email}</span></p>
              <button
                type="button"
                onClick={disconnect}
                disabled={busy}
                className="self-start rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                {t('disconnectCta')}
              </button>
            </>
          ) : state?.status === 'permissions_a_completer' ? (
            <>
              <p className="text-sm text-[#1a1a2e]">{t('partialLabel')} <span className="font-medium">{state.account_email}</span></p>
              <p className="text-xs text-[#8a7e6e]">{t('partialHint')}</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={connect}
                  disabled={busy}
                  className="rounded-lg bg-[#3b6bef] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                >
                  {t('reconnectCta')}
                </button>
                <button
                  type="button"
                  onClick={disconnect}
                  disabled={busy}
                  className="rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  {t('disconnectCta')}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-[#4a4a5a]">{t('noneLabel')}</p>
              <button
                type="button"
                onClick={connect}
                disabled={busy}
                className="self-start rounded-lg bg-[#3b6bef] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {t('connectCta')}
              </button>
            </>
          )}
        </section>

        <p className="mt-6 text-xs text-[#8a7e6e]">
          {t('notice')}
        </p>
      </div>
    </div>
  );
}
