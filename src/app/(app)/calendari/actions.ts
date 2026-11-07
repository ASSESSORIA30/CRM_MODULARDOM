"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { fromPgError, type ActionResult } from "@/lib/action-result";
import { madridDateKey, madridLocalToDate } from "@/lib/dates";
import { formObject, optText, optUuid, reqText, reqUuid, zodFieldErrors } from "@/lib/forms";
import { EVENT_KINDS, EVENT_STATUSES } from "@/lib/pipeline";
import { createClient } from "@/lib/supabase/server";

const eventSchema = z.object({
  title: reqText(200),
  kind: z.enum(EVENT_KINDS),
  start: z.string().min(1, "required"),
  end: optText(20),
  all_day: z.string().optional(),
  location: optText(300),
  notes: optText(4000),
  project_id: optUuid,
  client_id: optUuid,
  responsible_id: optUuid,
  status: z.enum(EVENT_STATUSES).default("previst"),
  reminder_minutes: z.coerce.number().int().min(0).max(10080).default(60),
  visible_to_client: z.string().optional(),
});

type Parsed = { ok: true; row: Record<string, unknown>; attendees: string[] } | { ok: false; res: ActionResult<unknown> };

function parseEvent(formData: FormData, isDir: boolean, meId: string): Parsed {
  const parsed = eventSchema.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, res: { ok: false, error: "required", fieldErrors: zodFieldErrors(parsed.error) } };
  const v = parsed.data;
  const allDay = v.all_day === "on";
  let startsAt: Date, endsAt: Date | null = null;
  try {
    startsAt = madridLocalToDate(allDay ? v.start.slice(0, 10) : v.start);
    if (v.end) endsAt = madridLocalToDate(allDay ? v.end.slice(0, 10) : v.end);
  } catch {
    return { ok: false, res: { ok: false, error: "invalidDate" } };
  }
  if (endsAt && endsAt < startsAt) return { ok: false, res: { ok: false, error: "endBeforeStart" } };
  const attendees = formData.getAll("attendees").map(String).filter((x) => /^[0-9a-f-]{36}$/.test(x));
  return {
    ok: true,
    attendees: isDir ? attendees : [],
    row: {
      title: v.title, kind: v.kind, all_day: allDay,
      starts_at: startsAt.toISOString(), ends_at: endsAt?.toISOString() ?? null,
      location: v.location ?? null, notes: v.notes ?? null,
      project_id: v.project_id, client_id: isDir ? v.client_id : null,
      responsible_id: isDir ? v.responsible_id : meId,
      status: v.status, reminder_minutes: v.reminder_minutes,
      visible_to_client: isDir && v.visible_to_client === "on",
    },
  };
}

export async function createEventAction(_prev: ActionResult<unknown> | undefined, formData: FormData): Promise<ActionResult<unknown>> {
  const me = await requireRole("direccio", "arquitecte");
  const isDir = me.role === "direccio";
  const p = parseEvent(formData, isDir, me.id);
  if (!p.ok) return p.res;
  if (!isDir && !p.row.project_id) return { ok: false, error: "required", fieldErrors: { project_id: "required" } };
  const supabase = await createClient();
  const { data, error } = await supabase.from("calendar_events").insert({ ...p.row, created_by: me.id }).select("id, starts_at").single();
  if (error) return fromPgError(error);
  if (p.attendees.length) {
    await supabase.from("calendar_event_attendees").insert(p.attendees.map((profile_id) => ({ event_id: data.id, profile_id })));
  }
  revalidatePath("/calendari");
  redirect(`/calendari?data=${madridDateKey(data.starts_at)}`);
}

export async function updateEventAction(eventId: string, _prev: ActionResult<unknown> | undefined, formData: FormData): Promise<ActionResult<unknown>> {
  const me = await requireRole("direccio", "arquitecte");
  if (!reqUuid.safeParse(eventId).success) return { ok: false, error: "genericError" };
  const isDir = me.role === "direccio";
  const p = parseEvent(formData, isDir, me.id);
  if (!p.ok) return p.res;
  const supabase = await createClient();
  const { data, error } = await supabase.from("calendar_events").update(p.row).eq("id", eventId).select("id");
  if (error) return fromPgError(error);
  if (!data?.length) return { ok: false, error: "forbidden" };
  if (isDir) {
    await supabase.from("calendar_event_attendees").delete().eq("event_id", eventId);
    if (p.attendees.length) {
      await supabase.from("calendar_event_attendees").insert(p.attendees.map((profile_id) => ({ event_id: eventId, profile_id })));
    }
  }
  revalidatePath("/calendari");
  revalidatePath(`/calendari/${eventId}`);
  return { ok: true };
}

export async function deleteEventAction(formData: FormData) {
  await requireRole("direccio");
  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) return;
  const supabase = await createClient();
  await supabase.from("calendar_events").delete().eq("id", id.data);
  revalidatePath("/calendari");
  redirect("/calendari");
}
