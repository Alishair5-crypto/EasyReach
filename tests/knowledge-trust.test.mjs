import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../lib/ai/knowledge-trust.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const trust = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const day = 24 * 60 * 60 * 1000;
const now = Date.parse("2026-10-09T00:00:00.000Z");

test("recently verified manual knowledge is eligible", () => {
  const [row] = trust.annotateKnowledgeTrust([{ title: "Returns", content: "Returns within 7 days", verified_at: new Date(now - 10 * day).toISOString() }], now);
  assert.equal(row.freshness_status, "current");
  assert.equal(row.conflict_status, "none");
  assert.equal(row.authoritative_eligible, true);
});

test("manual knowledge older than 180 days is not authoritative", () => {
  const [row] = trust.annotateKnowledgeTrust([{ title: "Returns", content: "Returns within 7 days", verified_at: new Date(now - 181 * day).toISOString() }], now);
  assert.equal(row.freshness_status, "stale");
  assert.equal(row.authoritative_eligible, false);
  assert.equal(row.trust_reason, "source_refresh_required");
});

test("URL-backed knowledge older than 30 days is not authoritative", () => {
  const [row] = trust.annotateKnowledgeTrust([{ title: "Shipping", content: "Ships in 3 days", source_url: "https://shop.example/shipping", last_synced_at: new Date(now - 31 * day).toISOString(), verified_at: new Date(now - 2 * day).toISOString() }], now);
  assert.equal(row.freshness_status, "stale");
  assert.equal(row.authoritative_eligible, false);
});

test("missing verification timestamps are not silently treated as fresh", () => {
  const [row] = trust.annotateKnowledgeTrust([{ title: "Payments", content: "Cash on delivery" }], now);
  assert.equal(row.freshness_status, "unknown");
  assert.equal(row.authoritative_eligible, false);
});

test("same-title records with conflicting content are flagged and ineligible", () => {
  const rows = trust.annotateKnowledgeTrust([
    { title: "Returns", content: "Returns within 7 days", verified_at: new Date(now - day).toISOString() },
    { title: " returns ", content: "No returns accepted", verified_at: new Date(now - day).toISOString() },
  ], now);
  assert.equal(rows[0].conflict_status, "possible_conflict");
  assert.equal(rows[1].conflict_status, "possible_conflict");
  assert.equal(rows.every((row) => !row.authoritative_eligible), true);
});


test("freshness boundaries are inclusive at 30 and 180 days", () => {
  const [externalBoundary, externalExpired, manualBoundary, manualExpired] = trust.annotateKnowledgeTrust([
    { title: "External boundary", content: "Policy A", source_url: "https://shop.example/a", last_synced_at: new Date(now - 30 * day).toISOString() },
    { title: "External expired", content: "Policy B", source_url: "https://shop.example/b", last_synced_at: new Date(now - 30 * day - 1).toISOString() },
    { title: "Manual boundary", content: "Policy C", verified_at: new Date(now - 180 * day).toISOString() },
    { title: "Manual expired", content: "Policy D", verified_at: new Date(now - 180 * day - 1).toISOString() },
  ], now);
  assert.equal(externalBoundary.freshness_status, "current");
  assert.equal(externalExpired.freshness_status, "stale");
  assert.equal(manualBoundary.freshness_status, "current");
  assert.equal(manualExpired.freshness_status, "stale");
});

test("future-dated or malformed freshness evidence is unknown and ineligible", () => {
  const [futureExternal, futureManual, malformed] = trust.annotateKnowledgeTrust([
    { title: "Future sync", content: "Policy A", source_url: "https://shop.example/a", last_synced_at: new Date(now + day).toISOString() },
    { title: "Future verification", content: "Policy B", verified_at: new Date(now + day).toISOString() },
    { title: "Malformed timestamp", content: "Policy C", verified_at: "not-a-date" },
  ], now);
  for (const row of [futureExternal, futureManual, malformed]) {
    assert.equal(row.freshness_status, "unknown");
    assert.equal(row.authoritative_eligible, false);
    assert.equal(row.trust_reason, "verification_timestamp_invalid");
  }
});
