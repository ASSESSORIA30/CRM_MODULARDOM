"use client";

import { useActionState } from "react";
import { signIn, type LoginState } from "./actions";
import type { Dict } from "@/lib/i18n";

export function LoginForm({ next, d }: { next?: string; d: Dict }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(signIn, undefined);

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="next" value={next ?? ""} />
      <label className="block">
        <span className="text-sm font-medium text-navy">{d.email}</span>
        <input
          name="email" type="email" autoComplete="email" required
          className="mt-1 block w-full rounded-md border border-navy/20 bg-white px-3 py-2.5 outline-none focus:border-gold focus:ring-2 focus:ring-gold/30"
        />
      </label>
      <label className="block">
        <span className="text-sm font-medium text-navy">{d.password}</span>
        <input
          name="password" type="password" autoComplete="current-password" required
          className="mt-1 block w-full rounded-md border border-navy/20 bg-white px-3 py-2.5 outline-none focus:border-gold focus:ring-2 focus:ring-gold/30"
        />
      </label>
      {state?.error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error === "invalid" ? d.invalidCredentials : d.genericError}
        </p>
      )}
      <button
        type="submit" disabled={pending}
        className="w-full rounded-md bg-navy px-4 py-2.5 font-semibold text-white transition hover:bg-navy-dark disabled:opacity-60"
      >
        {pending ? "…" : d.signIn}
      </button>
    </form>
  );
}
