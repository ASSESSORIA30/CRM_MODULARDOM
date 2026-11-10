import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Card, PageHeader, btnPrimary, btnSecondary } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { isValidDateKey, madridDateKey } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { actionMessages } from "@/lib/messages";
import { createEventAction } from "../actions";
import { EventFields } from "../event-fields";
import { eventOptions } from "../options";

export default async function NovaCitaPage({ searchParams }: { searchParams: Promise<{ data?: string; projecte?: string; client?: string }> }) {
  const profile = await requireRole("direccio", "arquitecte");
  const d = t(profile.locale);
  const sp = await searchParams;
  const isDir = profile.role === "direccio";
  const day = isValidDateKey(sp.data) ? sp.data : madridDateKey();
  const opts = await eventOptions(isDir);
  const uuid = (v?: string) => (v && /^[0-9a-f-]{36}$/.test(v) ? v : null);

  return (
    <div className="max-w-3xl">
      <PageHeader title={d.newEvent} actions={<Link href="/calendari" className={btnSecondary}>{d.back}</Link>} />
      <Card>
        <ActionForm action={createEventAction} messages={actionMessages(profile.locale)} submitLabel={d.create} submitClassName={btnPrimary}>
          <EventFields locale={profile.locale} isDir={isDir} {...opts}
            defaults={{ start: `${day}T10:00`, end: `${day}T11:00`, project_id: uuid(sp.projecte), client_id: uuid(sp.client), responsible_id: profile.id }} />
        </ActionForm>
      </Card>
    </div>
  );
}
