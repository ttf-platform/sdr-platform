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
            position:       'absolute',
            top:            pos.top,
            left:           pos.left,
            transform:      finalTransform,
            zIndex:         9999,
            backgroundColor: '#111827',
            color:          '#ffffff',
            fontSize:       '12px',
            lineHeight:     '1.5',
            padding:        '8px 12px',
            borderRadius:   '6px',
            boxShadow:      '0 4px 6px rgba(0,0,0,0.15)',
            width:          '320px',
            whiteSpace:     'normal',
            wordBreak:      'normal',
            overflowWrap:   'break-word',
            pointerEvents:  'none',
          }}
        >
          {content}
        </div>,
        document.body,
      )}
    </>
  )
}
