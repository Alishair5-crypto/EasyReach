import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/auth";

type Product = {
  id: string; name: string; description: string | null; category: string | null;
  price: number | null; sale_price: number | null; currency: string | null;
  availability: boolean | null; inventory_quantity: number | null; product_url: string | null;
  updated_at: string | null;
};

export default async function ProductsPage() {
  const { tenant, user, membership, supabase } = await getTenantContext();
  if (!tenant) redirect("/onboarding");
  const [{ data, error }, { count }] = await Promise.all([
    supabase.from("products").select("id,name,description,category,price,sale_price,currency,availability,inventory_quantity,product_url,updated_at")
      .eq("tenant_id", tenant.id).order("name", { ascending: true }).limit(100),
    supabase.from("products").select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id),
  ]);
  const products = (data ?? []) as Product[];
  const money = (product: Product) => {
    const value = product.sale_price ?? product.price;
    return value === null ? "Price not set" : (product.currency ?? "—") + " " + Number(value).toLocaleString();
  };
  const availability = (product: Product) => product.availability === true ? "Available" : product.availability === false ? "Unavailable" : "Unknown";
  return (
    <main className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/">EasyReach</a><div className="tenant-name">{tenant.name}</div>
        <nav><a href="/dashboard">Overview</a><a href="/agent">AI Agent</a><a href="/channels">Channels</a><a href="/inbox">Shared Inbox</a><a href="/customers">Customers</a><a className="active" href="/products">Products</a><a href="/orders">Orders</a><a href="/analytics">Analytics</a><a href="/settings">Settings</a></nav>
        <div className="sidebar-bottom"><span>{user.email}</span><span>{membership?.role}</span></div>
      </aside>
      <section className="workspace">
        <header className="workspace-head"><div><div className="eyebrow">Verified business data</div><h1>Product catalog</h1><p className="muted">Review the real product records available to your AI agent. This view never invents prices, stock or availability.</p></div><div className="plan-badge">{count ?? products.length} products</div></header>
        {error ? <div className="error-card" role="alert">We couldn't load the product catalog. Please refresh and try again.</div> : products.length === 0 ? <section className="card products-empty"><div className="products-empty-icon" aria-hidden="true">◇</div><h2>Your catalog is empty</h2><p className="muted">Connect a supported store or load approved product data before your AI agent makes product recommendations.</p><a className="button" href="/channels">Review connections <span aria-hidden="true">→</span></a></section> : <>
          <section className="metric-grid products-metrics"><div className="metric card"><span>Total product records</span><strong>{count ?? products.length}</strong></div><div className="metric card"><span>Available in this view</span><strong>{products.filter(p => p.availability === true).length}</strong></div><div className="metric card"><span>Unavailable in this view</span><strong>{products.filter(p => p.availability === false).length}</strong></div><div className="metric card"><span>Stock not tracked</span><strong>{products.filter(p => p.inventory_quantity === null).length}</strong></div></section>
          <section className="card products-table-card"><div className="section-head"><div><h2>Catalog records</h2><p className="muted">Prices and inventory reflect the latest stored business data.</p></div></div><div className="table-scroll"><table><thead><tr><th>Product</th><th>Category</th><th>Price</th><th>Availability</th><th>Inventory</th><th>Updated</th></tr></thead><tbody>{products.map(product => <tr key={product.id}><td><strong>{product.name}</strong>{product.description && <small className="product-description">{product.description}</small>}</td><td>{product.category ?? "—"}</td><td>{money(product)}</td><td><span className={"status " + (product.availability === true ? "good" : product.availability === false ? "bad" : "")}>{availability(product)}</span></td><td>{product.inventory_quantity === null ? "Not tracked" : Number(product.inventory_quantity).toLocaleString()}</td><td>{product.updated_at ? new Date(product.updated_at).toLocaleDateString() : "—"}</td></tr>)}</tbody></table></div>{(count ?? products.length) > products.length && <p className="muted small-note">Showing {products.length} of {count} product records. Pagination is not available in this view yet.</p>}</section>
        </>}
      </section>
    </main>
  );
}