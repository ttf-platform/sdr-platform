type SpinnerProps = {
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const SIZE_CLASSES = {
  sm: 'h-4 w-4 border-2',
  md: 'h-6 w-6 border-2',
  lg: 'h-10 w-10 border-[3px]',
}

export function Spinner({ size = 'md', className = '' }: SpinnerProps) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={`inline-block rounded-full border-[#dde6fd] border-t-[#3b6bef] animate-spin ${SIZE_CLASSES[size]} ${className}`}
    />
  )
}

type SpinnerWithTextProps = {
  text?: string
  size?: 'sm' | 'md' | 'lg'
}

export function SpinnerWithText({ text = 'Loading…', size = 'md' }: SpinnerWithTextProps) {
  return (
    <div className="flex items-center gap-3 text-sm text-[#8a7e6e]">
      <Spinner size={size} />
      <span>{text}</span>
    </div>
  )
}
