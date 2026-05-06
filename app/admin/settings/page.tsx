export default function SettingsPlaceholder() {
  return (
    <div className="mx-auto max-w-6xl p-8">
      <h1 className="text-2xl font-semibold text-[#1a1a1a]">Platform Settings</h1>
      <p className="mt-1 text-sm text-[#4a4a5a]">Global configuration and feature flags</p>
      <div className="mt-8 rounded-lg border border-dashed border-[#e8e3dc] bg-white p-12 text-center">
        <div className="mb-2 text-3xl">⚙️</div>
        <p className="text-sm font-medium text-[#1a1a1a]">Coming in next admin sprint</p>
        <p className="mt-1 text-xs text-[#9a9a9a]">Admin notification email, feature flags, rate limits, etc.</p>
      </div>
    </div>
  );
}
