'use client'

interface Props {
  onClose: () => void
  onChat: () => void
  onBug: () => void
  onFeedback: () => void
}

function MenuItem({
  icon,
  title,
  description,
  onClick,
}: {
  icon: React.ReactNode
  title: string
  description: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-start gap-3 px-4 py-3.5 text-left hover:bg-[#f7f4f0] transition-colors border-b border-[#f0ece6] last:border-0"
    >
      <div className="w-9 h-9 rounded-xl bg-[#eef1fd] flex items-center justify-center flex-shrink-0 mt-0.5">
        {icon}
      </div>
      <div>
        <div className="text-sm font-semibold text-[#1a1a2e]">{title}</div>
        <div className="text-xs text-[#8a7e6e] mt-0.5">{description}</div>
      </div>
      <svg className="ml-auto mt-1 flex-shrink-0 text-[#c0bab2]" width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </button>
  )
}

export function HelpMenu({ onClose, onChat, onBug, onFeedback }: Props) {
  return (
    <>
      {/* Blue gradient header */}
      <div className="bg-gradient-to-br from-[#3b6bef] to-[#2952c9] px-5 py-5 flex items-start justify-between">
        <div>
          <div className="text-white font-bold text-base">Sentra Help</div>
          <div className="text-blue-100 text-xs mt-0.5">How can we help you today?</div>
        </div>
        <button onClick={onClose} className="text-blue-200 hover:text-white transition-colors mt-0.5">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      {/* Menu items */}
      <div className="flex-1 overflow-y-auto">
        <MenuItem
          onClick={onChat}
          icon={
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M2 3a1 1 0 011-1h12a1 1 0 011 1v9a1 1 0 01-1 1H5l-3 3V3z" stroke="#3b6bef" strokeWidth="1.5" strokeLinejoin="round"/>
              <path d="M5 6h8M5 9h5" stroke="#3b6bef" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          }
          title="Ask AI"
          description="Get instant answers from our AI assistant"
        />
        <MenuItem
          onClick={onBug}
          icon={
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <circle cx="9" cy="9" r="7" stroke="#3b6bef" strokeWidth="1.5"/>
              <path d="M9 6v4M9 13v.5" stroke="#3b6bef" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          }
          title="Report a bug"
          description="Tell us about something that's not working"
        />
        <MenuItem
          onClick={onFeedback}
          icon={
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M9 2l1.9 3.8 4.2.6-3 3 .7 4.2L9 11.5l-3.8 2 .7-4.2-3-3 4.2-.6L9 2z" stroke="#3b6bef" strokeWidth="1.5" strokeLinejoin="round"/>
            </svg>
          }
          title="Give feedback"
          description="Share ideas, suggestions, or feature requests"
        />
      </div>
    </>
  )
}
