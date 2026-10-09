import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../lib/integrations/public-url.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module = { exports: {} };
const require = (specifier) => import(specifier);
const wrapped = await import(`data:text/javascript;base64,${Buffer.from(compiled.replace(/require\("node:dns\/promises"\)/g, "({lookup: async () => []})").replace(/require\("node:net"\)/g, "({isIP: (value) => /^\\d+\\.\\d+\\.\\d+\\.\\d+$/.test(value) ? 4 : value.includes(\":\") ? 6 : 0})")).replace(/Object\.defineProperty\(exports, "__esModule", \{ value: true \}\);/, "").replace(/exports\.isPublicAddress = void 0;\s*exports\.isPublicHttpsUrlSyntax = void 0;\s*exports\.isPublicHttpsUrl = void 0;/, "").replace(/exports\.isPublicAddress = isPublicAddress;/, "").replace(/exports\.isPublicHttpsUrlSyntax = isPublicHttpsUrlSyntax;/, "").replace(/exports\.isPublicHttpsUrl = isPublicHttpsUrl;/, "").replace(/\bexports\./g, "const __unused = "), "base64")}` ).catch(() => null);
const actual = await import(`data:text/javascript;base64,${Buffer.from(source.replace('import { lookup } from "node:dns/promises";', 'const lookup = async () => [];').replace('import { isIP } from "node:net";', 'const isIP = (value) => /^\\d+\\.\\d+\\.\\d+\\.\\d+$/.test(value) ? 4 : value.includes(":") ? 6 : 0;').replace(/export function /g, 'function ').replace(/export async function /g, 'async function ') + "\nexport { isPublicAddress, isPublicHttpsUrlSyntax };").toString("base64")}`);
const { isPublicAddress, isPublicHttpsUrlSyntax } = actual;

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
