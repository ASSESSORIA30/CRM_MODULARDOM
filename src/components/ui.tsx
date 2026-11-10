import Link from "next/link";
import type { ReactNode } from "react";

export const inputCls =
  "block w-full rounded-md border border-navy/20 bg-white px-3 py-2 text-sm outline-none focus:border-gold focus:ring-2 focus:ring-gold/30 disabled:bg-slate-50";
export const btnPrimary =
  "inline-flex items-center justify-center gap-2 rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white transition hover:bg-navy-dark disabled:opacity-60";
export const btnSecondary =
  "inline-flex items-center justify-center gap-2 rounded-md border border-navy/20 bg-white px-3 py-2 text-sm font-medium text-navy transition hover:border-gold hover:bg-gold-light/30 disabled:opacity-60";
export const btnGold =
  "inline-flex items-center justify-center gap-2 rounded-md bg-gold px-4 py-2 text-sm font-semibold text-navy-dark transition hover:brightness-95 disabled:opacity-60";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-navy">{title}</h1>
        <div className="mt-2 h-1 w-14 rounded bg-gold" />
        {subtitle && <div className="mt-3 text-sm text-muted">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, children, className = "", actions }: { title?: string; children: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <section className={`rounded-xl border border-navy/10 bg-white p-5 shadow-sm ${className}`}>
      {(title || actions) && (
        <div className="mb-4 flex items-center justify-between gap-2">
          {title && <h2 className="text-base font-semibold text-navy">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function StatCard({ label, value, href, tone = "default" }: { label: string; value: number | string; href?: string; tone?: "default" | "alert" | "gold" }) {
  const toneCls = tone === "alert" && value !== 0 && value !== "0" ? "text-red-700" : tone === "gold" ? "text-gold" : "text-navy";
  const body = (
    <>
      <p className="text-sm text-muted">{label}</p>
      <p className={`mt-2 text-3xl font-semibold ${toneCls}`}>{value}</p>
    </>
  );
  const cls = "block rounded-xl border border-navy/10 bg-white p-5 shadow-sm transition";
  return href ? (
    <Link href={href} className={`${cls} hover:border-gold hover:shadow-md`}>{body}</Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function Badge({ children, className = "bg-slate-100 text-slate-700" }: { children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${className}`}>{children}</span>;
}

export function Field({ label, children, hint, className = "" }: { label: string; children: ReactNode; hint?: string; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-navy/80">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-navy/15 p-6 text-center text-sm text-muted">{children}</p>;
}

export function Tabs({ items, current }: { items: { key: string; label: string; href: string }[]; current: string }) {
  return (
    <nav className="mb-5 flex flex-wrap gap-1 rounded-lg bg-white p-1 shadow-sm ring-1 ring-navy/10">
      {items.map((it) => (
        <Link
          key={it.key}
          href={it.href}
          className={`rounded-md px-3 py-1.5 text-sm font-medium ${it.key === current ? "bg-navy text-white" : "text-navy hover:bg-surface"}`}
        >
          {it.label}
        </Link>
      ))}
    </nav>
  );
}
