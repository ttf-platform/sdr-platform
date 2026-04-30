'use client'
import { useState } from 'react'

interface Props {
  content: string
  children: React.ReactNode
}

export function Tooltip({ content, children }: Props) {
  const [visible, setVisible] = useState(false)

  return (
    <div
      className="relative inline-flex items-center"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onClick={() => setVisible(v => !v)}
    >
      {children}
      {visible && content && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 w-64 bg-gray-900 text-white text-xs px-3 py-2 rounded-md shadow-lg pointer-events-none animate-in fade-in duration-150">
          {content}
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
        </div>
      )}
    </div>
  )
}
