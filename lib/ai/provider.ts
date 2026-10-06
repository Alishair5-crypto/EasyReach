export type AIMessage = { role: "system" | "user" | "assistant"; content: string };
export type AIResult = { text: string; model: string; provider: string; inputTokens?: number; outputTokens?: number };

export async function generateAI(messages: AIMessage[]): Promise<AIResult> {
  const key = process.env.AI_GATEWAY_API_KEY;
  if (!key) throw new Error("AI_PROVIDER_NOT_CONFIGURED");
  const model = process.env.EASYREACH_AI_MODEL || "openai/gpt-5.4-mini";
  const response = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages, temperature: 0.2 }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("AI_PROVIDER_ERROR");
  const data = await response.json();
  return { text: data.choices?.[0]?.message?.content ?? "", model, provider: "vercel-ai-gateway", inputTokens: data.usage?.prompt_tokens, outputTokens: data.usage?.completion_tokens };
}
