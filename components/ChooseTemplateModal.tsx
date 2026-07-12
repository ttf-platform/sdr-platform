'use client'
import { useTranslations } from 'next-intl'
import { CAMPAIGN_TEMPLATES, type CampaignTemplate } from '@/lib/campaign-templates'

interface Props {
  onSelect: (template: CampaignTemplate) => void
  onClose: () => void
}

export function ChooseTemplateModal({ onSelect, onClose }: Props) {
  const t = useTranslations('components.campaignModals.chooseTemplate')
  const tTemplates = useTranslations('components.campaignModals.templates')

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[calc(100vh-2rem)] flex flex-col">
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-[#f0ece6]">
          <div>
            <h2 className="text-base font-bold text-[#1a1a2e]">{t('title')}</h2>
            <p className="text-xs text-[#8a7e6e] mt-0.5">{t('subtitle')}</p>
          </div>
          <button onClick={onClose} className="p-2 text-[#8a7e6e] hover:text-[#1a1a2e] text-xl leading-none">✕</button>
        </div>

        <div className="overflow-y-auto p-4 sm:p-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {CAMPAIGN_TEMPLATES.map(tpl => {
              const label = tpl.i18nKey ? tTemplates(`${tpl.i18nKey}.label`) : (tpl.label ?? '')
              const description = tpl.i18nKey ? tTemplates(`${tpl.i18nKey}.description`) : (tpl.description ?? '')
              return (
                <button
                  key={tpl.id}
                  onClick={() => onSelect(tpl)}
                  className={`text-left rounded-xl border-2 p-4 transition-all hover:border-[#3b6bef] hover:bg-[#eef1fd]/40 group ${
                    tpl.id === 'blank'
                      ? 'border-dashed border-[#c8c0b4]'
                      : 'border-[#e8e3dc]'
                  }`}
                >
                  <div className="text-2xl mb-2">{tpl.emoji}</div>
                  <div className="font-semibold text-sm text-[#1a1a2e] mb-1 group-hover:text-[#3b6bef] transition-colors">
                    {label}
                  </div>
                  <div className="text-xs text-[#8a7e6e] leading-relaxed">
                    {description}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
