import type { ActionMessages } from "@/components/action-form";
import type { AppLocale } from "@/lib/auth";
import { t } from "@/lib/i18n";
import { STEP_LABELS } from "@/lib/pipeline";

/** Missatges serialitzables (només text) per als components client. */
export function actionMessages(locale: AppLocale): ActionMessages {
  const d = t(locale);
  return {
    saved: d.saved,
    stepLabels: STEP_LABELS[locale],
    errors: {
      genericError: d.genericError,
      forbidden: d.forbidden,
      missingSteps: d.missingSteps,
      stepRequired: d.stepRequired,
      invalidTransition: d.invalidTransition,
      lostReasonRequired: d.lostReasonRequired,
      required: d.required,
      invalidAmount: locale === "es" ? "Importe no válido." : "Import no vàlid.",
      invalidDate: locale === "es" ? "Fecha no válida." : "Data no vàlida.",
      invalidEmail: locale === "es" ? "Correo no válido." : "Correu no vàlid.",
      endBeforeStart: locale === "es" ? "La hora de fin es anterior a la de inicio." : "L'hora de fi és anterior a la d'inici.",
      secretMissing: d.secretMissing,
      cannotDeactivateSelf: d.cannotDeactivateSelf,
      duplicate: locale === "es" ? "Ya existe un registro con estos datos." : "Ja existeix un registre amb aquestes dades.",
    },
  };
}
