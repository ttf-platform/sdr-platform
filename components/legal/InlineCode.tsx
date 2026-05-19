export function InlineCode({ children }: { children: React.ReactNode }) {
  return (
    <code className="text-[0.85em] bg-[#f0ede8] px-1.5 py-0.5 rounded font-mono">
      {children}
    </code>
  )
}
