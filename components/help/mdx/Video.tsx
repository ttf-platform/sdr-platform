export function Video({ src, poster }: { src?: string; poster?: string }) {
  if (!src) {
    return (
      <div className="my-6 flex h-48 items-center justify-center rounded-xl border border-[#e8e3dc] bg-[#faf8f5]">
        <span className="text-sm text-[#6b5e4e]">Video walkthrough coming soon.</span>
      </div>
    )
  }
  return (
    <div className="my-6 overflow-hidden rounded-xl border border-[#e8e3dc] shadow-sm">
      <video
        src={src}
        poster={poster}
        controls
        preload="none"
        className="w-full"
        aria-label="Video walkthrough"
      />
    </div>
  )
}
