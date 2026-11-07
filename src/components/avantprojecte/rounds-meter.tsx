// Indicador visual de rondes utilitzades / disponibles (també per al client).
export function RoundsMeter({ used, base, granted, label, caption }: {
  used: number; base: number; granted: number; label: string; caption: string;
}) {
  const total = Math.max(base + granted, used);
  return (
    <div>
      <p className="text-sm font-medium text-navy">{label}</p>
      <div className="mt-1.5 flex gap-1.5" role="img" aria-label={`${used} / ${base + granted}`}>
        {Array.from({ length: total }, (_, i) => (
          <span key={i} data-round={i + 1} data-used={i < used}
            className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold ${i < used ? "bg-navy text-white" : "border-2 border-dashed border-navy/30 text-navy/50"} ${i >= base ? "ring-2 ring-gold ring-offset-1" : ""}`}>
            {i < used ? "✓" : i + 1}
          </span>
        ))}
      </div>
      <p className="mt-1 text-xs text-muted">{caption}</p>
    </div>
  );
}
