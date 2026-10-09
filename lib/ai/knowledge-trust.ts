export type KnowledgeTrustInput = {
  title?: string | null;
  content?: string | null;
  source_url?: string | null;
  last_synced_at?: string | null;
  verified_at?: string | null;
};

export type KnowledgeTrust = {
  freshness_status: "current" | "stale" | "unknown";
  conflict_status: "none" | "possible_conflict";
  authoritative_eligible: boolean;
  trust_reason: "current_verified_source" | "source_refresh_required" | "verification_timestamp_missing" | "verification_timestamp_invalid" | "conflicting_verified_documents";
  freshness_age_days: number | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const EXTERNAL_SOURCE_MAX_AGE_MS = 30 * DAY_MS;
const MANUAL_POLICY_MAX_AGE_MS = 180 * DAY_MS;

function normalized(value: string | null | undefined) {
  return (value ?? "").normalize("NFKC").trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

export function annotateKnowledgeTrust<T extends KnowledgeTrustInput>(rows: T[], now = Date.now()): Array<T & KnowledgeTrust> {
  const contentsByTitle = new Map<string, Set<string>>();
  for (const row of rows) {
    const title = normalized(row.title);
    const content = normalized(row.content);
    if (!title || !content) continue;
    const contents = contentsByTitle.get(title) ?? new Set<string>();
    contents.add(content);
    contentsByTitle.set(title, contents);
  }

  return rows.map((row) => {
    const hasExternalSource = Boolean(row.source_url?.trim());
    const timestamp = hasExternalSource ? row.last_synced_at : row.verified_at;
    const parsed = timestamp ? Date.parse(timestamp) : Number.NaN;
    const timestampProvided = Boolean(timestamp);
    const parsedTimestamp = Number.isFinite(parsed);
    const timestampInvalid = timestampProvided && (!parsedTimestamp || parsed > now);
    const validTimestamp = parsedTimestamp && parsed <= now;
    const ageMs = validTimestamp ? now - parsed : null;
    const maxAge = hasExternalSource ? EXTERNAL_SOURCE_MAX_AGE_MS : MANUAL_POLICY_MAX_AGE_MS;
    const freshness_status: KnowledgeTrust["freshness_status"] =
      !validTimestamp ? "unknown" : ageMs! > maxAge ? "stale" : "current";
    const title = normalized(row.title);
    const conflict = Boolean(title && (contentsByTitle.get(title)?.size ?? 0) > 1);
    const conflict_status: KnowledgeTrust["conflict_status"] = conflict ? "possible_conflict" : "none";
    const trust_reason: KnowledgeTrust["trust_reason"] = conflict
      ? "conflicting_verified_documents"
      : freshness_status === "stale"
        ? "source_refresh_required"
        : freshness_status === "unknown"
          ? timestampInvalid ? "verification_timestamp_invalid" : "verification_timestamp_missing"
          : "current_verified_source";
    return {
      ...row,
      freshness_status,
      conflict_status,
      authoritative_eligible: freshness_status === "current" && !conflict,
      trust_reason,
      freshness_age_days: ageMs === null ? null : Math.floor(ageMs / DAY_MS),
    };
  });
}
