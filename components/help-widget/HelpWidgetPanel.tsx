'use client'

import { useState } from 'react'
import { HelpMenu } from './HelpMenu'
import { AskAIChat } from './AskAIChat'
import { ReportBugForm } from './ReportBugForm'
import { FeedbackForm } from './FeedbackForm'

type View = 'menu' | 'chat' | 'bug' | 'feedback'

interface Props {
  onClose: () => void
}

export function HelpWidgetPanel({ onClose }: Props) {
  const [view, setView] = useState<View>('menu')

  return (
    <div className="fixed bottom-[80px] right-6 z-[199] w-[360px] h-[600px] min-h-[600px] max-h-[calc(100vh-120px)] bg-white rounded-2xl shadow-2xl border border-[#e8e3dc] flex flex-col overflow-hidden">
      {view === 'menu' && (
        <HelpMenu
          onClose={onClose}
          onChat={() => setView('chat')}
          onBug={() => setView('bug')}
          onFeedback={() => setView('feedback')}
        />
      )}
      {view === 'chat' && (
        <AskAIChat onBack={() => setView('menu')} onClose={onClose} />
      )}
      {view === 'bug' && (
        <ReportBugForm onBack={() => setView('menu')} onClose={onClose} />
      )}
      {view === 'feedback' && (
        <FeedbackForm onBack={() => setView('menu')} onClose={onClose} />
      )}
    </div>
  )
}
