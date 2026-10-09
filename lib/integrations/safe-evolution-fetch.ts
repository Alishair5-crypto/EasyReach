import { request as httpsRequest, type RequestOptions } from "node:https";
import { lookup } from "node:dns/promises";
import { isPublicAddress, isPublicHttpsUrlSyntax } from "./public-url";

const MAX_RESPONSE_BYTES = 1_000_000;
const REQUEST_TIMEOUT_MS = 10_000;

export async function safeEvolutionFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
  const url = new URL(input);
  if (!isPublicHttpsUrlSyntax(url.toString())) throw new Error("whatsapp_evolution_url_rejected");
  // Deliberately return redirects to the caller; never forward provider credentials to another host.
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => !isPublicAddress(entry.address))) {
    throw new Error("whatsapp_evolution_url_rejected");
  }
  const selected = addresses[0];
  const method = init.method ?? "GET";
  const headers = new Headers(init.headers);
  const body = typeof init.body === "string" ? init.body : undefined;
  if (init.body !== undefined && body === undefined) throw new Error("whatsapp_evolution_request_body_unsupported");
  if (init.signal?.aborted) throw new Error("whatsapp_evolution_request_aborted");

  return await new Promise<Response>((resolve, reject) => {
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const succeed = (response: Response) => {
      if (settled) return;
      settled = true;
      resolve(response);
    };
    const options: RequestOptions = {
      protocol: "https:",
      hostname,
      port: url.port ? Number(url.port) : 443,
      path: url.pathname + url.search,
      method,
      headers: Object.fromEntries(headers.entries()),
      agent: false,
      servername: hostname,
      rejectUnauthorized: true,
      lookup: ((requestedHost: string, _options: unknown, callback: (...args: any[]) => void) => {
        if (requestedHost.toLowerCase() !== hostname.toLowerCase()) {
          callback(new Error("whatsapp_evolution_dns_host_mismatch"));
          return;
        }
        callback(null, selected.address, selected.family);
      }) as RequestOptions["lookup"],
    };
    const request = httpsRequest(url, options, (response) => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer | string) => {
        if (settled) return;
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > MAX_RESPONSE_BYTES) {
          const error = new Error("whatsapp_evolution_response_too_large");
          fail(error);
          request.destroy(error);
          return;
        }
        chunks.push(buffer);
      });
      response.on("end", () => {
        if (settled) return;
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(response.headers)) {
          if (typeof value === "string") responseHeaders.set(name, value);
          else if (Array.isArray(value)) responseHeaders.set(name, value.join(", "));
        }
        succeed(new Response(Buffer.concat(chunks), {
          status: response.statusCode ?? 502,
          statusText: response.statusMessage,
          headers: responseHeaders,
        }));
      });
      response.on("error", (error: Error) => fail(error));
    });
    request.setTimeout(REQUEST_TIMEOUT_MS, () => request.destroy(new Error("whatsapp_evolution_request_timeout")));
    request.on("error", (error: Error) => fail(error));
    if (init.signal) {
      init.signal.addEventListener("abort", () => request.destroy(new Error("whatsapp_evolution_request_aborted")), { once: true });
    }
    if (body !== undefined) request.write(body);
    request.end();
  });
}
