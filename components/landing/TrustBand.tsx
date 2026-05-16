const STATS = [
  {
    value: 'Days, not weeks',
    label: 'Time to first meeting',
    sub: 'From signup to booked call',
  },
  {
    value: 'All-in-one',
    label: 'Sourcing → booking',
    sub: 'No integration required',
  },
  {
    value: '$149–$399/mo',
    label: 'No per-user pricing',
    sub: 'Everything included',
  },
  {
    value: 'Founder-built',
    label: 'For founders & first hires',
    sub: 'No sales training needed',
  },
];

export function TrustBand() {
  return (
    <section className="border-y border-[#e8e3dc] bg-[#f5f2ee]/70">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="grid grid-cols-2 sm:grid-cols-4">
          {STATS.map((s, i) => (
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
