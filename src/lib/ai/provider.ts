// Proveïdor d'IA configurable. Només al servidor: la clau no arriba mai al navegador.
// Si no hi ha clau configurada, les funcions d'IA retornen "not_configured" i el
// client pot introduir els punts manualment (el flux no depèn de la IA).
import "server-only";

export type AiConfig = { provider: "anthropic"; apiKey: string; model: string };

export function aiConfig(): AiConfig | null {
  const provider = process.env.AI_PROVIDER ?? "anthropic";
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (provider !== "anthropic" || !apiKey) return null;
  return { provider: "anthropic", apiKey, model: process.env.AI_MODEL || "claude-sonnet-5-5" };
}

type Block =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "url"; url: string } };

/**
 * Crida el model obligant-lo a respondre amb una eina amb esquema JSON (sortida estructurada).
 * Retorna l'objecte d'entrada de l'eina (encara NO validat: cal validar-lo sempre).
 */
export async function structuredCall(opts: {
  system: string;
  content: Block[];
  toolName: string;
  toolDescription: string;
  inputSchema: Record<string, unknown>;
  maxTokens?: number;
}): Promise<{ ok: true; data: unknown; model: string } | { ok: false; error: "not_configured" | "provider_error" }> {
  const cfg = aiConfig();
  if (!cfg) return { ok: false, error: "not_configured" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": cfg.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: opts.maxTokens ?? 4000,
        temperature: 0,
        system: opts.system,
        messages: [{ role: "user", content: opts.content }],
        tools: [{ name: opts.toolName, description: opts.toolDescription, input_schema: opts.inputSchema }],
        tool_choice: { type: "tool", name: opts.toolName },
      }),
    });
    if (!res.ok) {
      console.error("[ai] error", res.status);
      return { ok: false, error: "provider_error" };
    }
    const json = (await res.json()) as { content?: { type: string; name?: string; input?: unknown }[] };
    const tool = json.content?.find((c) => c.type === "tool_use" && c.name === opts.toolName);
    if (!tool) return { ok: false, error: "provider_error" };
    return { ok: true, data: tool.input, model: cfg.model };
  } catch (e) {
    console.error("[ai] excepció", e instanceof Error ? e.name : "desconeguda");
    return { ok: false, error: "provider_error" };
  } finally {
    clearTimeout(timer);
  }
}
