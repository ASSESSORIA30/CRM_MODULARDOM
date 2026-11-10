"use client";
import { BellRing, Flame, Network, Package, ShieldCheck, Smartphone, Sun, Wifi, Zap } from "lucide-react";
import type { ServiceFamily } from "@/core/multiservice";

const ICON: Record<ServiceFamily, { I: typeof Zap; color: string }> = {
  electricitat: { I: Zap, color: "text-amber-500" },
  gas: { I: Flame, color: "text-orange-500" },
  fibra: { I: Wifi, color: "text-sky-600" },
  mobil: { I: Smartphone, color: "text-indigo-600" },
  fibra_mobil: { I: Network, color: "text-violet-600" },
  assegurances: { I: ShieldCheck, color: "text-emerald-600" },
  alarmes: { I: BellRing, color: "text-rose-600" },
  plaques_solars: { I: Sun, color: "text-yellow-500" },
  altres: { I: Package, color: "text-zinc-500" },
};
export function FamilyIcon({ family, size = 16 }: { family: ServiceFamily; size?: number }) {
  const { I, color } = ICON[family];
  return <I size={size} className={color} aria-hidden />;
}
