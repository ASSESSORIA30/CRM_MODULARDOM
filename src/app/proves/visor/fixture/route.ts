import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

// Plànols de prova (sense dades reals). Només amb ENABLE_TEST_ROUTES=1.
export async function GET(request: NextRequest) {
  if (process.env.ENABLE_TEST_ROUTES !== "1") return new NextResponse(null, { status: 404 });
  const png = request.nextUrl.searchParams.get("f") === "png";
  const file = join(process.cwd(), "tests", "fixtures", "plans", png ? "distribucio-prova.png" : "planol-prova.pdf");
  const body = await readFile(file);
  return new NextResponse(body, { headers: { "content-type": png ? "image/png" : "application/pdf" } });
}
