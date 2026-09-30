import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from "react";
import { ArrowRight, Check, CircleAlert, Clock3, Code2, FileUp, FileText, Inbox, Mail, Paperclip, Plus, Send, Server, UploadCloud, X } from "lucide-react";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Textarea } from "./components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { cn } from "./lib/utils";

type Recipient = { address: string; code: number; message: string };
type Entry = { id: string; time: string; source: "compose" | "eml"; from: string; to: string[]; subject: string; result: { recipients: Recipient[]; accepted: number; rejected: number } };
type EmlDetails = { from: string; to: string; subject: string; text: string; html: string; attachments: { filename: string; size: number }[] };
type View = "compose" | "eml" | "activity";

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new Error("Cannot reach the LMTPit API. Check that the server is running, then try again.");
  }
  const body = await response.json().catch(() => {
    throw new Error(`LMTPit returned an invalid API response (${response.status}). Check the server and try again.`);
  });
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body as T;
}

const size = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="block space-y-2"><span className="flex items-center justify-between text-sm font-semibold text-foreground">{label}{hint && <span className="font-normal text-muted">{hint}</span>}</span>{children}</label>;
}

function Status({ entry }: { entry: Entry }) {
  const success = entry.result.rejected === 0;
  return <div className={cn("flex items-start gap-3 rounded-xl border p-4", success ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900")}>
    {success ? <Check className="mt-0.5 h-5 w-5 shrink-0" /> : <CircleAlert className="mt-0.5 h-5 w-5 shrink-0" />}
    <div className="min-w-0"><p className="font-semibold">{entry.result.accepted} accepted{entry.result.rejected ? `, ${entry.result.rejected} rejected` : ""}</p><div className="mt-1 space-y-0.5 text-sm">{entry.result.recipients.map((recipient) => <p key={recipient.address} className="break-all">{recipient.address}: {recipient.code} {recipient.message}</p>)}</div></div>
  </div>;
}

function App() {
  const [view, setView] = useState<View>("compose");
  const [endpoint, setEndpoint] = useState("Loading…");
  const [history, setHistory] = useState<Entry[]>([]);
  const [last, setLast] = useState<Entry | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [html, setHtml] = useState("");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [eml, setEml] = useState<File | null>(null);
  const [details, setDetails] = useState<EmlDetails | null>(null);
  const [overrideFrom, setOverrideFrom] = useState("");
  const [overrideTo, setOverrideTo] = useState("");
  const [overrideSubject, setOverrideSubject] = useState("");
  const [dragging, setDragging] = useState(false);
  const emlInput = useRef<HTMLInputElement>(null);
  const attachmentInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try { setHistory(await api<Entry[]>("/api/messages")); } catch { /* send errors are shown separately */ }
  }, []);
  useEffect(() => {
    void api<{ endpoint: string }>("/api/config").then((config) => setEndpoint(config.endpoint)).catch(() => setEndpoint("Unavailable"));
    void refresh();
  }, [refresh]);

  function showView(next: View) { setView(next); setError(""); setLast(null); }

  async function selectEml(file?: File) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".eml")) { setError("Choose a file ending in .eml"); return; }
    setError(""); setLast(null); setEml(file); setDetails(null); setView("eml");
    const data = new FormData(); data.append("eml", file);
    try { setDetails(await api<EmlDetails>("/api/inspect-eml", { method: "POST", body: data })); }
    catch (cause) { setError((cause as Error).message); }
  }

  function onDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault(); setDragging(false);
    void selectEml(event.dataTransfer.files[0]);
  }

  async function sendCompose(event: FormEvent) {
    event.preventDefault(); setError(""); setLast(null); setBusy(true);
    const data = new FormData();
    Object.entries({ from, to, subject, text, html }).forEach(([key, value]) => data.append(key, value));
    attachments.forEach((file) => data.append("attachments", file));
    try { const entry = await api<Entry>("/api/send", { method: "POST", body: data }); setLast(entry); await refresh(); }
    catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  async function sendEml(event: FormEvent) {
    event.preventDefault(); if (!eml) return;
    setError(""); setLast(null); setBusy(true);
    const data = new FormData();
    data.append("eml", eml);
    if (overrideFrom.trim()) data.append("from", overrideFrom.trim());
    if (overrideTo.trim()) data.append("to", overrideTo.trim());
    if (overrideSubject.trim()) data.append("subject", overrideSubject.trim());
    try { const entry = await api<Entry>("/api/send-eml", { method: "POST", body: data }); setLast(entry); await refresh(); }
    catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  return <div className="min-h-screen bg-background text-foreground" onDragEnter={(event) => { if ([...event.dataTransfer.types].includes("Files")) setDragging(true); }} onDragOver={(event) => event.preventDefault()} onDrop={onDrop} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }}>
    <div className="flex min-h-screen">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-white lg:flex">
        <div className="flex h-20 items-center gap-3 border-b border-border px-6"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-white"><Mail size={19} strokeWidth={2.3} /></div><div><div className="text-lg font-bold tracking-tight">LMTPit</div><div className="text-[11px] text-muted">Mail delivery workbench</div></div></div>
        <nav className="space-y-1 p-3 pt-6" aria-label="Main navigation">
          <button onClick={() => showView("compose")} className={cn("nav-item", view === "compose" && "nav-active")}><Plus size={18} /> Compose</button>
          <button onClick={() => showView("eml")} className={cn("nav-item", view === "eml" && "nav-active")}><FileUp size={18} /> Import .eml</button>
          <button onClick={() => showView("activity")} className={cn("nav-item", view === "activity" && "nav-active")}><Clock3 size={18} /> Recent deliveries <span className="ml-auto rounded-md bg-slate-100 px-1.5 py-0.5 text-xs text-muted">{history.length}</span></button>
        </nav>
        <div className="mt-auto p-4"><div className="rounded-xl border border-border bg-slate-50 p-3"><div className="flex items-center gap-2 text-xs font-semibold text-muted"><Server size={14} /> LMTP destination</div><div className="mt-2 truncate font-mono text-xs font-semibold" title={endpoint}>{endpoint}</div><p className="mt-1.5 text-xs leading-5 text-muted">Configured by the server environment.</p></div></div>
      </aside>

      <main className="min-w-0 flex-1">
        <header className="flex h-16 items-center justify-between border-b border-border bg-white px-5 lg:h-20 lg:px-10"><div className="flex items-center gap-3 lg:hidden"><div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-white"><Mail size={17} /></div><span className="font-bold">LMTPit</span></div><div className="hidden text-sm text-muted lg:block">Test what happens after your app receives mail.</div><div className="flex items-center gap-2 rounded-full border border-border bg-slate-50 px-3 py-1.5 text-xs font-medium text-muted"><span className="h-2 w-2 rounded-full bg-emerald-500" /> <span className="max-w-36 truncate" title={endpoint}>{endpoint}</span></div></header>
        <nav className="flex gap-1 border-b border-border bg-white p-2 lg:hidden" aria-label="Main navigation"><button className={cn("mobile-nav", view === "compose" && "mobile-active")} onClick={() => showView("compose")}>Compose</button><button className={cn("mobile-nav", view === "eml" && "mobile-active")} onClick={() => showView("eml")}>Import .eml</button><button className={cn("mobile-nav", view === "activity" && "mobile-active")} onClick={() => showView("activity")}>Recent</button></nav>

        <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8 lg:px-10 lg:py-11">
          {view === "compose" && <><div className="mb-8"><div className="mb-2 flex items-center gap-2 text-sm font-semibold text-primary"><Send size={16} /> Compose a test message</div><h1 className="text-3xl font-bold tracking-tight sm:text-[34px]">Send mail into your pipeline</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-muted">Build a message with text, HTML, and attachments. LMTPit delivers it directly to your LMTP server.</p></div>
            <form onSubmit={sendCompose} className="overflow-hidden rounded-2xl border border-border bg-white shadow-panel"><div className="grid gap-5 p-6 sm:grid-cols-2 lg:p-8"><Field label="From"><Input type="email" placeholder="sender@example.com" value={from} onChange={(event) => setFrom(event.target.value)} required /></Field><Field label="To" hint="Separate multiple with commas"><Input placeholder="receiver@example.com" value={to} onChange={(event) => setTo(event.target.value)} required /></Field><div className="sm:col-span-2"><Field label="Subject"><Input placeholder="Your test subject" value={subject} onChange={(event) => setSubject(event.target.value)} required /></Field></div></div>
              <div className="border-y border-border bg-slate-50/60 px-6 py-5 lg:px-8"><Tabs defaultValue="text"><div className="mb-4 flex items-center justify-between"><span className="text-sm font-semibold">Message body</span><TabsList className="flex rounded-lg border border-border bg-white p-1"><TabsTrigger value="text" className="body-tab"><FileText size={14} /> Plain text</TabsTrigger><TabsTrigger value="html" className="body-tab"><Code2 size={14} /> HTML</TabsTrigger></TabsList></div><TabsContent value="text"><Textarea aria-label="Plain text body" placeholder="Write the plain text version of your message…" value={text} onChange={(event) => setText(event.target.value)} className="min-h-52 font-mono text-[13px]" /></TabsContent><TabsContent value="html"><Textarea aria-label="HTML body" placeholder="<html>\n  <body>…</body>\n</html>" value={html} onChange={(event) => setHtml(event.target.value)} className="min-h-52 font-mono text-[13px]" /></TabsContent></Tabs><p className="mt-3 text-xs text-muted">Add either version or both. Both versions are sent as a multipart message.</p></div>
              <div className="p-6 lg:p-8"><div className="mb-3 flex items-center justify-between"><span className="text-sm font-semibold">Attachments</span><Button type="button" variant="outline" size="sm" onClick={() => attachmentInput.current?.click()}><Paperclip size={15} /> Add files</Button><input ref={attachmentInput} type="file" multiple className="hidden" onChange={(event: ChangeEvent<HTMLInputElement>) => { setAttachments((current) => [...current, ...Array.from(event.target.files || [])]); event.target.value = ""; }} /></div>{attachments.length ? <div className="space-y-2">{attachments.map((file, index) => <div key={`${file.name}-${index}`} className="flex items-center gap-3 rounded-lg border border-border bg-slate-50 px-3 py-2 text-sm"><Paperclip size={15} className="text-muted" /><span className="min-w-0 flex-1 truncate">{file.name}</span><span className="text-xs text-muted">{size(file.size)}</span><button type="button" aria-label={`Remove ${file.name}`} className="rounded p-1 text-muted hover:bg-slate-200" onClick={() => setAttachments((current) => current.filter((_, i) => i !== index))}><X size={15} /></button></div>)}</div> : <p className="text-sm text-muted">No files attached. Add files to test attachment handling.</p>}</div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-slate-50/60 px-6 py-5 lg:px-8"><span className="text-xs text-muted">Send directly to {endpoint}</span><Button type="submit" disabled={busy} size="lg"><Send size={16} /> {busy ? "Sending…" : "Send via LMTP"}</Button></div></form></>}

          {view === "eml" && <><div className="mb-8"><div className="mb-2 flex items-center gap-2 text-sm font-semibold text-primary"><FileUp size={16} /> Import a message</div><h1 className="text-3xl font-bold tracking-tight sm:text-[34px]">Replay an .eml file</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-muted">Drop in a captured message, review its details, and optionally change the envelope addresses or subject before delivery.</p></div>
            <form onSubmit={sendEml} className="space-y-5"><div className={cn("rounded-2xl border-2 border-dashed bg-white p-7 text-center shadow-panel transition-colors sm:p-10", dragging ? "border-primary bg-blue-50" : "border-[#bdcfdd]")}><input ref={emlInput} type="file" accept=".eml,message/rfc822" className="hidden" onChange={(event) => void selectEml(event.target.files?.[0])} /><div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-primary"><UploadCloud size={27} /></div><h2 className="font-semibold">{eml ? eml.name : "Drop an .eml file here"}</h2><p className="mt-1 text-sm text-muted">{eml ? `${size(eml.size)} · ${details ? "Ready to review" : "Reading message…"}` : "or choose a file from your computer"}</p><Button type="button" variant="outline" className="mt-5" onClick={() => emlInput.current?.click()}>{eml ? "Replace file" : "Choose .eml file"}</Button></div>
              {details && <><div className="rounded-2xl border border-border bg-white p-6 shadow-panel lg:p-8"><div className="mb-5 flex items-center justify-between"><h2 className="text-lg font-bold">Message details</h2><span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-primary">From file</span></div><dl className="grid gap-x-4 gap-y-3 text-sm sm:grid-cols-[72px_1fr]"><dt className="text-muted">From</dt><dd className="break-all font-medium">{details.from || "Missing"}</dd><dt className="text-muted">To</dt><dd className="break-all font-medium">{details.to || "Missing"}</dd><dt className="text-muted">Subject</dt><dd className="font-medium">{details.subject || "(No subject)"}</dd><dt className="text-muted">Content</dt><dd>{[details.text && "Text", details.html && "HTML", details.attachments.length && `${details.attachments.length} attachment${details.attachments.length === 1 ? "" : "s"}`].filter(Boolean).join(" · ") || "Empty"}</dd></dl>{details.attachments.length > 0 && <div className="mt-5 flex flex-wrap gap-2">{details.attachments.map((item, index) => <span key={index} className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2.5 py-1.5 text-xs"><Paperclip size={12} /> {item.filename} <span className="text-muted">{size(item.size)}</span></span>)}</div>}</div>
                <div className="rounded-2xl border border-border bg-white p-6 shadow-panel lg:p-8"><div className="mb-5"><h2 className="text-lg font-bold">Override fields</h2><p className="mt-1 text-sm text-muted">Leave a field blank to use the value in the file. A To override also changes the LMTP recipients.</p></div><div className="space-y-5"><Field label="From" hint="Optional"><Input placeholder={details.from || "sender@example.com"} value={overrideFrom} onChange={(event) => setOverrideFrom(event.target.value)} /></Field><Field label="To" hint="Optional · comma-separated"><Input placeholder={details.to || "receiver@example.com"} value={overrideTo} onChange={(event) => setOverrideTo(event.target.value)} /></Field><Field label="Subject" hint="Optional"><Input placeholder={details.subject || "Subject"} value={overrideSubject} onChange={(event) => setOverrideSubject(event.target.value)} /></Field></div></div>{(details.text || details.html) && <details className="rounded-2xl border border-border bg-white p-6 shadow-panel lg:p-8"><summary className="cursor-pointer text-sm font-semibold">Preview message body</summary><pre className="mt-4 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-4 font-mono text-xs leading-5">{details.text || details.html}</pre></details>}<div className="flex justify-end"><Button type="submit" disabled={busy} size="lg"><Send size={16} /> {busy ? "Sending…" : "Send .eml via LMTP"}</Button></div></>}
            </form></>}

          {view === "activity" && <><div className="mb-8"><div className="mb-2 flex items-center gap-2 text-sm font-semibold text-primary"><Inbox size={16} /> Delivery log</div><h1 className="text-3xl font-bold tracking-tight sm:text-[34px]">Recent deliveries</h1><p className="mt-2 text-sm leading-6 text-muted">The last 50 delivery attempts from this server session.</p></div>{history.length ? <div className="space-y-3">{history.map((entry) => <details key={entry.id} className="group overflow-hidden rounded-xl border border-border bg-white shadow-panel"><summary className="flex cursor-pointer list-none items-center gap-4 p-5 [&::-webkit-details-marker]:hidden"><span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", entry.result.rejected ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700")}>{entry.result.rejected ? <CircleAlert size={17} /> : <Check size={17} />}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{entry.subject || "(No subject)"}</span><span className="mt-1 block truncate text-xs text-muted">{entry.from} <ArrowRight className="inline h-3 w-3" /> {entry.to.join(", ")}</span></span><span className="hidden shrink-0 text-xs text-muted sm:block">{new Date(entry.time).toLocaleString()}</span><span className="shrink-0 rounded-md bg-slate-100 px-2 py-1 text-xs text-muted">{entry.source === "eml" ? ".eml" : "Compose"}</span></summary><div className="border-t border-border px-5 py-4"><Status entry={entry} /></div></details>)}</div> : <div className="rounded-2xl border border-dashed border-[#bdcfdd] bg-white p-12 text-center"><Inbox className="mx-auto mb-4 text-primary" size={32} /><h2 className="font-semibold">No deliveries yet</h2><p className="mt-2 text-sm text-muted">Compose a message or import an .eml file to start testing.</p><Button className="mt-5" onClick={() => showView("compose")}>Compose a message</Button></div>}</>}

          {(error || last) && view !== "activity" && <div className="mt-5" role="status">{error ? <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"><CircleAlert size={18} className="mt-0.5 shrink-0" />{error}</div> : last && <Status entry={last} />}</div>}
        </div>
      </main>
    </div>
    {dragging && <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center border-4 border-primary bg-blue-50/90" onDragLeave={() => setDragging(false)}><div className="rounded-2xl bg-white px-10 py-8 text-center shadow-xl"><UploadCloud className="mx-auto mb-3 text-primary" size={38} /><p className="text-lg font-semibold">Drop .eml to import</p></div></div>}
  </div>;
}

export default App;
