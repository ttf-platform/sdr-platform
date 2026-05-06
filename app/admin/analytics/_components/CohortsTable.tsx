'use client';

type Cohort = { month: string; signups: number; retainedLast7Days: number; retentionPct: number };

export function CohortsTable({ cohorts }: { cohorts: Cohort[] }) {
  if (cohorts.length === 0) return <p className="text-sm text-[#9a9a9a]">No cohort data.</p>;

  return (
    <div className="overflow-hidden rounded-md border border-[#e8e3dc]">
      <table className="w-full">
        <thead className="border-b border-[#e8e3dc] bg-[#f5f2ee]">
          <tr>
            <Th>Cohort</Th>
            <Th align="right">Signups</Th>
            <Th align="right">Retained (7d)</Th>
            <Th align="right">Retention %</Th>
            <Th>Visualization</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#e8e3dc]">
          {cohorts.map((c) => (
            <tr key={c.month}>
              <Td><span className="font-mono text-sm text-[#1a1a1a]">{formatMonth(c.month)}</span></Td>
              <Td align="right">{c.signups}</Td>
              <Td align="right">{c.retainedLast7Days}</Td>
              <Td align="right">
                <span className={`text-sm font-medium ${getRetentionColor(c.retentionPct)}`}>{c.retentionPct.toFixed(1)}%</span>
              </Td>
              <Td>
                <div className="h-2 w-full overflow-hidden rounded-full bg-[#f0ebe4]">
                  <div className={`h-full ${getRetentionBarColor(c.retentionPct)}`} style={{ width: `${Math.min(100, c.retentionPct)}%` }} />
                </div>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return <th className={`px-4 py-2.5 text-${align} text-[11px] font-medium uppercase tracking-wide text-[#4a4a5a]`}>{children}</th>;
}
function Td({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return <td className={`px-4 py-3 text-${align}`}>{children}</td>;
}

function formatMonth(iso: string): string {
  const [y, m] = iso.split('-');
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${names[parseInt(m, 10) - 1]} ${y}`;
}

function getRetentionColor(pct: number): string {
  if (pct >= 50) return 'text-green-700';
  if (pct >= 25) return 'text-amber-700';
  return 'text-red-700';
}
function getRetentionBarColor(pct: number): string {
  if (pct >= 50) return 'bg-green-500';
  if (pct >= 25) return 'bg-amber-500';
  return 'bg-red-500';
}
