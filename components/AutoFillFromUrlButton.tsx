'use client'
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { AutoFillPreviewModal, type ExtractedFields } from './AutoFillPreviewModal'

interface Props {
  websiteValue: string
  onApply:      (extracted: ExtractedFields) => void
}

export function AutoFillFromUrlButton({ websiteValue, onApply }: Props) {
  const t = useTranslations('components.autoFill.button')
  const [loading,     setLoading]     = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [extracted,   setExtracted]   = useState<ExtractedFields | null>(null)
  const [error,       setError]       = useState('')

  async function handleClick() {
    if (!websiteValue.trim()) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/auto-fill', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ url: websiteValue }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? t('errorExtraction'))
        return
      }
      setExtracted(data.extracted)
      setShowPreview(true)
    } catch {
      setError(t('errorNetwork'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={loading || !websiteValue.trim()}
        title={!websiteValue.trim() ? t('disabledTitle') : undefined}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
      >
        {loading ? (
          <>
            <span className="w-3.5 h-3.5 border-2 border-blue-400 border-t-blue-700 rounded-full animate-spin" />
            {t('analyzing')}
          </>
        ) : (
          <>{t('label')}</>
        )}
      </button>

      {error && (
        <p className="text-xs text-red-500 mt-1">{error}</p>
      )}

      {showPreview && extracted && (
        <AutoFillPreviewModal
          extracted={extracted}
          url={websiteValue}
          onApply={values => { onApply(values); setShowPreview(false) }}
          onCancel={() => setShowPreview(false)}
        />
      )}
    </div>
  )
}
