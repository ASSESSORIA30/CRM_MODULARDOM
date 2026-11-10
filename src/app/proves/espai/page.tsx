// Pàgina de proves de l'espai de treball (dades fictícies). Només amb ENABLE_TEST_ROUTES=1.
import { notFound } from "next/navigation";
import { PlanWorkspace } from "@/components/avantprojecte/plan-workspace";
import { av } from "@/lib/i18n-avantprojecte";
import { actionMessages } from "@/lib/messages";

export const dynamic = "force-dynamic";

export default function EspaiProves() {
  if (process.env.ENABLE_TEST_ROUTES !== "1") notFound();
  const T = av("ca");
  const messages = actionMessages("ca");
  const pid = "00000000-0000-0000-0000-0000000000aa";
  return (
    <main className="mx-auto w-full max-w-7xl p-3">
      <PlanWorkspace
        projectId={pid} documentId="00000000-0000-0000-0000-0000000000bb"
        source={{ kind: "pdf", url: "/proves/visor/fixture?f=pdf" }}
        staff
        items={[{ id: "00000000-0000-0000-0000-0000000000c1", label: "R1.1 · Ampliar la cuina" }]}
        annotations={[
          { id: "a1", page: 1, kind: "punt", x: 0.4, y: 0.3, label: "1", tone: "client", body: "Vull que aquesta finestra sigui més ampla",
            author: "Client Prova", when: "07/11/2026 19:00", visibility: "compartit", status: "obert", itemLabel: "R1.1 · Ampliar la cuina",
            parentLabel: null, attachments: [{ id: "f1", title: "Finestra de referència", href: "/proves/visor/fixture?f=png", isImage: true }] },
          { id: "a2", page: 1, kind: "rectangle", x: 0.05, y: 0.1, w: 0.3, h: 0.4, label: "2", tone: "arquitecte", body: "Proposta alternativa",
            author: "Arquitecte Prova", when: "07/11/2026 19:30", visibility: "compartit", status: "obert", itemLabel: null, parentLabel: "1", attachments: [] },
          { id: "a3", page: 1, kind: "punt", x: 0.7, y: 0.7, label: "3", tone: "intern", body: "Revisar càrregues", author: "Direcció",
            when: "07/11/2026 19:40", visibility: "intern", status: "obert", itemLabel: null, parentLabel: null, attachments: [] },
        ]}
        threads={{ a1: [
          { id: "c1", parentId: null, body: "Pot ser corredissa?", author: "Client Prova", role: "client", visibility: "compartit", when: "19:05", resolved: false },
          { id: "c2", parentId: "c1", body: "Ho estudiem.", author: "Arquitecte Prova", role: "arquitecte", visibility: "compartit", when: "19:10", resolved: false },
          { id: "c3", parentId: null, body: "Nota: consultar estructurista", author: "Direcció", role: "direccio", visibility: "intern", when: "19:20", resolved: false },
        ] }}
        participants={[{ id: "p1", name: "Arquitecte Prova", isClient: false }, { id: "p2", name: "Client Prova", isClient: true }]}
        messages={messages} rules={[{ extension: "jpg", mime_type: "image/jpeg", max_bytes: 20971520 }]}
        categories={Object.entries(T.categories).map(([value, label]) => ({ value, label }))}
        rooms={Object.entries(T.rooms).map(([value, label]) => ({ value, label }))}
        texts={{
          viewer: T.viewer, thread: T.thread, uploader: { ...T.uploader, errors: messages.errors }, newMarker: T.newMarker, comment: T.comment,
          linkItem: T.linkItem, replyTo: T.replyTo, none: T.none, save: T.save, cancel: T.cancel, shared: T.shared, internal: T.internal,
          resolve: T.resolve, reopen: T.reopen, attachPhoto: T.attachPhoto, author: T.author, item: T.item, noSelection: T.noSelection,
          respondsTo: T.respondsTo,
        }}
      />
    </main>
  );
}
