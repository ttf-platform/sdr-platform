'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import clsx from 'clsx'

export interface ModalProps {
  /** Controls visibility */
  isOpen: boolean
  /** Called on backdrop click, ESC key, or programmatically */
  onClose: () => void
  /** Modal title (rendered as h2, mapped to aria-labelledby) */
  title: string
  /** Optional subtitle (mapped to aria-describedby) */
  description?: string
  /** Max width preset */
  size?: 'sm' | 'md' | 'lg' | 'xl'
  /** Body content */
  children: React.ReactNode
  /** Optional footer (typically Cancel/Confirm buttons) */
  footer?: React.ReactNode
  /** Backdrop click closes (default true) */
  closeOnBackdropClick?: boolean
  /** ESC key closes (default true) */
  closeOnEscape?: boolean
  /** Element to auto-focus when modal opens (default: first focusable in modal) */
  initialFocusRef?: React.RefObject<HTMLElement>
}

const SIZE_CLASSES = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
}

/**
 * Accessible modal wrapper.
 *
 * Features:
 *  - Backdrop with click-outside-to-close (configurable)
 *  - ESC key handler (configurable)
 *  - Focus trap (Tab cycles inside modal)
 *  - Body scroll lock when open
 *  - Restore focus to opener on close
 *  - Portal rendering via createPortal (no z-index issues)
 *  - ARIA: role="dialog", aria-modal="true", aria-labelledby, aria-describedby
 *  - SSR-safe (portal mounts client-side only)
 *
 * Sprint C — accessibility consolidation (May 2026).
 * Use this wrapper for ALL NEW modals.
 * 20 existing modals (components/*Modal.tsx, admin drawers, etc.) will be migrated
 * incrementally as they get touched in future work.
 *
 * Usage:
 *   <Modal
 *     isOpen={isOpen}
 *     onClose={() => setOpen(false)}
 *     title="Delete user?"
 *     description={email}
 *     size="md"
 *     footer={
 *       <>
 *         <button onClick={() => setOpen(false)}>Cancel</button>
 *         <button onClick={handleConfirm}>Confirm</button>
 *       </>
 *     }
 *   >
 *     <p>Body content here…</p>
 *   </Modal>
 */
export function Modal({
  isOpen,
  onClose,
  title,
  description,
  size = 'md',
  children,
  footer,
  closeOnBackdropClick = true,
  closeOnEscape = true,
  initialFocusRef,
}: ModalProps) {
  const [mounted, setMounted] = useState(false)
  const modalRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const titleId = useRef(`modal-title-${Math.random().toString(36).slice(2, 11)}`)
  const descId = useRef(`modal-desc-${Math.random().toString(36).slice(2, 11)}`)

  // SSR-safe portal mount
  useEffect(() => {
    setMounted(true)
  }, [])

  // Save previous focus + body scroll lock when open + auto-focus + restore on close
  useEffect(() => {
    if (!isOpen) return
    previousFocusRef.current = document.activeElement as HTMLElement
    document.body.style.overflow = 'hidden'

    const focusInitial = () => {
      if (initialFocusRef?.current) {
        initialFocusRef.current.focus()
      } else {
        const firstFocusable = modalRef.current?.querySelector<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
        firstFocusable?.focus()
      }
    }
    const timeoutId = setTimeout(focusInitial, 0)

    return () => {
      clearTimeout(timeoutId)
      document.body.style.overflow = ''
      previousFocusRef.current?.focus()
    }
  }, [isOpen, initialFocusRef])

  // ESC key handler
  useEffect(() => {
    if (!isOpen || !closeOnEscape) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, closeOnEscape, onClose])

  // Focus trap (Tab + Shift+Tab cycles inside modal)
  useEffect(() => {
    if (!isOpen) return
    function handleTab(e: KeyboardEvent) {
      if (e.key !== 'Tab') return
      const focusable = modalRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
      if (!focusable || focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', handleTab)
    return () => window.removeEventListener('keydown', handleTab)
  }, [isOpen])

  if (!mounted || !isOpen) return null

  const modal = (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/40"
        onClick={closeOnBackdropClick ? onClose : undefined}
        aria-hidden="true"
      />
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId.current}
        aria-describedby={description ? descId.current : undefined}
        className={clsx(
          'fixed left-1/2 top-1/2 z-50 w-full -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[#e8e3dc] bg-white p-4 sm:p-6 shadow-xl max-h-[calc(100vh-2rem)] overflow-y-auto',
          SIZE_CLASSES[size]
        )}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
        >
          <X size={18} />
        </button>
        <h2 id={titleId.current} className="mb-1 text-base font-semibold text-[#1a1a1a]">
          {title}
        </h2>
        {description && (
          <p id={descId.current} className="mb-4 text-sm font-medium text-[#1a1a1a]">
            {description}
          </p>
        )}
        <div className="mb-6">{children}</div>
        {footer && <div className="flex justify-end gap-3">{footer}</div>}
      </div>
    </>
  )

  return createPortal(modal, document.body)
}
