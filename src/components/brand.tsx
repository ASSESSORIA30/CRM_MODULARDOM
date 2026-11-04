export function Brand({ light = false }: { light?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-10 w-10 items-center justify-center rounded bg-navy ring-1 ring-gold/60">
        <svg viewBox="0 0 24 24" className="h-6 w-6 text-gold" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
          <path d="M3 11.5 12 4l9 7.5" />
          <path d="M5.5 10v9.5h13V10" />
          <path d="M10 19.5v-5h4v5" />
        </svg>
      </div>
      <span className={`text-lg font-semibold tracking-[0.18em] ${light ? "text-white" : "text-navy"}`}>
        MODULARDOM
      </span>
    </div>
  );
}
