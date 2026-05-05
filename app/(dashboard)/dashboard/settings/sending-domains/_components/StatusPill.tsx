/**
 * StatusPill — alias toward the project's shared StatusBadge component.
 * No duplication: uses components/StatusBadge.tsx under the hood.
 */

import { StatusBadge } from '@/components/StatusBadge';

type PillVariant = 'gray' | 'amber' | 'green' | 'red' | 'blue' | 'purple' | 'yellow';

export function StatusPill({
  variant,
  children,
  className,
}: {
  variant: PillVariant;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <StatusBadge variant={variant} className={className}>
      {children}
    </StatusBadge>
  );
}

export function warmupStatusToPill(
  status: 'pending' | 'warming' | 'active' | 'paused' | 'failed',
  pausedByUser: boolean,
  setupStatus?: 'dns_pending' | 'verified'
): { variant: PillVariant; label: string } {
  if (pausedByUser) return { variant: 'amber', label: 'Paused by you' };
  if (status === 'failed') return { variant: 'red',   label: 'Action required' };
  if (status === 'paused') return { variant: 'amber', label: 'Paused' };
  if (setupStatus === 'dns_pending') return { variant: 'gray', label: 'Setup pending' };
  // DNS verified — user can send at full capacity regardless of warmup phase.
  return { variant: 'green', label: 'Active' };
}

export function DnsRecordPill({
  verified,
  recordType,
}: {
  verified: boolean;
  recordType: 'SPF' | 'DKIM' | 'DMARC';
}) {
  return (
    <StatusPill variant={verified ? 'green' : 'amber'}>
      {recordType} {verified ? '✓' : '⏳'}
    </StatusPill>
  );
}
