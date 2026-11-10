import type { AppLocale } from "@/lib/auth";
import { av } from "@/lib/i18n-avantprojecte";
import type { ReportTexts } from "./report-pdf";

/** Textos (serialitzables) del PDF de l'informe */
export function reportTexts(locale: AppLocale): ReportTexts {
  const T = av(locale);
  const R = T.report;
  return {
    title: R.title, project: R.project, round: R.round, submitted: R.submitted, generated: R.generated, status: R.status,
    exception: R.exception, closed: R.closed, open: R.open, summary: R.summary, requested: R.requested, incorporated: R.incorporated,
    partial: R.partial, notViable: R.notViable, alternativesAccepted: R.alternativesAccepted, pending: R.pending, discarded: R.discarded,
    originalText: R.originalText, item: R.item, room: R.room, originalRequest: R.originalRequest, confirmedInterpretation: R.confirmedInterpretation,
    plan: R.plan, photos: R.photos, architect: R.architect, alternative: R.alternative, clientConfirmations: R.clientConfirmations,
    comments: R.comments, finalResolution: R.finalResolution, version: R.version, references: R.references, published: R.published,
    approved: R.approved, page: R.page, of: R.of, none: R.none, economic: R.economic,
    itemStatus: T.itemStatus, altStatus: T.altStatus, resolutions: T.resolutions, confirmationKinds: R.confirmationKinds,
    economicOptions: T.economicOptions,
  };
}
