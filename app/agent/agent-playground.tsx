"use client";

import { FormEvent, useRef, useState } from "react";

type Agent = { id: string; name: string; status: string; language_mode: string | null };
type Message = { id: string; role: "user" | "assistant"; text: string };

function friendlyError(code: string) {
  const messages: Record<string, string> = {
    ai_provider_not_configured: "The AI provider is not configured for this deployment yet.",
    ai_provider_rate_limit: "The AI provider is busy. Please wait a moment and try again.",
    usage_limit_exceeded: "This workspace has reached its current AI message allowance.",
    usage_limit_not_configured: "AI usage limits are not configured for this workspace.",
    agent_not_active: "Activate the agent through the approved setup process before testing it.",
    agent_required: "This workspace needs an AI agent before it can run a test.",
    feature_not_entitled: "The current plan does not include this action.",
    plan_inactive: "The workspace plan is not active.",
  };
  return messages[code] ?? "The test message could not be completed. Please try again.";
}

export default function AgentPlayground({ agent }: { agent: Agent }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [conversationId, setConversationId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  const active = agent.status === "active";

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || busy || !active) return;
    setDraft("");
    setError("");
    setMessages(current => [...current, { id: crypto.randomUUID(), role: "user", text }]);
    setBusy(true);
    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text, ...(conversationId ? { conversationId } : {}) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "ai_request_failed");
      if (typeof result.conversationId === "string") setConversationId(result.conversationId);
      setMessages(current => [...current, { id: crypto.randomUUID(), role: "assistant", text: String(result.text ?? "No response text was returned.") }]);
      requestAnimationFrame(() => bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" }));
    } catch (cause) {
      setError(friendlyError(cause instanceof Error ? cause.message : ""));
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    if (busy) return;
    setMessages([]);
    setConversationId("");
    setDraft("");
    setError("");
  }

  return (
    <div className="agent-playground">
      <section className="card agent-summary">
        <div className="agent-summary-mark" aria-hidden="true">AI</div>
        <div className="agent-summary-copy"><span className="eyebrow">Selected agent</span><h2>{agent.name}</h2><p className="muted">Language mode: {agent.language_mode || "automatic"}</p></div>
        <span className={"status " + (active ? "good" : "bad")}>{agent.status}</span>
      </section>
      <section className="card agent-chat" aria-label="AI agent test conversation">
        <header className="agent-chat-head"><div><h2>Conversation test</h2><p className="muted">Ask about your business, products or sales process.</p></div><button type="button" className="button secondary small" onClick={reset} disabled={busy || messages.length === 0}>New test</button></header>
        <div className="agent-chat-messages" aria-live="polite" aria-relevant="additions text">
          {messages.length === 0 ? <div className="agent-chat-empty"><span className="agent-chat-orb" aria-hidden="true">✦</span><strong>Try a real customer question</strong><p className="muted">For example: “What products do you have available?” The agent will only use verified workspace data.</p></div> : messages.map(message => <div className={"agent-chat-message " + message.role} key={message.id}><span className="agent-chat-role">{message.role === "user" ? "YOU" : agent.name.toUpperCase()}</span><p>{message.text}</p></div>)}
          {busy && <div className="agent-thinking" role="status"><span /><span /><span /> Agent is checking business context…</div>}
          <div ref={bottom} />
        </div>
        {!active && <div className="error-card">This agent is not active, so messages are disabled until the agent is configured and activated.</div>}
        {error && <div className="error-card" role="alert" aria-live="polite">{error}</div>}
        <form className="agent-chat-compose" onSubmit={send}>
          <label className="sr-only" htmlFor="agent-message">Message to test the AI agent</label>
          <textarea id="agent-message" value={draft} onChange={e => setDraft(e.target.value)} placeholder={active ? "Ask a question about your business…" : "Activate the agent before sending a test"} disabled={!active || busy} rows={2} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} />
          <button className="button" type="submit" disabled={!active || busy || !draft.trim()}>{busy ? "Testing…" : "Send test"}</button>
        </form>
        <p className="agent-disclaimer">Test messages are saved in your workspace conversation history and count toward your plan’s AI usage. No live customer is contacted by this playground.</p>
      </section>
    </div>
  );
}