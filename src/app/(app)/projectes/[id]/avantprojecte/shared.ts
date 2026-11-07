import "server-only";
import type { CurrentProfile } from "@/lib/auth";
import { av } from "@/lib/i18n-avantprojecte";
import { actionMessages } from "@/lib/messages";
import type { Person } from "@/lib/avantprojecte-data";

export type TabProps = { projectId: string; profile: CurrentProfile };

/** Textos serialitzables per als components client del mòdul */
export function clientTexts(profile: CurrentProfile) {
  const T = av(profile.locale);
  const messages = actionMessages(profile.locale);
  return {
    T,
    messages,
    uploader: { ...T.uploader, errors: messages.errors },
    categories: Object.entries(T.categories).map(([value, label]) => ({ value, label })),
    rooms: Object.entries(T.rooms).map(([value, label]) => ({ value, label })),
  };
}

export function mentionable(people: Map<string, Person>, meId: string) {
  return [...people.values()].filter((p) => p.id !== meId).map((p) => ({ id: p.id, name: p.name, isClient: p.role === "client" }));
}
