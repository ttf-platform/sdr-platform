'use client';

export function SignupsChart({ data }: { data: Array<{ day: string; count: number }> }) {
  if (data.length === 0) {
    return <div className="flex h-32 items-center justify-center text-sm text-[#9a9a9a]">No data</div>;
  }

  const max = Math.max(1, ...data.map((d) => d.count));
  const width = 600;
  const height = 140;
  const paddingTop = 8;
  const paddingBottom = 24;
  const paddingX = 4;
  const innerWidth = width - paddingX * 2;
  const innerHeight = height - paddingTop - paddingBottom;
  const barWidth = innerWidth / data.length;
  const barGap = Math.max(1, barWidth * 0.2);

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-32 w-full" preserveAspectRatio="none">
        {[0.25, 0.5, 0.75].map((p) => (
          <line
            key={p}
            x1={paddingX} x2={width - paddingX}
            y1={paddingTop + innerHeight * (1 - p)} y2={paddingTop + innerHeight * (1 - p)}
            stroke="#f0ebe4" strokeWidth="1"
          />
        ))}

        {data.map((d, i) => {
          const h = (d.count / max) * innerHeight;
          const x = paddingX + i * barWidth + barGap / 2;
          const y = paddingTop + innerHeight - h;
          return (
            <g key={d.day}>
              <rect
                x={x} y={y}
                width={Math.max(1, barWidth - barGap)}
                height={Math.max(0, h)}
                fill={d.count > 0 ? '#3b6bef' : '#e8e3dc'}
                rx="1"
              />
            </g>
          );
        })}

        {[0, Math.floor(data.length / 2), data.length - 1].map((i) => {
          const d = data[i];
          if (!d) return null;
          const x = paddingX + i * barWidth + barWidth / 2;
          return (
            <text key={`label-${i}`} x={x} y={height - 6} fontSize="9" fill="#9a9a9a" textAnchor="middle">
              {formatDayLabel(d.day)}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

function formatDayLabel(iso: string): string {
  const [, month, day] = iso.split('-');
  return `${day}/${month}`;
}
