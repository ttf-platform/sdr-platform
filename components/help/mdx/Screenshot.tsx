'use client'

import { useState, useEffect, useRef } from 'react'
import Image from 'next/image'

export function Screenshot({
  src,
  alt,
  caption,
  placeholder,
}: {
  src?: string
  alt: string
  caption?: string
  placeholder?: boolean
}) {
  const [zoomed, setZoomed] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!zoomed) return
    const el = dialogRef.current
    if (el) el.focus()

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setZoomed(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [zoomed])

  if (placeholder || !src) {
    return (
      <figure className="my-6 overflow-hidden rounded-xl border-2 border-dashed border-[#e8e3dc] bg-[#faf8f5] px-6 py-10 text-center">
        <p className="text-xs font-semibold uppercase tracking-widest text-[#3b6bef] mb-3">
          Screenshot coming soon
        </p>
        <p className="text-sm text-[#6b5e4e]">{caption ?? alt}</p>
      </figure>
    )
  }

  return (
    <>
      <figure className="my-6 overflow-hidden rounded-xl border border-[#e8e3dc] shadow-sm">
        <button
          type="button"
          className="block w-full cursor-zoom-in"
          onClick={() => setZoomed(true)}
          aria-label={`Zoom: ${alt}`}
        >
          <Image
            src={src}
            alt={alt}
            width={1200}
            height={675}
            className="w-full"
            unoptimized
          />
        </button>
        {caption && (
          <figcaption className="border-t border-[#e8e3dc] bg-[#faf8f5] px-4 py-2 text-xs text-[#6b5e4e]">
            {caption}
          </figcaption>
        )}
      </figure>
      {zoomed && (
        <div
          ref={dialogRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-label={alt}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 outline-none"
          onClick={() => setZoomed(false)}
        >
          <Image
            src={src}
            alt={alt}
            width={1800}
            height={1012}
            className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
            unoptimized
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  )
}
