'use client';

export function FunnelChart({ funnel }: { funnel: { signups: number; activatedTrials: number; paid: number } }) {
  const max = Math.max(1, funnel.signups);
  const stages = [
    { label: 'Signups', count: funnel.signups, color: 'bg-blue-500', from: null as number | null },
    { label: 'Activated', count: funnel.activatedTrials, color: 'bg-purple-500', from: funnel.signups },
    { label: 'Paid', count: funnel.paid, color: 'bg-green-500', from: funnel.activatedTrials },
  ];

  return (
    <div className="space-y-3">
      {stages.map((s) => {
        const pct = (s.count / max) * 100;
        const conversionFromPrev = s.from && s.from > 0 ? (s.count / s.from) * 100 : null;
        return (
          <div key={s.label}>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-sm font-medium text-[#1a1a1a]">{s.label}</span>
              <div className="flex items-center gap-2 text-xs">
                {conversionFromPrev !== null && (
                  <span className="text-[#9a9a9a]">{conversionFromPrev.toFixed(1)}% conv.</span>
                )}
                <span className="font-semibold text-[#1a1a1a]">{s.count.toLocaleString()}</span>
              </div>
            </div>
            <div className="h-7 w-full overflow-hidden rounded-md bg-[#f0ebe4]">
              <div className={`h-full ${s.color} transition-all`} style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
