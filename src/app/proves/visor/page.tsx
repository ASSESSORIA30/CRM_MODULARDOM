// Pàgina de proves automatitzades del visor (Playwright).
// Només existeix si ENABLE_TEST_ROUTES=1. Mai s'activa a Vercel.
import { notFound } from "next/navigation";
import { Harness } from "./harness";

export const dynamic = "force-dynamic";

export default async function VisorProves({ searchParams }: { searchParams: Promise<{ img?: string }> }) {
  if (process.env.ENABLE_TEST_ROUTES !== "1") notFound();
  const { img } = await searchParams;
  return (
    <main className="mx-auto w-full max-w-5xl p-3">
      <Harness source={img === "1" ? { kind: "image", url: "/proves/visor/fixture?f=png" } : { kind: "pdf", url: "/proves/visor/fixture?f=pdf" }} />
    </main>
  );
}
