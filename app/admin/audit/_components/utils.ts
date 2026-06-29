// Shared formatters used across audit tabs. Pure functions, no side effects.

export function formatRelative(iso: string | null): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.round((now - then) / 1000);
  if (diffSec < 5) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  const diffMo = Math.round(diffDay / 30);
  if (diffMo < 12) return `${diffMo}mo ago`;
  return `${Math.round(diffMo / 12)}y ago`;
}

export function truncateId(id: string | null | undefined): string {
  if (!id) return '—';
  return id.length > 13 ? id.slice(0, 8) + '…' + id.slice(-4) : id;
}

/** Time-remaining label, future-oriented (e.g. "in 14m", "in 2 days"). */
export function formatTimeRemaining(targetIso: string | null): string {
  if (!targetIso) return '—';
  const target = new Date(targetIso).getTime();
  const diffSec = Math.round((target - Date.now()) / 1000);
  if (diffSec <= 0) return 'expired';
  if (diffSec < 60) return `in ${diffSec}s`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `in ${diffMin}m`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `in ${diffHr}h`;
  const diffDay = Math.round(diffHr / 24);
  return `in ${diffDay}d`;
}
