// Proves del configurador del CRM (tarifa de la web, sense Supabase). Només amb ENABLE_TEST_ROUTES=1.
import { notFound } from "next/navigation";
import { ConfiguratorForm } from "@/components/configurator/configurator-form";
import { WEB_TARIFF_V3 } from "@/lib/configurator/tariff";
import { qx } from "@/lib/i18n-pressupostos-v2";
import { actionMessages } from "@/lib/messages";

export const dynamic = "force-dynamic";

export default function ConfiguradorProves() {
  if (process.env.ENABLE_TEST_ROUTES !== "1") notFound();
  return (
    <main className="mx-auto w-full min-w-0 max-w-7xl p-4">
      <ConfiguratorForm projectId="00000000-0000-0000-0000-0000000000aa" tariff={WEB_TARIFF_V3} tariffId="00000000-0000-0000-0000-0000000000bb"
        tariffLabel="Tarifa 1" X={qx("ca")} errors={actionMessages("ca").errors} showInternal defaultTitle="Habitatge de prova" />
    </main>
  );
}
