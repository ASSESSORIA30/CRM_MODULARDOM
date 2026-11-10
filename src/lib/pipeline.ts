import type { AppLocale } from "@/lib/auth";

export const MAIN_STAGES = ["lead", "pressupost", "avantprojecte", "contractat", "projecte_llicencia", "en_obra"] as const;
export const SIDE_STAGES = ["perdut", "finalitzat"] as const;
export const ALL_STAGES = [...MAIN_STAGES, ...SIDE_STAGES] as const;
export type Stage = (typeof ALL_STAGES)[number];

export function isStage(v: unknown): v is Stage {
  return typeof v === "string" && (ALL_STAGES as readonly string[]).includes(v);
}

const STAGE_LABELS: Record<AppLocale, Record<Stage, string>> = {
  ca: {
    lead: "Lead nou", pressupost: "Pressupost i visites", avantprojecte: "Avantprojecte",
    contractat: "Contractat", projecte_llicencia: "Projecte i llicència", en_obra: "En obra",
    perdut: "Perdut o descartat", finalitzat: "Obra finalitzada",
  },
  es: {
    lead: "Lead nuevo", pressupost: "Presupuesto y visitas", avantprojecte: "Anteproyecto",
    contractat: "Contratado", projecte_llicencia: "Proyecto y licencia", en_obra: "En obra",
    perdut: "Perdido o descartado", finalitzat: "Obra finalizada",
  },
};

export function stageLabel(stage: string, locale: AppLocale = "ca"): string {
  return isStage(stage) ? STAGE_LABELS[locale][stage] : stage;
}

export const STEP_LABELS: Record<AppLocale, string[]> = {
  ca: [
    "Contacte amb el client",
    "Pressupost enviat",
    "Visita a la casa pilot (opcional)",
    "Visita al terreny",
    "Avantprojecte",
    "Acceptació del pressupost definitiu i signatura del contracte",
    "Redacció del projecte",
    "Projecte portat a visar",
    "Projecte visat i llicència sol·licitada",
    "Llicència acceptada",
    "Inici d'obra",
  ],
  es: [
    "Contacto con el cliente",
    "Presupuesto enviado",
    "Visita a la casa piloto (opcional)",
    "Visita al terreno",
    "Anteproyecto",
    "Aceptación del presupuesto definitivo y firma del contrato",
    "Redacción del proyecto",
    "Proyecto llevado a visar",
    "Proyecto visado y licencia solicitada",
    "Licencia aceptada",
    "Inicio de obra",
  ],
};

export function stepLabel(step: number, locale: AppLocale = "ca") {
  return STEP_LABELS[locale][step - 1] ?? `#${step}`;
}

/** Passos que l'arquitecte assignat pot marcar (coincideix amb set_project_step). */
export const ARCHITECT_STEPS = [5, 7, 8, 9, 10];

export const PRIORITIES = ["baixa", "normal", "alta", "urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const PRIORITY_LABELS: Record<AppLocale, Record<Priority, string>> = {
  ca: { baixa: "Baixa", normal: "Normal", alta: "Alta", urgent: "Urgent" },
  es: { baixa: "Baja", normal: "Normal", alta: "Alta", urgent: "Urgente" },
};

export const PRIORITY_STYLE: Record<Priority, string> = {
  baixa: "bg-slate-100 text-slate-600",
  normal: "bg-sky-50 text-sky-700",
  alta: "bg-amber-50 text-amber-700",
  urgent: "bg-red-50 text-red-700",
};

export const ACTIVITY_KINDS = ["trucada", "email", "reunio", "visita", "whatsapp", "nota"] as const;
export const ACTIVITY_LABELS: Record<AppLocale, Record<(typeof ACTIVITY_KINDS)[number], string>> = {
  ca: { trucada: "Trucada", email: "Correu", reunio: "Reunió", visita: "Visita", whatsapp: "WhatsApp", nota: "Nota" },
  es: { trucada: "Llamada", email: "Correo", reunio: "Reunión", visita: "Visita", whatsapp: "WhatsApp", nota: "Nota" },
};

export const EVENT_KINDS = [
  "visita_casa_pilot", "visita_terreny", "reunio_client", "tasca_comercial", "visita_arquitectura",
  "inspeccio", "reunio_obra", "termini_administratiu", "seguiment_pressupost", "fita", "entrega", "altre",
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];
export const EVENT_LABELS: Record<AppLocale, Record<EventKind, string>> = {
  ca: {
    visita_casa_pilot: "Visita a la casa pilot", visita_terreny: "Visita al terreny", reunio_client: "Reunió amb client",
    tasca_comercial: "Tasca comercial", visita_arquitectura: "Visita d'arquitectura", inspeccio: "Inspecció",
    reunio_obra: "Reunió d'obra", termini_administratiu: "Termini administratiu",
    seguiment_pressupost: "Seguiment de pressupost", fita: "Fita", entrega: "Entrega", altre: "Altre",
  },
  es: {
    visita_casa_pilot: "Visita a la casa piloto", visita_terreny: "Visita al terreno", reunio_client: "Reunión con cliente",
    tasca_comercial: "Tarea comercial", visita_arquitectura: "Visita de arquitectura", inspeccio: "Inspección",
    reunio_obra: "Reunión de obra", termini_administratiu: "Plazo administrativo",
    seguiment_pressupost: "Seguimiento de presupuesto", fita: "Hito", entrega: "Entrega", altre: "Otro",
  },
};
export const EVENT_COLOR: Record<EventKind, string> = {
  visita_casa_pilot: "border-l-gold", visita_terreny: "border-l-emerald-500", reunio_client: "border-l-sky-500",
  tasca_comercial: "border-l-slate-400", visita_arquitectura: "border-l-violet-500", inspeccio: "border-l-orange-500",
  reunio_obra: "border-l-navy", termini_administratiu: "border-l-red-500", seguiment_pressupost: "border-l-amber-500",
  fita: "border-l-teal-500", entrega: "border-l-gold", altre: "border-l-slate-300",
};

export const EVENT_STATUSES = ["previst", "confirmat", "fet", "cancellat"] as const;
export const EVENT_STATUS_LABELS: Record<AppLocale, Record<(typeof EVENT_STATUSES)[number], string>> = {
  ca: { previst: "Previst", confirmat: "Confirmat", fet: "Fet", cancellat: "Cancel·lat" },
  es: { previst: "Previsto", confirmat: "Confirmado", fet: "Hecho", cancellat: "Cancelado" },
};

export const TASK_KINDS = ["comercial", "tecnica", "obra", "administrativa", "altre"] as const;
export const TASK_KIND_LABELS: Record<AppLocale, Record<(typeof TASK_KINDS)[number], string>> = {
  ca: { comercial: "Comercial", tecnica: "Tècnica", obra: "Obra", administrativa: "Administrativa", altre: "Altre" },
  es: { comercial: "Comercial", tecnica: "Técnica", obra: "Obra", administrativa: "Administrativa", altre: "Otro" },
};
export const TASK_STATUSES = ["pendent", "en_curs", "feta", "cancellada"] as const;
export const TASK_STATUS_LABELS: Record<AppLocale, Record<(typeof TASK_STATUSES)[number], string>> = {
  ca: { pendent: "Pendent", en_curs: "En curs", feta: "Feta", cancellada: "Cancel·lada" },
  es: { pendent: "Pendiente", en_curs: "En curso", feta: "Hecha", cancellada: "Cancelada" },
};

export const LEAD_SOURCES = ["web", "configurador", "email", "telefon", "recomanacio", "xarxes", "fira", "altre"] as const;
export const LEAD_SOURCE_LABELS: Record<AppLocale, Record<(typeof LEAD_SOURCES)[number], string>> = {
  ca: { web: "Web", configurador: "Configurador web", email: "Correu", telefon: "Telèfon", recomanacio: "Recomanació", xarxes: "Xarxes socials", fira: "Fira", altre: "Altre" },
  es: { web: "Web", configurador: "Configurador web", email: "Correo", telefon: "Teléfono", recomanacio: "Recomendación", xarxes: "Redes sociales", fira: "Feria", altre: "Otro" },
};
