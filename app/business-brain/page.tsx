"use client";
import { useEffect, useState } from "react";

type Doc = {
  id:string; title:string; source_type:string; source_url:string|null; content:string|null;
  status:string; verification_status:"pending"|"verified"|"rejected"; verified_at:string|null; last_synced_at:string|null;
};
const types=["policy","faq","business","shipping","returns","payment","general"];

export default function BusinessBrain(){
  const [docs,setDocs]=useState<Doc[]>([]),[selected,setSelected]=useState<Doc|null>(null);
  const [title,setTitle]=useState(""),[type,setType]=useState("business"),[content,setContent]=useState(""),[url,setUrl]=useState("");
  const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState("");

  const load=async()=>{setLoading(true);try{const r=await fetch("/api/business-brain",{cache:"no-store"}),j=await r.json();if(!r.ok)throw Error(j.error||"Unable to load Business Brain");setDocs(j.documents??[])}catch(e){setError(e instanceof Error?e.message:"Unable to load Business Brain")}finally{setLoading(false)}};
  useEffect(()=>{load()},[]);
  const select=(d:Doc)=>{setSelected(d);setTitle(d.title);setType(d.source_type);setContent(d.content??"");setUrl(d.source_url??"");setError("")};
  const reset=()=>{setSelected(null);setTitle("");setType("business");setContent("");setUrl("");setError("")};

  const save=async()=>{
    setSaving(true);setError("");
    try{const r=await fetch("/api/business-brain",{method:selected?"PATCH":"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id:selected?.id,title,source_type:type,content,source_url:url})});const j=await r.json();if(!r.ok)throw Error(j.error||"Unable to save");await load();select(j.document)}
    catch(e){setError(e instanceof Error?e.message:"Unable to save")}finally{setSaving(false)}
  };
  const verify=async()=>{
    if(!selected)return;setSaving(true);setError("");
    try{const r=await fetch("/api/business-brain",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id:selected.id,action:"verify",reason:"Verified from Business Brain workspace"})});const j=await r.json();if(!r.ok)throw Error(j.error||"Unable to verify");await load();select(j.document)}
    catch(e){setError(e instanceof Error?e.message:"Unable to verify")}finally{setSaving(false)}
  };
  const reject=async()=>{
    if(!selected)return;setSaving(true);setError("");
    try{const r=await fetch("/api/business-brain",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id:selected.id,action:"reject",reason:"Verification revoked from Business Brain workspace"})});const j=await r.json();if(!r.ok)throw Error(j.error||"Unable to revoke verification");await load();select(j.document)}
    catch(e){setError(e instanceof Error?e.message:"Unable to revoke verification")}finally{setSaving(false)}
  };
  const archive=async()=>{
    if(!selected)return;setSaving(true);setError("");
    try{const r=await fetch("/api/business-brain",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id:selected.id,status:"archived",reason:"Archived from Business Brain"})});const j=await r.json();if(!r.ok)throw Error(j.error||"Unable to archive");await load();reset()}
    catch(e){setError(e instanceof Error?e.message:"Unable to archive")}finally{setSaving(false)}
  };

  return <main className="workspace standalone">
    <a className="muted" href="/dashboard">← Dashboard</a>
    <div className="hero compact"><div className="eyebrow">Authoritative business intelligence</div><h1>Business Brain</h1><p>Maintain the business facts EasyReach is allowed to use. Only active, verified records become runtime truth.</p></div>
    {error&&<div className="error-card">{error}</div>}
    <div className="customer-layout">
      <section className="card customer-list">
        {loading?<p className="muted">Loading Business Brain…</p>:docs.length===0?<div className="empty-card"><strong>No business knowledge yet</strong><p className="muted">Add policies, FAQs, shipping rules, payment information and other exact business facts.</p></div>:docs.map(d=>
          <button className={"customer-row "+(selected?.id===d.id?"selected":"")} key={d.id} onClick={()=>select(d)}>
            <strong>{d.title}</strong><span>{d.source_type} · {d.status} · {d.verification_status}</span><small>{d.verified_at?"Verified "+new Date(d.verified_at).toLocaleString():d.last_synced_at?"Updated "+new Date(d.last_synced_at).toLocaleString():"Not synced"}</small>
          </button>
        )}
      </section>
      <section className="card customer-detail">
        <div className="detail-head">
          <div><div className="eyebrow">{selected?"Edit knowledge":"New knowledge"}</div><h2>{selected?.title??"Add a business fact"}</h2></div>
          <div><button className="button secondary small" onClick={reset}>New</button>{selected&&<button className="button secondary small" onClick={archive} disabled={saving}>Archive</button>}</div>
        </div>
        {selected&&<div className="card" style={{marginBottom:16}}>
          <strong>Verification: {selected.verification_status}</strong>
          <p className="muted">{selected.verification_status==="verified"?"This record is authoritative runtime knowledge. Editing it will require re-verification.":selected.verification_status==="rejected"?"This record is not authoritative. Review and verify it if correct.":"This record is not yet authoritative."}</p>
          <div style={{display:"flex",gap:8}}>{selected.verification_status!=="verified"&&<button className="button" onClick={verify} disabled={saving||selected.status!=="active"}>Verify</button>}{selected.verification_status==="verified"&&<button className="button secondary" onClick={reject} disabled={saving}>Revoke verification</button>}</div>
        </div>}
        <div className="form-grid">
          <label>Title<input value={title} onChange={e=>setTitle(e.target.value)} maxLength={160}/></label>
          <label>Source type<select value={type} onChange={e=>setType(e.target.value)}>{types.map(x=><option key={x}>{x}</option>)}</select></label>
          <label className="wide">Source URL<input value={url} onChange={e=>setUrl(e.target.value)}/></label>
          <label className="wide">Business content<textarea value={content} onChange={e=>setContent(e.target.value)} rows={14} placeholder="Write the exact business rule or fact. Do not paste secrets."/></label>
        </div>
        <div className="detail-head"><span className="muted">{selected?"Changes are audited and tenant-scoped.":"New records start pending and require explicit verification."}</span><button className="button" onClick={save} disabled={saving||!title.trim()||!content.trim()}>{saving?"Saving…":selected?"Save changes":"Add to Business Brain"}</button></div>
      </section>
    </div>
  </main>
}
