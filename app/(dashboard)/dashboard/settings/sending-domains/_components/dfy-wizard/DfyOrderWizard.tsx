'use client';

/**
 * DfyOrderWizard — Client state machine for the 3-step DFY ordering flow.
 *
 *   Step 1 (Domain)  → choose dedicated-new OR pre-warmed + accounts → next
 *   Step 2 (Quote)   → POST /api/email-accounts/dfy-order { simulate: true }
 *                      shows the provider quote; no DB write, no charge
 *   Step 3 (Confirm) → POST /api/email-accounts/dfy-order { simulate: false }
 *                      places the real order; redirects to the list with a
 *                      "pending — 24-72h" banner
 *
 * State is local — the order row is created in the DB only on Step 3 commit.
 * Back navigation preserves the quote so the user doesn't pay a re-fetch.
 *
 * Visual tokens align with the existing DNS wizard (#3b6bef CTA, #e8e3dc
 * borders, card rounded-lg bg-white p-6).
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { DfyStep1Choose, type DfyStep1State } from './DfyStep1Choose';
import { DfyStep2Quote, type DfyQuote } from './DfyStep2Quote';
import { DfyStep3Confirm } from './DfyStep3Confirm';

export interface DfyWizardState extends DfyStep1State {
  quote?: DfyQuote;
}

export function DfyOrderWizard() {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [state, setState] = useState<DfyWizardState>({
    orderType:        'dfy',
    domain:           '',
    forwardingDomain: '',
    accounts:         [{ emailAddressPrefix: 'outreach', firstName: '', lastName: '' }],
  });

  function handleStep1Complete(next: DfyStep1State) {
    setState((s) => ({ ...s, ...next, quote: undefined }));
    setStep(2);
  }

  function handleStep2Complete(quote: DfyQuote) {
    setState((s) => ({ ...s, quote }));
    setStep(3);
  }

  return (
    <div className="rounded-lg border border-[#e8e3dc] bg-white p-6">
      <DfyProgressIndicator currentStep={step} />

      {step === 1 && (
        <DfyStep1Choose
          initialState={state}
          onComplete={handleStep1Complete}
        />
      )}

      {step === 2 && (
        <DfyStep2Quote
          state={state}
          onBack={() => setStep(1)}
          onEditStep1={() => setStep(1)}
          onComplete={handleStep2Complete}
        />
      )}

      {step === 3 && state.quote && (
        <DfyStep3Confirm
          state={state}
          quote={state.quote}
          onBack={() => setStep(2)}
          onEditStep1={() => setStep(1)}
        />
      )}
    </div>
  );
}

// --- Inlined progress indicator (DFY-specific labels) ----------------------
// The shared <ProgressIndicator> in ../wizard/ is hardcoded to DNS labels.
// Keeping a local copy avoids touching that component until A2a-UI-2 when
// we may extract a generic version.
function DfyProgressIndicator({ currentStep }: { currentStep: 1 | 2 | 3 }) {
  const t = useTranslations('dashboard.sendingDomains.dfyWizard.shell');
  const label = currentStep === 1 ? t('stepDomain') : currentStep === 2 ? t('stepQuote') : t('stepConfirm');
  return (
    <div className="mb-6 flex items-center justify-between">
      <span className="text-xs font-medium uppercase tracking-wider text-[#4a4a5a]">
        {t('progress', { currentStep, label })}
      </span>
      <div
        className="flex gap-1"
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={3}
        aria-valuenow={currentStep}
        aria-label="DFY order progress"
      >
        {[1, 2, 3].map((s) => (
          <div
            key={s}
            className={`h-[3px] w-7 rounded-sm ${s <= currentStep ? 'bg-[#3b6bef]' : 'bg-[#e8e3dc]'}`}
          />
        ))}
      </div>
    </div>
  );
}
