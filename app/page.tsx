const capabilities = [
  { number: "01", title: "Connect your channels", text: "Bring supported customer conversations and business systems into one workspace." },
  { number: "02", title: "Ground every answer", text: "Use your approved products, prices and business rules—not invented catalog details." },
  { number: "03", title: "Move sales forward", text: "Qualify customers, support order workflows and hand off to your team when needed." },
];
const channels = ["WhatsApp", "Instagram", "Facebook", "Email", "Website", "Shopify", "WooCommerce"];
const workflow = [
  { label: "Customer message", text: "A customer asks about a product or service." },
  { label: "Business context", text: "The agent checks connected, approved information." },
  { label: "Helpful next step", text: "Respond, guide the sale or request a human handoff." },
];
export default function Home() {
  return (
    <main className="shell landing">
      <header className="top landing-top">
        <a className="brand" href="/" aria-label="EasyReach home">EasyReach</a>
        <div className="landing-top-actions">
          <span className="pill">AI Sales Workforce</span>
          <a className="top-signin" href="/signin">Sign in <span aria-hidden="true">↗</span></a>
        </div>
      </header>

      <section className="hero landing-hero">
        <div className="landing-copy">
          <div className="eyebrow"><span className="eyebrow-dot" /> SIMPLE FOR PEOPLE. POWERFUL FOR BUSINESS.</div>
          <h1>One business brain.<br /><span>Every customer channel.</span></h1>
          <p>Give your customers a faster, more consistent sales experience—powered by your real business information and connected channels.</p>
          <div className="actions">
            <a className="button" href="/signup">Start free <span aria-hidden="true">→</span></a>
            <a className="button secondary" href="#how-it-works">Explore how it works</a>
          </div>
          <div className="landing-trust"><span aria-hidden="true">✓</span> Real connections. Verified business data. Human handoff when needed.</div>
        </div>

        <div className="product-preview" aria-label="Illustration of the EasyReach sales workflow">
          <div className="preview-topline"><span className="preview-mark">ER</span><div><strong>EasyReach workspace</strong><small>Connected sales workflow</small></div><span className="preview-live"><i /> WORKFLOW</span></div>
          <div className="preview-divider" />
          <div className="preview-heading"><div><span className="preview-kicker">THE SALES LOOP</span><h2>From first message<br />to next best action.</h2></div><span className="preview-orbit" aria-hidden="true"><span>AI</span></span></div>
          <div className="preview-flow">
            {workflow.map((item, index) => <div className="preview-flow-row" key={item.label}><span className={"flow-number flow-number-" + index}>{String(index + 1).padStart(2, "0")}</span><div><strong>{item.label}</strong><p>{item.text}</p></div>{index < workflow.length - 1 && <span className="flow-arrow" aria-hidden="true">↓</span>}</div>)}
          </div>
          <div className="preview-footer"><span className="preview-pulse" /> Built around your business rules <span className="preview-footer-lock" aria-hidden="true">◇</span></div>
        </div>
      </section>

      <section className="channel-strip" aria-label="Supported channel categories">
        <span className="channel-strip-label">MEET CUSTOMERS WHERE THEY ARE</span>
        <div className="channel-chips">{channels.map((channel) => <span className="channel-chip" key={channel}>{channel}</span>)}</div>
        <p>Availability depends on each provider’s integration and account permissions.</p>
      </section>

      <section id="how-it-works" className="landing-section">
        <div className="landing-section-heading"><div className="eyebrow">A clearer way to sell</div><h2>One workflow. Built around your business.</h2><p>Connect the tools you use, give the agent reliable context, and keep your team in control.</p></div>
        <div className="landing-capabilities">{capabilities.map((item) => <article className="capability-card" key={item.number}><span className="capability-number">{item.number}</span><h3>{item.title}</h3><p>{item.text}</p><span className="capability-line" /></article>)}</div>
      </section>

      <section className="landing-cta"><div><div className="eyebrow">Start with your business</div><h2>Make every customer conversation count.</h2><p>Set up your workspace and connect the channels your business actually uses.</p></div><a className="button" href="/signup">Create your workspace <span aria-hidden="true">→</span></a></section>
      <footer className="landing-footer"><a className="brand" href="/">EasyReach</a><span>Simple for people. Powerful for business.</span><a href="/signin">Sign in to your workspace</a></footer>
    </main>
  );
}