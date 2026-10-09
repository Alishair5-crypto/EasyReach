import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(new URL("../lib/integrations/whatsapp-status.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exports = {};
vm.runInNewContext(compiled, { exports, String, Object, Array });
const { normalizeEvolutionConnectionStatus } = exports;

test("normalizes Evolution open and connected provider states", () => {
  for (const payload of [
    { state: "open" },
    { state: "CONNECTED" },
    { instance: { state: "open" } },
    { connectionState: { instance: { state: "open" } } },
    { data: { state: "connected" } },
  ]) assert.equal(normalizeEvolutionConnectionStatus(payload), "connected");
});

test("preserves non-connected Evolution states instead of reporting false success", () => {
  assert.equal(normalizeEvolutionConnectionStatus({ state: "connecting" }), "connecting");
  assert.equal(normalizeEvolutionConnectionStatus({ state: "qr" }), "connecting");
  assert.equal(normalizeEvolutionConnectionStatus({ state: "close" }), "disconnected");
  assert.equal(normalizeEvolutionConnectionStatus({ state: "closed" }), "disconnected");
  assert.equal(normalizeEvolutionConnectionStatus({ state: "disconnected" }), "disconnected");
  assert.equal(normalizeEvolutionConnectionStatus({ state: "unknown" }), "preparing");
  assert.equal(normalizeEvolutionConnectionStatus(null), "preparing");
});
