'use client'

import { useState } from 'react'
import Image from 'next/image'

export function Screenshot({
  src,
  alt,
  caption,
}: {
  src: string
  alt: string
  caption?: string
}) {
  const [zoomed, setZoomed] = useState(false)

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
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setZoomed(false)}
          role="dialog"
          aria-modal="true"
          aria-label={alt}
        >
          <Image
            src={src}
            alt={alt}
            width={1800}
            height={1012}
            className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
            unoptimized
          />
        </div>
      )}
    </>
  )
}
