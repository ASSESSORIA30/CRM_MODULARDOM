"use client";
/** Compatibilitat amb accions antigues: totes les propostes es preparen a Comparatives IA. */
import { useEffect } from "react";
import { useApp } from "@/data/store";

export function ProposalWizard() {
  const contractId = useApp(s => s.proposalFor);
  useEffect(() => {
    if (contractId) useApp.getState().startProposal({ contractId });
  }, [contractId]);
  return null;
}
