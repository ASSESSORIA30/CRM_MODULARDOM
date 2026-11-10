import { ActionForm } from "@/components/action-form";
import { Badge, Card, Field, PageHeader, btnPrimary, inputCls } from "@/components/ui";
import { requireRole, type AppRole } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { actionMessages } from "@/lib/messages";
import { createClient } from "@/lib/supabase/server";
import { createCompanyAction, inviteUserAction, updateUserAction } from "./actions";

const ROLES: AppRole[] = ["direccio", "arquitecte", "constructor", "client"];

export default async function UsuarisPage() {
  const profile = await requireRole("direccio");
  const L = profile.locale;
  const d = t(L);
  const msgs = actionMessages(L);
  const supabase = await createClient();
  const [{ data: users }, { data: companies }, { data: clients }, { data: links }] = await Promise.all([
    supabase.from("profiles").select("id, email, full_name, role, is_active, company_id, created_at").order("is_active").order("full_name"),
    supabase.from("companies").select("id, name, tax_id, is_active").order("name"),
    supabase.from("clients").select("id, display_name").is("merged_into", null).order("display_name").limit(1000),
    supabase.from("client_users").select("client_id, profile_id"),
  ]);
  const clientOf = new Map((links ?? []).map((l) => [l.profile_id, l.client_id]));
  const secretOk = Boolean(process.env.SUPABASE_SECRET_KEY);

  const roleOptions = ROLES.map((r) => <option key={r} value={r}>{d.roles[r]}</option>);
  const companyOptions = (companies ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>);
  const clientOptions = (clients ?? []).map((c) => <option key={c.id} value={c.id}>{c.display_name}</option>);

  return (
    <div className="max-w-6xl">
      <PageHeader title={`${d.admin} · ${d.users}`} />
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <Card title={d.users}>
          <ul className="divide-y divide-navy/5">
            {(users ?? []).map((u) => (
              <li key={u.id} className="py-4">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="font-medium text-navy">{u.full_name || u.email}</span>
                  <span className="text-xs text-muted">{u.email}</span>
                  <Badge className={u.is_active ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}>{u.is_active ? d.active : d.inactive}</Badge>
                  <span className="ml-auto text-xs text-muted">{formatDate(u.created_at, L)}</span>
                </div>
                <ActionForm action={updateUserAction} messages={msgs} submitLabel={d.save}
                  className="grid items-end gap-2 sm:grid-cols-[1fr_9rem_1fr_auto_auto]"
                  submitClassName="rounded-md border border-navy/20 px-3 py-2 text-sm font-medium text-navy hover:border-gold">
                  <input type="hidden" name="id" value={u.id} />
                  <Field label={d.fullName}><input name="full_name" defaultValue={u.full_name} className={inputCls} /></Field>
                  <Field label={d.roleLabel}><select name="role" defaultValue={u.role} className={inputCls}>{roleOptions}</select></Field>
                  <Field label={`${d.company} / ${d.linkedClient}`}>
                    <div className="flex gap-1">
                      <select name="company_id" defaultValue={u.company_id ?? ""} className={inputCls} aria-label={d.company}>
                        <option value="">— {d.company}</option>{companyOptions}
                      </select>
                      <select name="client_id" defaultValue={clientOf.get(u.id) ?? ""} className={inputCls} aria-label={d.linkedClient}>
                        <option value="">— {d.client}</option>{clientOptions}
                      </select>
                    </div>
                  </Field>
                  <label className="flex items-center gap-2 pb-2 text-sm text-navy">
                    <input type="checkbox" name="is_active" defaultChecked={u.is_active} disabled={u.id === profile.id} className="h-4 w-4 accent-navy" />
                    {d.active}
                    {u.id === profile.id && <input type="hidden" name="is_active" value="on" />}
                  </label>
                </ActionForm>
              </li>
            ))}
          </ul>
        </Card>

        <div className="space-y-6">
          <Card title={d.inviteUser}>
            {!secretOk && <p className="mb-3 rounded-md bg-amber-50 p-2 text-xs text-amber-900">{d.secretMissing}</p>}
            <ActionForm action={inviteUserAction} messages={{ ...msgs, saved: d.inviteSent }} submitLabel={d.invite} resetOnSuccess
              className="space-y-3" submitClassName={btnPrimary}>
              <Field label={d.email}><input name="email" type="email" required className={inputCls} /></Field>
              <Field label={d.fullName}><input name="full_name" required className={inputCls} /></Field>
              <Field label={d.roleLabel}><select name="role" defaultValue="arquitecte" className={inputCls}>{roleOptions}</select></Field>
              <Field label={d.language}>
                <select name="locale" defaultValue="ca" className={inputCls}><option value="ca">Català</option><option value="es">Castellano</option></select>
              </Field>
              <Field label={`${d.company} (${d.roles.constructor})`}>
                <select name="company_id" defaultValue="" className={inputCls}><option value="">—</option>{companyOptions}</select>
              </Field>
              <Field label={`${d.linkedClient} (${d.roles.client})`}>
                <select name="client_id" defaultValue="" className={inputCls}><option value="">—</option>{clientOptions}</select>
              </Field>
            </ActionForm>
          </Card>

          <Card title={d.companies}>
            <ul className="mb-4 space-y-1 text-sm">
              {(companies ?? []).map((c) => <li key={c.id}>{c.name} {c.tax_id && <span className="text-xs text-muted">· {c.tax_id}</span>}</li>)}
            </ul>
            <ActionForm action={createCompanyAction} messages={msgs} submitLabel={d.newCompany} resetOnSuccess className="space-y-2"
              submitClassName="w-full rounded-md border border-navy/20 px-3 py-2 text-sm font-medium text-navy hover:border-gold">
              <input name="name" required placeholder={d.companyName} className={inputCls} />
              <input name="tax_id" placeholder="CIF" className={inputCls} />
            </ActionForm>
          </Card>
        </div>
      </div>
    </div>
  );
}
