import { Link } from '@/i18n/routing';

type Props = {
  href: string;
  variant?: 'primary' | 'secondary';
  children: React.ReactNode;
  className?: string;
};

export function CTAButton({ href, variant = 'primary', children, className = '' }: Props) {
  const base =
    'inline-flex items-center justify-center rounded-lg text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b6bef] focus-visible:ring-offset-2 active:scale-[0.98]';
  const variants = {
    primary:
      'bg-[#3b6bef] text-white px-6 py-3 hover:bg-[#2a5bdf] shadow-sm hover:shadow-md',
    secondary:
      'bg-transparent text-[#1a1a1a] px-6 py-3 border border-[#e8e3dc] hover:bg-[#f5f2ee] hover:border-[#d4cec7]',
  };
  return (
    <Link
      href={href}
      className={`${base} ${variants[variant]} ${className}`}
    >
      {children}
    </Link>
  );
}
