/**
 * ProgressIndicator — 3-segment visual progress bar at the top of the wizard.
 * Mirrors the pattern in the validated mockup: each step gets a 28px x 3px bar,
 * filled blue once reached.
 */

const LABELS = ['Domain', 'DNS records', 'Verify'] as const;

export function ProgressIndicator({ currentStep }: { currentStep: 1 | 2 | 3 }) {
  return (
    <div className="mb-6 flex items-center justify-between">
      <span className="text-xs font-medium uppercase tracking-wider text-[#4a4a5a]">
        Step {currentStep} of 3 · {LABELS[currentStep - 1]}
      </span>
      <div className="flex gap-1" role="progressbar" aria-valuemin={1} aria-valuemax={3} aria-valuenow={currentStep}>
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
