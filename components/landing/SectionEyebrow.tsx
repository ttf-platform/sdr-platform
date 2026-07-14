import type { ReactNode } from 'react';

interface Props {
  children: ReactNode;
  className?: string;
}

// Section eyebrow: small blue label preceding a section heading.
// Normal case, no uppercase, no wide tracking — the tell of AI-templated landings.
export function SectionEyebrow({ children, className }: Props) {
  const base = 'mb-5 text-[0.75rem] font-medium text-[#3b6bef]';
  return (
    <p className={className ? `${base} ${className}` : base} style={{ letterSpacing: '0.01em' }}>
      {children}
    </p>
  );
}
