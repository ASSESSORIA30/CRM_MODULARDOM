// Proves de la pantalla de confirmació (dades fictícies). Només amb ENABLE_TEST_ROUTES=1.
import { notFound } from "next/navigation";
import { ConfirmSubmit } from "@/components/avantprojecte/confirm-submit";
import { MarkerThumb } from "@/components/avantprojecte/marker-thumb";
import { av } from "@/lib/i18n-avantprojecte";
import { actionMessages } from "@/lib/messages";

export const dynamic = "force-dynamic";

export default function ConfirmacioProves() {
  if (process.env.ENABLE_TEST_ROUTES !== "1") notFound();
  const P = av("ca").portal;
  return (
    <main className="mx-auto max-w-3xl space-y-4 p-4">
      <ol className="space-y-3">
        <li className="flex gap-3 rounded-xl border bg-white p-4" data-testid="confirm-item">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-navy font-bold text-white">1</span>
          <div className="space-y-2">
            <h3 className="font-semibold text-navy">Finestra del menjador més gran</h3>
            <div className="flex flex-wrap gap-3">
              <MarkerThumb url="/proves/visor/fixture?f=pdf" kind="pdf" page={1} x={0.4} y={0.3} label="1" width={180} />
              <MarkerThumb url="/proves/visor/fixture?f=pdf" kind="pdf" page={1} x={0.05} y={0.1} w={0.3} h={0.4} label="2" width={180} />
              <MarkerThumb url="/proves/visor/fixture?f=png" kind="image" page={1} x={0.25} y={0.75} label="3" width={180} />
            </div>
          </div>
        </li>
      </ol>
      <ConfirmSubmit projectId="00000000-0000-0000-0000-0000000000aa" draftId="00000000-0000-0000-0000-0000000000dd"
        messages={actionMessages("ca")} texts={{ check: P.confirmCheck, send: P.send(2), sending: P.sending }} />
    </main>
  );
}
