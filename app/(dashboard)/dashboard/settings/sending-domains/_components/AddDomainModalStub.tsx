'use client';

/**
 * AddDomainModalStub — placeholder for the 3-step DNS wizard (livraison 6).
 *
 * This stub exists so the "Add sending domain" button is wired and visually
 * functional from livraison 5 onward. Replace the body of this file with the
 * real wizard implementation in livraison 6 — keep the same component name
 * and props signature so the Client wrapper doesn't change.
 */

export function AddDomainModalStub({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />

      {/* Dialog */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-domain-title"
        className="relative z-50 w-full max-w-lg rounded-lg border border-[#e8e3dc] bg-white p-6 sm:p-8 shadow-xl max-h-[calc(100vh-2rem)] overflow-y-auto"
      >
        <h2
          id="add-domain-title"
          className="mb-2 text-base font-semibold text-[#1a1a1a]"
        >
          Add sending domain
        </h2>
        <p className="mb-6 text-sm leading-relaxed text-[#4a4a5a]">
          The 3-step DNS wizard is coming next. We'll guide you through domain
          input, DNS records publication with provider-specific instructions,
          and verification — all without leaving Sentra.
        </p>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-[#e8e3dc] bg-white px-4 py-2 text-sm font-medium text-[#1a1a1a] transition-colors hover:bg-[#f5f2ee]"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
