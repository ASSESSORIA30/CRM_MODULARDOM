// Resultat del motor de càlcul per a una configuració (proves de comparació amb la web). Només amb ENABLE_TEST_ROUTES=1.
import { NextResponse } from "next/server";
import { calculate, validateInput, type ConfigInput } from "@/lib/configurator/engine";
import { tariffSchema, WEB_TARIFF_V3 } from "@/lib/configurator/tariff";

export async function GET(req: Request) {
  if (process.env.ENABLE_TEST_ROUTES !== "1") return new NextResponse("Not found", { status: 404 });
  const sp = new URL(req.url).searchParams;
  const cfg = JSON.parse(sp.get("cfg") ?? "{}") as ConfigInput;
  const t = sp.get("tarifa") ? tariffSchema.safeParse(JSON.parse(sp.get("tarifa")!)) : { success: true as const, data: WEB_TARIFF_V3 };
  if (!t.success) return NextResponse.json({ error: "tarifa" }, { status: 400 });
  const issues = validateInput(t.data, cfg);
  if (issues.length) return NextResponse.json({ issues }, { status: 400 });
  return NextResponse.json(calculate(t.data, cfg));
}
