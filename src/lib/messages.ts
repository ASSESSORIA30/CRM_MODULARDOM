import type { ActionMessages } from "@/components/action-form";
import type { AppLocale } from "@/lib/auth";
import { t } from "@/lib/i18n";
import { STEP_LABELS } from "@/lib/pipeline";

/** Missatges serialitzables (només text) per als components client. */
export function actionMessages(locale: AppLocale): ActionMessages {
  const d = t(locale);
  const es = locale === "es";
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
      roundsExhausted: es ? "Se han agotado las rondas de modificaciones. Dirección puede autorizar una excepción." : "S'han esgotat les rondes de modificacions. Direcció pot autoritzar una excepció.",
      alreadySubmitted: es ? "Esta solicitud ya se ha enviado." : "Aquesta sol·licitud ja s'ha enviat.",
      emptyRound: es ? "Añade al menos un punto antes de enviar." : "Afegeix almenys un punt abans d'enviar.",
      reasonRequired: es ? "Indica el motivo." : "Indica el motiu.",
      invalidState: es ? "Esta acción no está disponible en el estado actual." : "Aquesta acció no està disponible en l'estat actual.",
      fileTypeNotAllowed: es ? "Tipo de archivo no admitido." : "Tipus de fitxer no admès.",
      fileTooLarge: es ? "El archivo supera el tamaño máximo permitido." : "El fitxer supera la mida màxima permesa.",
      invalidFileType: es ? "El contenido del archivo no corresponde a su extensión. No se ha guardado." : "El contingut del fitxer no correspon a l'extensió. No s'ha desat.",
      mentionsSkipped: es ? "Comentario guardado (algunas menciones no se han podido añadir)." : "Comentari desat (algunes mencions no s'han pogut afegir).",
      aiNotConfigured: es ? "El análisis con IA no está activado. Puedes añadir los puntos manualmente." : "L'anàlisi amb IA no està activada. Pots afegir els punts manualment.",
      aiError: es ? "No se ha podido analizar con IA. Puedes añadir los puntos manualmente." : "No s'ha pogut analitzar amb IA. Pots afegir els punts manualment.",
      duplicate: locale === "es" ? "Ya existe un registro con estos datos." : "Ja existeix un registre amb aquestes dades.",
    },
  };
}
