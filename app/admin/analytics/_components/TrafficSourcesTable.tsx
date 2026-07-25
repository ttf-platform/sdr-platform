'use client';

type TrafficSource = { source: string; signups: number; pct: number };

export function TrafficSourcesTable({ sources }: { sources: TrafficSource[] }) {
  if (sources.length === 0) return <p className="text-sm text-[#9a9a9a]">No signups yet.</p>;

  return (
    <div className="overflow-x-auto overflow-hidden rounded-md border border-[#e8e3dc]">
      <table className="w-full">
        <thead className="border-b border-[#e8e3dc] bg-[#f5f2ee]">
          <tr>
            <Th>Source</Th>
            <Th align="right">Signups</Th>
            <Th align="right">%</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#e8e3dc]">
          {sources.map((s) => (
            <tr key={s.source}>
              <Td><span className="font-mono text-sm text-[#1a1a1a]">{s.source}</span></Td>
              <Td align="right">{s.signups}</Td>
              <Td align="right">
                <span className="text-sm font-medium text-[#1a1a1a]">{s.pct.toFixed(1)}%</span>
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
