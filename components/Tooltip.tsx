'use client'
import { useState, useRef } from 'react'
import { createPortal } from 'react-dom'

type Placement = 'top' | 'top-end' | 'bottom' | 'bottom-end'

interface Props {
  content: string
  children: React.ReactNode
  placement?: Placement
}

export function Tooltip({ content, children, placement = 'top' }: Props) {
  const [show, setShow]         = useState(false)
  const [pos,  setPos]          = useState({ top: 0, left: 0 })
  const triggerRef = useRef<HTMLSpanElement>(null)

  function handleMouseEnter() {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    let top: number
    let left: number

    if (placement === 'top' || placement === 'top-end') {
      top  = rect.top  + window.scrollY - 8
      left = placement === 'top-end'
        ? rect.right  + window.scrollX
        : rect.left   + window.scrollX + rect.width / 2
    } else {
      top  = rect.bottom + window.scrollY + 8
      left = placement === 'bottom-end'
        ? rect.right  + window.scrollX
        : rect.left   + window.scrollX + rect.width / 2
    }

    setPos({ top, left })
    setShow(true)
  }

  const transform = placement.endsWith('-end')
    ? 'translateX(-100%) translateY(-100%)'
    : 'translateX(-50%) translateY(-100%)'

  const transformBottom = placement === 'bottom'
    ? 'translateX(-50%)'
    : placement === 'bottom-end'
      ? 'translateX(-100%)'
      : undefined

  const finalTransform = placement.startsWith('bottom') ? transformBottom : transform

  return (
    <>
      <span
        ref={triggerRef}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={() => setShow(false)}
        onClick={() => setShow(v => !v)}
        style={{ display: 'inline-flex', cursor: 'help' }}
      >
        {children}
      </span>

      {show && content && typeof document !== 'undefined' && createPortal(
        <div
          style={{
            position:        'absolute',
            top:             pos.top,
            left:            pos.left,
            transform:       finalTransform,
            zIndex:          9999,
            backgroundColor: '#ffffff',
            color:           '#1a1a2e',
            border:          '1px solid #e5e0d6',
            borderLeft:      '4px solid #3b6bef',
            fontSize:        '12px',
            lineHeight:      '1.6',
            borderRadius:    '8px',
            boxShadow:       '0 8px 24px rgba(0,0,0,0.1)',
            width:           '300px',
            whiteSpace:      'normal',
            wordBreak:       'normal',
            overflowWrap:    'break-word',
            pointerEvents:   'none',
            overflow:        'hidden',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '10px 12px' }}>
            <svg style={{ width: '13px', height: '13px', color: '#3b6bef', flexShrink: 0, marginTop: '1px' }} viewBox="0 0 20 20" fill="#3b6bef" aria-hidden="true">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
            <span>{content}</span>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
