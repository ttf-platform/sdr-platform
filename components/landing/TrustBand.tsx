'use client';

import { useTranslations } from 'next-intl';

export function TrustBand() {
  const t = useTranslations('landing.trustBand');

  const stats = [
    { value: t('stat0Value'), label: t('stat0Label'), sub: t('stat0Sub') },
    { value: t('stat1Value'), label: t('stat1Label'), sub: t('stat1Sub') },
    { value: t('stat2Value'), label: t('stat2Label'), sub: t('stat2Sub') },
    { value: t('stat3Value'), label: t('stat3Label'), sub: t('stat3Sub') },
  ];

  return (
    <section className="border-y border-[#e8e3dc] bg-[#f5f2ee]/70">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="grid grid-cols-2 sm:grid-cols-4">
          {stats.map((s, i) => (
            <div
              key={s.label}
              className={`px-6 py-8 ${i > 0 ? 'border-l border-[#e8e3dc]' : ''} ${i >= 2 ? 'border-t sm:border-t-0 border-[#e8e3dc]' : ''}`}
            >
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9a9a9a] mb-1.5">
                {s.label}
              </div>
              <div className="text-base font-semibold text-[#1a1a1a] mb-0.5">{s.value}</div>
              <div className="text-xs text-[#9a9a9a]">{s.sub}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
