export type EvolutionConnectionStatus = "connected" | "connecting" | "disconnected" | "preparing";

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim().toLowerCase();
  }
  return "";
}

export function normalizeEvolutionConnectionStatus(payload: unknown): EvolutionConnectionStatus {
  if (!payload || typeof payload !== "object") return "preparing";
  const value = payload as Record<string, any>;
  const state = firstString(
    value.instance?.state,
    value.instanceState,
    value.state,
    value.connectionState?.instance?.state,
    value.connectionState?.state,
    value.data?.instance?.state,
    value.data?.state,
  );
  if (state === "open" || state === "connected") return "connected";
  if (state === "connecting" || state === "pairing" || state === "qr") return "connecting";
  if (state === "close" || state === "closed" || state === "disconnected") return "disconnected";
  return "preparing";
}
