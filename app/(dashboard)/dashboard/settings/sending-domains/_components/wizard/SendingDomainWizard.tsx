'use client';

/**
 * SendingDomainWizard — Client state machine for the 3-step setup flow.
 *
 * Flow:
 *   Step 1 (Domain) → POST /api/email-accounts → row created with
 *     setup_status='dns_pending', dns_records persisted, advance to Step 2
 *   Step 2 (DNS records) — livraison 6B — show records + provider guides
 *   Step 3 (Verify)   — livraison 6B — POST .../dns-verify, on allVerified
 *     redirect to /dashboard/settings/sending-domains
 *
 * State is local to the wizard — the row is the source of truth in DB once
 * Step 1 completes. If the user closes the tab during Step 2/3, the row
 * remains in 'dns_pending' and the list page shows a "Continue setup" CTA
 * (livraison 6B will wire that link).
 */

import { useState } from 'react';
import { ProgressIndicator } from './ProgressIndicator';
import { Step1Domain } from './Step1Domain';
import { Step2DnsRecords } from './Step2DnsRecords';
import { Step3Verify } from './Step3Verify';

interface DnsRecords {
  spf: { name: string; value: string };
  dkim: { name: string; value: string };
  dmarc: { name: string; value: string };
}

export interface WizardState {
  domain: string;
  emailAddress: string;
  senderName: string;
  accountId?: string;
  dnsRecords?: DnsRecords;
}

export function SendingDomainWizard({
  userEmail,
}: {
  userEmail: string | null;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [state, setState] = useState<WizardState>({
    domain: '',
    emailAddress: '',
    senderName: '',
  });

  function handleStep1Complete(next: WizardState) {
    setState(next);
    setStep(2);
  }

  return (
    <div className="rounded-lg border border-[#e8e3dc] bg-white p-6">
      <ProgressIndicator currentStep={step} />

      {step === 1 && (
        <Step1Domain
          userEmail={userEmail}
          initialState={state}
          onComplete={handleStep1Complete}
        />
      )}

      {step === 2 && (
        <Step2DnsRecords state={state} onBack={() => setStep(1)} onContinue={() => setStep(3)} />
      )}

      {step === 3 && <Step3Verify state={state} onBack={() => setStep(2)} />}
    </div>
  );
}

