'use client'

import { useState } from 'react'
import { HelpWidgetPanel } from './HelpWidgetPanel'

export function FloatingHelpButton() {
  const [open, setOpen] = useState(false)

  return (
    <>
      {open && <HelpWidgetPanel onClose={() => setOpen(false)} />}
      <button
        onClick={() => setOpen(!open)}
        className="fixed bottom-6 right-6 z-[200] w-12 h-12 rounded-full bg-[#3b6bef] text-white shadow-lg hover:bg-[#2a5bdf] transition-colors flex items-center justify-center"
        aria-label="Help"
      >
        {open ? (
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path d="M4 4l10 10M14 4L4 14" stroke="white" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <circle cx="10" cy="10" r="9" stroke="white" strokeWidth="1.5"/>
            <path d="M7.5 7.5C7.5 6.1 8.6 5 10 5s2.5 1.1 2.5 2.5c0 1.4-1.5 2-1.5 3" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
            <circle cx="10" cy="14.5" r="0.75" fill="white"/>
          </svg>
        )}
      </button>
    </>
  )
}
