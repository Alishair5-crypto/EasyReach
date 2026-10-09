import { afterEach, describe, expect, it, vi } from "vitest";

import { configureEvolutionWebhook, getEvolutionQr, getEvolutionStatus, isSafeEvolutionBaseUrl, normalizeEvolutionConnectionState } from "../../lib/integrations/whatsapp";

const publicResolver = async (_hostname: string, _options: { all: true; verbatim: true }) => [{ address: "93.184.216.34", family: 4 }];

const secret = {
  base_url: "https://evolution.example",
  api_key: "test-api-key",
  instance_name: "easyreach-test",
};

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("Evolution API v2 QR flow", () => {
  it("requests the real QR from the v2 GET connect endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ base64: "abc", code: "pair-code" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getEvolutionQr(secret, publicResolver)).resolves.toMatchObject({ base64: "abc", code: "pair-code" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://evolution.example/instance/connect/easyreach-test",
      expect.objectContaining({ method: "GET", headers: expect.objectContaining({ apikey: "test-api-key" }) }),
    );
  });

  it("creates a missing instance once, then requests its QR", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ instance: { instanceName: "easyreach-test" } }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ base64: "fresh-qr" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getEvolutionQr(secret)).resolves.toMatchObject({ base64: "fresh-qr" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][0]).toBe("https://evolution.example/instance/create");
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toMatchObject({
      instanceName: "easyreach-test",
      integration: "WHATSAPP-BAILEYS",
      qrcode: true,
    });
    expect(fetchMock.mock.calls[2][0]).toBe("https://evolution.example/instance/connect/easyreach-test");
  });

  it("does not create an instance when Evolution rejects the request for another reason", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("unauthorized", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getEvolutionQr(secret)).rejects.toThrow("whatsapp_evolution_qr_failed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses the Evolution API v2 connection-state endpoint for verification", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ instance: { state: "close" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getEvolutionStatus(secret, publicResolver)).resolves.toMatchObject({ instance: { state: "close" } });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://evolution.example/instance/connectionState/easyreach-test",
      expect.objectContaining({ headers: expect.objectContaining({ apikey: "test-api-key" }) }),
    );
  });

  it("rejects missing Evolution credentials without making a network request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(getEvolutionQr({ ...secret, api_key: "" })).rejects.toThrow("whatsapp_evolution_credentials_invalid");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Evolution connection-state normalization", () => {
  it.each([
    [{ instance: { state: "open" } }, "connected"],
    [{ instance: { state: "connected" } }, "connected"],
    [{ instance: { state: "connecting" } }, "connecting"],
    [{ instance: { state: "close" } }, "disconnected"],
    [{ instance: { state: "closed" } }, "disconnected"],
    [{ instance: { state: "qr" } }, "qr_ready"],
    [{ instance: { state: "unexpected" } }, "preparing"],
    [{}, "preparing"],
  ])("normalizes provider payload %j without false connected claims", (payload, expected) => {
    expect(normalizeEvolutionConnectionState(payload as Record<string, unknown>)).toBe(expected);
  });
});

describe("Evolution webhook setup", () => {
  it("registers the public webhook with the tenant-specific shared secret and required events", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://easyreach.example");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ webhook: { enabled: true } }), {
      status: 201,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(configureEvolutionWebhook({ ...secret, webhook_secret: "tenant-webhook-secret" }, publicResolver))
      .resolves.toMatchObject({ configured: true, url: "https://easyreach.example/api/webhooks/whatsapp" });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://evolution.example/webhook/set/easyreach-test",
      expect.objectContaining({
        method: "POST",
        redirect: "error",
        headers: expect.objectContaining({ apikey: "test-api-key" }),
      }),
    );
    const payload = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(payload).toMatchObject({
      enabled: true,
      url: "https://easyreach.example/api/webhooks/whatsapp",
      webhookByEvents: false,
      webhookBase64: false,
      events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE"],
      headers: { "x-easyreach-webhook-secret": "tenant-webhook-secret" },
    });
  });

  it("fails closed if Evolution rejects webhook registration", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://easyreach.example");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("forbidden", { status: 403 })));
    await expect(configureEvolutionWebhook({ ...secret, webhook_secret: "tenant-webhook-secret" }))
      .rejects.toThrow("whatsapp_evolution_webhook_config_failed");
  });
});

describe("Evolution target validation", () => {
  it.each([
    "http://evolution.example",
    "https://localhost",
    "https://127.0.0.1",
    "https://10.0.0.1",
    "https://[::1]",
    "https://evolution.local",
    "https://user:password@evolution.example",
    "https://evolution.example?token=secret",
  ])("rejects unsafe provider URL %s before making a request", async (url) => {
    await expect(isSafeEvolutionBaseUrl(url)).resolves.toBe(false);
  });

  it("accepts a public DNS hostname when all resolved addresses are public", async () => {
    await expect(isSafeEvolutionBaseUrl("https://evolution.example", publicResolver)).resolves.toBe(true);
  });

});
