import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(new URL("../lib/integrations/safe-evolution-fetch.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const realRequire = createRequire(import.meta.url);
let dnsAddresses;
let responseChunks;
let requestCalls;
let lastRequest;
let lastOptions;

class MockRequest extends EventEmitter {
  constructor(url, options, callback) {
    super();
    this.url = url;
    this.options = options;
    this.callback = callback;
    this.writes = [];
    this.destroyed = false;
    lastRequest = this;
    lastOptions = options;
  }
  setTimeout(ms, callback) { this.timeoutMs = ms; this.timeoutCallback = callback; }
  write(value) { this.writes.push(value); }
  end() {
    queueMicrotask(() => {
      if (this.destroyed) return;
      this.options.lookup(this.options.hostname, {}, (error, address, family) => {
        if (error) { this.emit("error", error); return; }
        this.lookupResult = { address, family };
        const response = new EventEmitter();
        response.headers = { "content-type": "application/json" };
        response.statusCode = 200;
        response.statusMessage = "OK";
        this.callback(response);
        for (const chunk of responseChunks) response.emit("data", chunk);
        response.emit("end");
      });
    });
  }
  destroy(error) {
    this.destroyed = true;
    if (error) queueMicrotask(() => this.emit("error", error));
    return this;
  }
}

function loadModule() {
  requestCalls = 0;
  lastRequest = undefined;
  lastOptions = undefined;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    require: (name) => {
      if (name === "node:https") return { request: (...args) => {
        requestCalls += 1;
        return new MockRequest(...args);
      }};
      if (name === "node:dns/promises") return { lookup: async () => dnsAddresses };
      if (name === "./public-url") return {
        isPublicHttpsUrlSyntax: (value) => value.startsWith("https://evolution.example.com"),
        isPublicAddress: (value) => value === "93.184.216.34" || value === "2606:4700:4700::1111",
      };
      return realRequire(name);
    },
    URL, Headers, Response, Buffer, Promise, Error, Object, Array, String,
  });
  return exports.safeEvolutionFetch;
}

test("pins HTTPS requests to a validated DNS result and returns the provider response", async () => {
  dnsAddresses = [
    { address: "93.184.216.34", family: 4 },
    { address: "2606:4700:4700::1111", family: 6 },
  ];
  responseChunks = ['{"state":"open"}'];
  const safeEvolutionFetch = loadModule();
  const response = await safeEvolutionFetch("https://evolution.example.com/api/state", {
    method: "POST",
    headers: { apikey: "test-key", "content-type": "application/json" },
    body: '{"test":true}',
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { state: "open" });
  assert.equal(requestCalls, 1);
  assert.deepEqual(lastRequest.lookupResult, { address: "93.184.216.34", family: 4 });
  assert.equal(lastOptions.rejectUnauthorized, true);
  assert.equal(lastOptions.servername, "evolution.example.com");
  assert.equal(lastOptions.path, "/api/state");
  assert.equal(lastRequest.timeoutMs, 10_000);
  assert.deepEqual(lastRequest.writes, ['{"test":true}']);
});

test("rejects a DNS answer set containing a private address before opening a request", async () => {
  dnsAddresses = [
    { address: "93.184.216.34", family: 4 },
    { address: "10.0.0.7", family: 4 },
  ];
  responseChunks = [];
  const safeEvolutionFetch = loadModule();
  await assert.rejects(
    safeEvolutionFetch("https://evolution.example.com/api/state"),
    /whatsapp_evolution_url_rejected/,
  );
  assert.equal(requestCalls, 0);
});

test("rejects oversized provider responses instead of returning truncated or partial data", async () => {
  dnsAddresses = [{ address: "93.184.216.34", family: 4 }];
  responseChunks = [Buffer.alloc(1_000_001, 97)];
  const safeEvolutionFetch = loadModule();
  await assert.rejects(
    safeEvolutionFetch("https://evolution.example.com/api/state"),
    /whatsapp_evolution_response_too_large/,
  );
  assert.equal(lastRequest.destroyed, true);
});
