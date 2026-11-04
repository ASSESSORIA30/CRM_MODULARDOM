"use client";

import Link from "next/link";
import { useActionState } from "react";
import { setPassword, type PasswordState } from "./actions";
import type { Dict } from "@/lib/i18n";

export function PasswordForm({ d }: { d: Dict }) {
  const [state, action, pending] = useActionState<PasswordState, FormData>(setPassword, undefined);
  if (state?.ok) {
    return (
      <p className="text-navy">
        {d.passwordSaved} <Link href="/inici" className="font-semibold underline">{d.home}</Link>
      </p>
    );
  }
  return (
    <form action={action} className="space-y-4">
      <input
        name="password" type="password" autoComplete="new-password" minLength={12} required
        className="block w-full rounded-md border border-navy/20 px-3 py-2.5 outline-none focus:border-gold focus:ring-2 focus:ring-gold/30"
      />
      {state?.error && (
        <p role="alert" className="text-sm text-red-700">
          {state.error === "short" ? d.passwordTooShort : d.genericError}
        </p>
      )}
      <button disabled={pending} className="w-full rounded-md bg-navy px-4 py-2.5 font-semibold text-white hover:bg-navy-dark disabled:opacity-60">
        {d.setPassword}
      </button>
    </form>
  );
}
