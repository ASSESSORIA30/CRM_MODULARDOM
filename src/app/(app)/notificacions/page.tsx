import { EmptyState, PageHeader, btnSecondary } from "@/components/ui";
import { requireActiveProfile } from "@/lib/auth";
import { formatDateTime } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { markAllNotificationsRead, openNotification } from "../actions";

export default async function NotificacionsPage() {
  const profile = await requireActiveProfile();
  const d = t(profile.locale);
  const supabase = await createClient();
  const { data: items } = await supabase.from("notifications")
    .select("id, kind, title, body, link, read_at, created_at")
    .order("created_at", { ascending: false }).limit(200);

  return (
    <div className="max-w-3xl">
      <PageHeader title={d.notifications} actions={
        items?.some((n) => !n.read_at) && (
          <form action={markAllNotificationsRead}><button className={btnSecondary}>{d.markAllRead}</button></form>
        )
      } />
      {items?.length ? (
        <ul className="space-y-2">
          {items.map((n) => (
            <li key={n.id}>
              <form action={openNotification}>
                <input type="hidden" name="id" value={n.id} />
                <button className={`flex w-full items-start gap-3 rounded-xl border p-4 text-left shadow-sm transition hover:border-gold ${n.read_at ? "border-navy/10 bg-white" : "border-gold/50 bg-gold-light/30"}`}>
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read_at ? "bg-transparent" : "bg-gold"}`} />
                  <span className="min-w-0 flex-1">
                    <span className={`block text-sm ${n.read_at ? "text-ink" : "font-semibold text-navy"}`}>{n.title}</span>
                    {n.body && <span className="block text-sm text-muted">{n.body}</span>}
                    <span className="block text-xs text-muted">{formatDateTime(n.created_at, profile.locale)}</span>
                  </span>
                </button>
              </form>
            </li>
          ))}
        </ul>
      ) : <EmptyState>{d.noNotifications}</EmptyState>}
    </div>
  );
}
