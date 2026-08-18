/**
 * app/(dashboard)/dashboard/settings/calendar/page.tsx
 *
 * LC21 (1) + (2)b — panneau Google Calendar.
 *
 * Trois etats seulement (non_connecte | connecte | permissions_a_completer),
 * un bouton Connecter, un bouton Deconnecter, lecture de ?status pour le
 * message post-OAuth, et la mention permanente demandee par le brief. Aucune
 * synchronisation n'est activee dans ce lot.
 *
 * (2)b : sous l'etat de raccordement, section de selection des calendriers
 * (bouton de rafraichissement, cases pour les conflits, choix unique pour le
 * calendrier d'ecriture, precoche du primary a la premiere ouverture dans le
 * FORMULAIRE UNIQUEMENT). Aucun basculement de mirror_ready ici.
 */

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

type ConnectionState = {
  status:        'non_connecte' | 'connecte' | 'permissions_a_completer';
  account_email: string;
  connected_at:  string | null;
  updated_at:    string | null;
};

type CalendarSource = {
  id:              string;
  display_name:    string;
  access_role:     string | null;
  is_conflict:     boolean;
  is_write_target: boolean;
  still_present:   boolean;
  primary:         boolean;
};

type SourcesState = {
  mirror_ready: boolean;
  sources:      CalendarSource[];
};

const SOURCES_ERROR_KEYS = new Set([
  'calendrier_inconnu',
  'calendrier_absent',
  'calendrier_ecriture_requis',
  'role_insuffisant',
]);

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
  const t        = useTranslations('dashboard.settings.googleCalendar.page');
  const tStatus  = useTranslations('dashboard.settings.googleCalendar.page.status');
  const tSources = useTranslations('dashboard.settings.googleCalendar.page.sources');
  const tSourcesErrors = useTranslations('dashboard.settings.googleCalendar.page.sources.errors');
  const params  = useSearchParams();
  const status  = params?.get('status') ?? null;

  const [state,   setState]   = useState<ConnectionState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy,    setBusy]    = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const [sourcesState,   setSourcesState]   = useState<SourcesState | null>(null);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [sourcesError,   setSourcesError]   = useState<string | null>(null);
  const [refreshing,     setRefreshing]     = useState(false);
  const [saving,         setSaving]         = useState(false);
  const [saved,          setSaved]          = useState(false);

  // Formulaire local — separe de sourcesState pour ne rien enregistrer tant
  // que l'utilisateur ne clique pas sur Enregistrer.
  const [formConflictIds,  setFormConflictIds]  = useState<Set<string>>(new Set());
  const [formWriteTargetId, setFormWriteTargetId] = useState<string | null>(null);
  const [formInitialized,  setFormInitialized]  = useState(false);

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

  const loadSources = useCallback(async (opts?: { refresh?: boolean }) => {
    if (opts?.refresh) {
      setRefreshing(true);
      // Le booleen `primary` n'est rendu QUE par la reponse d'un rafraichissement
      // (Google le retourne dans calendarList). Le pre-cochage initial ne peut
      // donc s'appliquer qu'a ce moment-la : on rearme l'initialisation du
      // formulaire pour que l'effet ci-dessous puisse pre-cocher le calendrier
      // marque primary, uniquement si rien n'est deja selectionne cote base.
      setFormInitialized(false);
    } else setSourcesLoading(true);
    setSourcesError(null);
    setSaved(false);
    try {
      const url = opts?.refresh
        ? '/api/calendar/google/sources?refresh=1'
        : '/api/calendar/google/sources';
      const res  = await fetch(url, { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSourcesError(opts?.refresh ? tSources('refreshError') : tSources('loadError'));
        return;
      }
      setSourcesState(data as SourcesState);
    } catch {
      setSourcesError(opts?.refresh ? tSources('refreshError') : tSources('loadError'));
    } finally {
      if (opts?.refresh) setRefreshing(false); else setSourcesLoading(false);
    }
  }, [tSources]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (state?.status === 'connecte') {
      void loadSources();
    } else {
      setSourcesState(null);
      setFormInitialized(false);
      setFormConflictIds(new Set());
      setFormWriteTargetId(null);
    }
  }, [state?.status, loadSources]);

  // A la premiere ouverture : precoche le primary dans le formulaire, sans
  // rien enregistrer.
  useEffect(() => {
    if (!sourcesState || formInitialized) return;
    const nothingSelected = sourcesState.sources.every(s => !s.is_conflict && !s.is_write_target);
    if (nothingSelected) {
      const primary = sourcesState.sources.find(s => s.primary && s.still_present) ?? null;
      if (primary) {
        setFormConflictIds(new Set([primary.id]));
        setFormWriteTargetId(primary.id);
      } else {
        setFormConflictIds(new Set());
        setFormWriteTargetId(null);
      }
    } else {
      setFormConflictIds(new Set(sourcesState.sources.filter(s => s.is_conflict).map(s => s.id)));
      const wt = sourcesState.sources.find(s => s.is_write_target);
      setFormWriteTargetId(wt ? wt.id : null);
    }
    setFormInitialized(true);
  }, [sourcesState, formInitialized]);

  const displayedSources = useMemo(() => sourcesState?.sources ?? [], [sourcesState]);

  function toggleConflict(id: string, checked: boolean) {
    setSaved(false);
    setFormConflictIds(prev => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  }

  function chooseWriteTarget(id: string | null) {
    setSaved(false);
    setFormWriteTargetId(id);
  }

  async function saveSelection() {
    setSaving(true);
    setSourcesError(null);
    setSaved(false);
    try {
      const res = await fetch('/api/calendar/google/sources', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conflict_ids:    [...formConflictIds],
          write_target_id: formWriteTargetId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const reason = typeof data?.error === 'string' && SOURCES_ERROR_KEYS.has(data.error) ? data.error : null;
        setSourcesError(reason ? tSourcesErrors(reason) : tSources('loadError'));
        return;
      }
      setSaved(true);
      await loadSources();
    } catch {
      setSourcesError(tSources('loadError'));
    } finally {
      setSaving(false);
    }
  }

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

        {state?.status === 'connecte' && (
          <section className={`${cardCls} mt-4`}>
            <div className="flex items-center justify-between gap-3">
              <div className={sectionHd}>{tSources('sectionHeader')}</div>
              <button
                type="button"
                onClick={() => { void loadSources({ refresh: true }); }}
                disabled={refreshing || sourcesLoading || saving}
                className="rounded-lg border border-[#e8e3dc] bg-white px-3 py-1.5 text-xs font-medium text-[#4a4a5a] hover:bg-[#f5f2ee] disabled:opacity-50"
              >
                {refreshing ? tSources('refreshing') : tSources('refreshCta')}
              </button>
            </div>

            <p className="text-sm text-[#4a4a5a]">{tSources('intro')}</p>

            {sourcesError && (
              <div
                role="alert"
                className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
              >
                {sourcesError}
              </div>
            )}

            {sourcesLoading ? (
              <div className="h-16 animate-pulse rounded-lg bg-[#f5f2ee]" />
            ) : displayedSources.length === 0 ? (
              <p className="text-sm text-[#8a7e6e]">{tSources('empty')}</p>
            ) : (
              <div className="overflow-hidden rounded-lg border border-[#e8e3dc]">
                <table className="w-full text-sm">
                  <thead className="bg-[#f5f2ee] text-xs uppercase tracking-wider text-[#8a7e6e]">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold">&nbsp;</th>
                      <th className="px-3 py-2 text-center font-semibold">{tSources('conflictColumn')}</th>
                      <th className="px-3 py-2 text-center font-semibold">{tSources('writeColumn')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedSources.map((s) => {
                      const disabled = !s.still_present;
                      const roleLower = (s.access_role ?? '').toLowerCase();
                      const canWrite = roleLower === 'owner' || roleLower === 'writer';
                      return (
                        <tr
                          key={s.id}
                          className={`border-t border-[#e8e3dc] ${disabled ? 'bg-[#f5f2ee] text-[#8a7e6e]' : ''}`}
                        >
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <span className={disabled ? 'line-through' : ''}>{s.display_name}</span>
                              {s.primary && (
                                <span className="rounded-full bg-[#eef1fd] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#3b6bef]">
                                  {tSources('primaryBadge')}
                                </span>
                              )}
                              {disabled && (
                                <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-red-600">
                                  {tSources('missingBadge')}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-center">
                            <input
                              type="checkbox"
                              aria-label={`${tSources('conflictColumn')} — ${s.display_name}`}
                              checked={formConflictIds.has(s.id)}
                              disabled={disabled || saving}
                              onChange={(e) => toggleConflict(s.id, e.target.checked)}
                            />
                          </td>
                          <td className="px-3 py-2 text-center">
                            <input
                              type="radio"
                              name="write-target"
                              aria-label={`${tSources('writeColumn')} — ${s.display_name}`}
                              checked={formWriteTargetId === s.id}
                              disabled={disabled || saving || !canWrite}
                              onChange={() => chooseWriteTarget(s.id)}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => { void saveSelection(); }}
                disabled={saving || sourcesLoading || displayedSources.length === 0}
                className="rounded-lg bg-[#3b6bef] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {saving ? tSources('saving') : tSources('saveCta')}
              </button>
              {saved && (
                <span role="status" className="text-xs text-[#3a7a3a]">{tSources('saved')}</span>
              )}
            </div>
          </section>
        )}

        <p className="mt-6 text-xs text-[#8a7e6e]">
          {t('notice')}
        </p>
      </div>
    </div>
  );
}
