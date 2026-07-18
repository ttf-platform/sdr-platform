'use client'

import { forwardRef } from 'react'

// Design decision (2026-07-19, Lot D): 40×24 track with a 20×20 thumb offset
// by 16px on. Thumb rectangle stays inside the track on both states
// [OFF: (2, 2) → (22, 22)] and [ON: (18, 2) → (38, 22)] within 40×24 — no
// pixel overhang at either edge.
//
// Colours come from the Sentra design system: track ON is Blueprint
// (#3b6bef), track OFF is the neutral border token (#e8e3dc). Focus ring
// uses the same Blueprint via focus-visible so keyboard traversal is
// legible. #3b6bef is a load-bearing brand token — don't repaint blindly
// (incident #204).

export interface ToggleProps {
  checked:   boolean
  onChange:  (v: boolean) => void
  // Accessible name for the switch. Required — a `role="switch"` control
  // without an accessible name fails WCAG 4.1.2 (Name, Role, Value). Every
  // caller either passes the surrounding label copy or an i18n key. If a
  // future consumer relies on a nearby <label for=…>, wrap the toggle in
  // LabeledToggle-style shell instead of relaxing this contract.
  ariaLabel: string
  disabled?: boolean
  className?: string
}

export const Toggle = forwardRef<HTMLButtonElement, ToggleProps>(function Toggle(
  { checked, onChange, ariaLabel, disabled, className },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => { if (!disabled) onChange(!checked) }}
      className={
        // shadow-inner is a barely-there ink-tinted hairline that keeps the
        // OFF pill visible on linen surfaces (billing overage, meetings day
        // strip). It disappears against the Blueprint fill in the ON state.
        'relative inline-flex flex-shrink-0 h-6 w-10 items-center rounded-full transition-colors shadow-[inset_0_0_0_1px_rgba(26,26,46,0.08)] ' +
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3b6bef] focus-visible:ring-offset-2 ' +
        'disabled:opacity-50 disabled:cursor-not-allowed ' +
        (checked ? 'bg-[#3b6bef] ' : 'bg-[#e8e3dc] ') +
        (className ?? '')
      }
    >
      <span
        aria-hidden="true"
        className={
          // The thumb's shadow reads as "lifted" on the enabled state.
          // Dropping it when disabled avoids a mid-air look on a dimmed
          // control (opacity-50 halves the shadow anyway, making it look
          // pasted rather than intentional).
          'absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform ' +
          (disabled ? '' : 'shadow ') +
          (checked ? 'translate-x-4' : 'translate-x-0')
        }
      />
    </button>
  )
})
