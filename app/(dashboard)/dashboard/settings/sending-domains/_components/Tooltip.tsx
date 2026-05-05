'use client';

/**
 * Re-exports the project's shared Tooltip primitive (components/Tooltip.tsx)
 * so sending-domains components don't import across distant paths.
 * Also exports InfoIcon — the ⓘ trigger used next to stat labels.
 */

export { Tooltip } from '@/components/Tooltip';

export function InfoIcon({ className = '' }: { className?: string }) {
  return (
    <span
      aria-label="More information"
      tabIndex={0}
      className={`inline-flex h-3.5 w-3.5 cursor-help items-center justify-center rounded-full border border-[#9a9a9a] text-[9px] font-semibold text-[#4a4a5a] hover:border-[#1a1a1a] hover:text-[#1a1a1a] focus:outline-none ${className}`}
    >
      i
    </span>
  );
}
