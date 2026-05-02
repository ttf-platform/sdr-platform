'use client'
import { useState } from 'react'

type Placement = 'top' | 'top-end' | 'bottom' | 'bottom-end'

interface Props {
  content: string
  children: React.ReactNode
  placement?: Placement
}

const POSITIONS: Record<Placement, { box: string; arrow: string }> = {
  'top':        { box: 'bottom-full left-1/2 -translate-x-1/2 mb-2',  arrow: 'absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900' },
  'top-end':    { box: 'bottom-full right-0 mb-2',                     arrow: 'absolute top-full right-3 border-4 border-transparent border-t-gray-900' },
  'bottom':     { box: 'top-full left-1/2 -translate-x-1/2 mt-2',     arrow: 'absolute bottom-full left-1/2 -translate-x-1/2 border-4 border-transparent border-b-gray-900' },
  'bottom-end': { box: 'top-full right-0 mt-2',                        arrow: 'absolute bottom-full right-3 border-4 border-transparent border-b-gray-900' },
}

export function Tooltip({ content, children, placement = 'top' }: Props) {
  const [visible, setVisible] = useState(false)
  const { box, arrow } = POSITIONS[placement]

  return (
    <div
      className="relative inline-flex items-center"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onClick={() => setVisible(v => !v)}
    >
      {children}
      {visible && content && (
        <div
          className={`absolute ${box} z-50 whitespace-normal break-words bg-gray-900 text-white text-xs px-3 py-2 rounded-md shadow-lg pointer-events-none`}
          style={{ maxWidth: '320px' }}
        >
          {content}
          <div className={arrow} />
        </div>
      )}
    </div>
  )
}
