import { afterEach, describe, expect, it, vi } from "vitest";
import { getEvolutionQr, getEvolutionStatus, normalizeEvolutionConnectionState } from "../../lib/integrations/whatsapp";

const secret = {
  base_url: "https://evolution.example",
  api_key: "test-api-key",
  instance_name: "easyreach-test",
};

afterEach(() => vi.unstubAllGlobals());

describe("Evolution API v2 QR flow", () => {
  it("requests the real QR from the v2 GET connect endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ base64: "abc", code: "pair-code" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getEvolutionQr(secret)).resolves.toMatchObject({ base64: "abc", code: "pair-code" });
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

    await expect(getEvolutionStatus(secret)).resolves.toMatchObject({ instance: { state: "close" } });
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
