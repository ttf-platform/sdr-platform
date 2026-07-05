'use client'

import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { motion } from 'framer-motion'

const STEPS = [
  { icon: '🎯', title: 'Define your ICP',            desc: 'Tell Mirvo who you target — AI uses this to personalize every email.' },
  { icon: '🌐', title: 'Add your sending domain',    desc: 'Configure DNS for long-term deliverability — connect a mailbox you already use, and you can start sending today.' },
  { icon: '✉️', title: 'Connect your mailbox',       desc: 'Link Gmail or Outlook — Mirvo warms up your dedicated domain over about 3 weeks, while your connected mailbox keeps your outreach running.' },
  { icon: '🚀', title: 'Create your first campaign', desc: 'Mirvo AI generates a personalized multi-step sequence tailored to your ICP.' },
  { icon: '👥', title: 'Add your prospects',         desc: 'CSV import or AI prospect discovery — no credits consumed for CSV.' },
  { icon: '✓',  title: 'Review AI-generated emails', desc: 'Approval Queue lets you validate every email before it reaches a prospect.' },
  { icon: '📤', title: 'Launch — send today',        desc: "Connect your existing mailbox and start sending right away. Scaling to a dedicated sending domain comes later, when you're ready." },
] as const

interface WelcomeModalProps {
  /** Called by the "Let's go", "Try sample data", the built-in X, and ESC.
   *  Semantics: modal closes for the current tab session but returns at the
   *  next login. Provider persists a sessionStorage flag only, no DB write. */
  onDismissTemporary: () => Promise<void> | void
  /** Called by the small "Don't show this again" link. Semantics: PATCH
   *  welcome_dismissed_permanently=true. Modal will not auto-show again
   *  until the user explicitly triggers Replay welcome tour from the
   *  avatar dropdown. */
  onDismissPermanent: () => Promise<void> | void
}

export function WelcomeModal({ onDismissTemporary, onDismissPermanent }: WelcomeModalProps) {
  const [isOpen,          setIsOpen]          = useState(true)
  const [submitting,      setSubmitting]       = useState(false)
  const [loadingSample,   setLoadingSample]    = useState(false)
  const [confirmingNever, setConfirmingNever]  = useState(false)

  async function handleClose() {
    setSubmitting(true)
    await onDismissTemporary()
    setIsOpen(false)
  }

  async function handleTrySample() {
    setLoadingSample(true)
    try {
      await fetch('/api/onboarding/load-sample-data', { method: 'POST' })
      await onDismissTemporary()
      setIsOpen(false)
      window.location.reload()
    } catch {
      setLoadingSample(false)
    }
  }

  async function handleNever() {
    setConfirmingNever(true)
    await onDismissPermanent()
    setIsOpen(false)
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      size="lg"
      title="Welcome to Mirvo"
      description="Your AI sales agent is ready. Here's your 7-step setup — connect your mailbox and you can send your first emails today."
      closeOnBackdropClick={false}
      footer={
        <div className="flex flex-col gap-2 w-full">
          <button
            onClick={handleClose}
            disabled={submitting || loadingSample || confirmingNever}
            className="w-full bg-[#1a1a2e] hover:bg-[#2a2a3e] text-white font-semibold py-3 px-6 rounded-lg text-sm transition-colors disabled:opacity-50"
          >
            {submitting ? 'Loading…' : "Let's go →"}
          </button>
          <button
            onClick={handleTrySample}
            disabled={submitting || loadingSample || confirmingNever}
            className="w-full border border-[#e8e3dc] bg-white hover:bg-[#f7f4f0] text-[#6b5e4e] font-medium py-2.5 px-6 rounded-lg text-sm transition-colors disabled:opacity-50"
          >
            {loadingSample ? 'Loading sample data…' : 'Try with sample data first →'}
          </button>
          <button
            type="button"
            onClick={handleNever}
            disabled={submitting || loadingSample || confirmingNever}
            className="mt-1 mx-auto text-xs text-[#8a7e6e] hover:text-[#4a4a5a] underline underline-offset-2 transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b6bef] focus-visible:ring-offset-2 rounded"
          >
            {confirmingNever ? 'Saving…' : "Don't show this again"}
          </button>
        </div>
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
        {STEPS.map((step, idx) => (
          <motion.div
            key={idx}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.07, duration: 0.25, ease: 'easeOut' }}
            className="flex gap-3 p-3 rounded-lg border border-[#e8e3dc] bg-[#fdfcfb]"
          >
            <span className="text-xl leading-none shrink-0 mt-0.5">{step.icon}</span>
            <div className="min-w-0">
              <div className="font-semibold text-sm text-[#1a1a2e] leading-snug">{step.title}</div>
              <div className="text-xs text-[#8a7e6e] mt-0.5 leading-relaxed">{step.desc}</div>
            </div>
          </motion.div>
        ))}
      </div>
      <div className="mt-4 p-3 bg-[#f5f2ee] rounded-lg text-xs text-[#6b5e4e] leading-relaxed">
        <strong>Day-1 sending:</strong> connect a mailbox you already use and start today — it&rsquo;s already trusted by inboxes. When you move to a dedicated sending domain, it warms up gradually while your connected mailbox keeps things running.
      </div>
    </Modal>
  )
}
