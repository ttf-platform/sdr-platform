'use client'

import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { safeExternalHref } from '@/lib/url-safety'

// Markdown renderer for the AI help widget's ASSISTANT messages only.
// User input is never routed through this component (rendered as plain text
// upstream). No rehype-raw: any raw HTML in the model output is escaped, not
// executed. The default react-markdown urlTransform still filters javascript:/
// data:; we additionally gate anchor rendering through safeExternalHref so
// non-http(s) URLs render as inert text instead of clickable links.

// The container bubble is ~320px wide and uses text-sm, so heading levels are
// intentionally compressed to a single visual step (semibold, slightly larger
// top margin) — the assistant's markdown should feel like conversational
// prose, not a rendered article.
const components: Components = {
  p:      ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  h1:     ({ children }) => <p className="font-semibold text-sm mt-3 first:mt-0 mb-1">{children}</p>,
  h2:     ({ children }) => <p className="font-semibold text-sm mt-3 first:mt-0 mb-1">{children}</p>,
  h3:     ({ children }) => <p className="font-semibold text-sm mt-3 first:mt-0 mb-1">{children}</p>,
  ul:     ({ children }) => <ul className="list-disc pl-4 mb-2 space-y-0.5">{children}</ul>,
  ol:     ({ children }) => <ol className="list-decimal pl-4 mb-2 space-y-0.5">{children}</ol>,
  li:     ({ children }) => <li className="marker:text-[#8a7e6e]">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em:     ({ children }) => <em className="italic">{children}</em>,
  a:      ({ href, children }) => {
    const safe = safeExternalHref(typeof href === 'string' ? href : null)
    if (!safe) return <>{children}</>
    // Default color `#2a5bdf` (not the brand `#3b6bef`) because on the linen
    // bubble `bg-[#f0ece6]` the brand shade only clears ~4.05:1, below the
    // WCAG AA 4.5:1 body-text threshold. `#2a5bdf` sits at ~5.1:1 and is
    // already the hover shade used elsewhere in the dashboard, so this stays
    // consistent with the wider palette without breaking legibility.
    return (
      <a
        href={safe}
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-2 decoration-1 text-[#2a5bdf] hover:text-[#1e4dc2]"
      >
        {children}
      </a>
    )
  },
  code: ({ children, className }) => {
    // react-markdown routes inline code through `code` without a language
    // class; fenced blocks are wrapped in `pre` and receive `language-*`.
    // We only style inline here — `pre` handles the block styling below,
    // which nests this `code` component untouched.
    //
    // Chip on `bg-white` with the neutral border token instead of the linen
    // border token as a background — the latter is only ~1.13:1 against the
    // bubble surface and reads as a smudge, not a code affordance.
    const isBlock = typeof className === 'string' && className.startsWith('language-')
    if (isBlock) return <code className={className}>{children}</code>
    return <code className="bg-white border border-[#e8e3dc] rounded px-1 py-0.5 text-[0.85em] font-mono">{children}</code>
  },
  pre: ({ children }) => (
    <pre className="bg-white border border-[#e8e3dc] rounded-lg p-2 overflow-x-auto my-2 text-xs">{children}</pre>
  ),
}

export function ChatMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {content}
    </ReactMarkdown>
  )
}
