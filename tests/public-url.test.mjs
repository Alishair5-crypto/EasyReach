import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(new URL("../lib/integrations/public-url.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exports = {};
const realRequire = createRequire(import.meta.url);
vm.runInNewContext(compiled, {
  exports,
  require: (name) => name === "node:dns/promises"
    ? { lookup: async () => [] }
    : realRequire(name),
  URL,
  BigInt,
  Array,
  Number,
  String,
  RegExp,
  parseInt,
});
const { isPublicAddress, isPublicHttpsUrlSyntax } = exports;

test("Evolution base URL requires a public HTTPS hostname", () => {
  for (const value of ["http://example.com", "https://localhost", "https://127.0.0.1", "https://192.168.1.4", "https://user:pass@example.com", "https://service.local", "https://metadata.internal", "https://singlelabel"]) {
    assert.equal(isPublicHttpsUrlSyntax(value), false, value);
  }
  assert.equal(isPublicHttpsUrlSyntax("https://evolution.example.com"), true);
});
test("public-address classifier rejects common private, loopback, and reserved ranges", () => {
  for (const address of ["10.0.0.1", "127.0.0.1", "169.254.169.254", "172.16.0.1", "192.168.1.1", "100.64.0.1", "224.0.0.1", "::1", "fc00::1", "fe80::1", "ff02::1", "2001:db8::1"]) {
    assert.equal(isPublicAddress(address), false, address);
  }
  assert.equal(isPublicAddress("8.8.8.8"), true);
  assert.equal(isPublicAddress("2001:4860:4860::8888"), true);
});
