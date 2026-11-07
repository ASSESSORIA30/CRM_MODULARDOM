// Proxy (abans "middleware"): refresca la sessió de Supabase i fa la
// comprovació optimista d'autenticació. L'autorització real és a l'RLS
// i als Server Components.
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { readPublicSupabaseEnv } from "@/lib/env";

const PUBLIC_PATHS = ["/login", "/auth", "/configuracio-pendent", "/api/health"];

function isPublic(pathname: string) {
  // Rutes de proves automatitzades: només si s'activen explícitament (mai a producció)
  if (process.env.ENABLE_TEST_ROUTES === "1" && pathname.startsWith("/proves/")) return true;
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const env = readPublicSupabaseEnv();

  // Sense configuració: mostrar una pàgina explicativa en lloc d'un error.
  if (!env) {
    if (pathname === "/configuracio-pendent" || pathname === "/api/health") {
      return NextResponse.next();
    }
    return NextResponse.rewrite(new URL("/configuracio-pendent", request.url));
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(env.url, env.publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        toSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // getClaims() verifica el JWT; no confiar mai en getSession() al servidor.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);

  if (!signedIn && !isPublic(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname !== "/" ? `?next=${encodeURIComponent(pathname)}` : "";
    return NextResponse.redirect(url);
  }
  if (signedIn && pathname === "/login") {
    return NextResponse.redirect(new URL("/inici", request.url));
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|pdfjs/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
