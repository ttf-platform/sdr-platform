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
  pausedByUser: boolean
): { variant: PillVariant; label: string } {
  if (pausedByUser) return { variant: 'amber', label: 'Paused by you' };
  switch (status) {
    case 'pending': return { variant: 'gray',  label: 'Setup pending' };
    case 'warming': return { variant: 'blue',  label: 'Warming up' };
    case 'active':  return { variant: 'green', label: 'Active' };
    case 'paused':  return { variant: 'amber', label: 'Paused' };
    case 'failed':  return { variant: 'red',   label: 'Action required' };
  }
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
