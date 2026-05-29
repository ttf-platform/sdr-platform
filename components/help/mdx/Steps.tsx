import type { ReactNode } from 'react'

export function Steps({ children }: { children: ReactNode }) {
  return (
    <div className="my-6 [&>ol]:space-y-3 [&>ol]:pl-0 [&>ol]:list-none [&>ol>li]:flex [&>ol>li]:gap-3 [&>ol>li]:items-start">
      {children}
    </div>
  )
}
