"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Pencil, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { updateOrderDetails } from "./detail-actions";
import { sendOrderToQikink } from "../qikink-actions";

export function DetailEditor({ orderId, field, value, label = "Edit", icon = false }: {
  orderId: string; field: string; value: string | Record<string, string>; label?: string; icon?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const router = useRouter();
  const keys = field === "contact" ? ["email", "phone"] : ["first_name", "last_name", "address1", "address2", "city", "province", "postal_code", "country", "phone"];
  return <Dialog open={open} onOpenChange={v => { setOpen(v); if (v) { setDraft(value); setError(""); } }}>
    <DialogTrigger asChild><Button variant="ghost" size="sm" aria-label={label}>{icon ? <Pencil className="size-3.5" /> : label}</Button></DialogTrigger>
    <DialogContent className="max-h-[85dvh] overflow-y-auto"><DialogHeader><DialogTitle>{label}</DialogTitle></DialogHeader>
      <form className="space-y-4" onSubmit={e => { e.preventDefault(); startTransition(async () => {
        try { const result = await updateOrderDetails(orderId, field, draft); if (result.error) setError(result.error); else { toast.success("Order updated"); setOpen(false); router.refresh(); } }
        catch { setError("Could not save. Please try again."); }
      }); }}>
        {typeof draft === "string" ? <div className="space-y-2"><Label htmlFor={`${field}-value`}>Customer note</Label><Textarea id={`${field}-value`} value={draft} onChange={e => setDraft(e.target.value)} maxLength={5000} rows={4} /></div> :
          <div className="grid grid-cols-2 gap-3">{keys.map(key => <div key={key} className={key === "email" || key.startsWith("address") ? "col-span-2 space-y-1" : "space-y-1"}>
            <Label htmlFor={`${field}-${key}`} className="capitalize">{key.replaceAll("_", " ").replace("address1", "Address").replace("address2", "Apartment, suite, etc.")}</Label>
            <Input id={`${field}-${key}`} type={key === "email" ? "email" : "text"} value={draft[key] ?? ""} onChange={e => setDraft({ ...draft, [key]: e.target.value })} />
          </div>)}</div>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button><Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</Button></div>
      </form>
    </DialogContent>
  </Dialog>;
}

export function CustomerMenu({ customerId }: { customerId?: string }) {
  return <DropdownMenu><DropdownMenuTrigger asChild><Button size="sm" variant="ghost" aria-label="Customer actions"><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end">{customerId ? <DropdownMenuItem asChild><Link href={`/admin/customers/${customerId}`}>View customer profile</Link></DropdownMenuItem> : <DropdownMenuItem disabled>Guest customer</DropdownMenuItem>}</DropdownMenuContent>
  </DropdownMenu>;
}

export function RequestFulfillment({ orderId, configured, disabled }: { orderId: string; configured: boolean; disabled: boolean }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  if (!configured) return <Button className="request-fulfillment" size="sm" asChild><Link href="/admin/settings/qikink">Set up fulfillment</Link></Button>;
  return <Button className="request-fulfillment" size="sm" disabled={pending || disabled} onClick={() => startTransition(async () => {
    try { const result = await sendOrderToQikink(orderId); if (!result.ok) toast.error(result.error); else { toast.success(result.message); router.refresh(); } }
    catch { toast.error("Could not request fulfillment. Please try again."); }
  })}>{pending ? "Requesting…" : "Request fulfillment"}</Button>;
}

export function Metafields({ orderId, values }: { orderId: string; values: Record<string, string> }) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState(Object.entries(values));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const router = useRouter();
  function show(add: boolean) { setEntries([...Object.entries(values), ...(add ? [["", ""] as [string, string]] : [])]); setError(""); setOpen(true); }
  return <section className="order-card metafields"><div className="section-heading"><h2>Metafields</h2><div className="flex gap-2"><Button variant="ghost" size="sm" onClick={() => show(false)}>View all</Button><Button variant="outline" size="sm" onClick={() => show(true)}>Add definition</Button></div></div>
    {Object.keys(values).length ? <dl>{Object.entries(values).map(([k,v]) => <div key={k} className="flex justify-between gap-4 py-1"><dt>{k}</dt><dd className="break-all">{v}</dd></div>)}</dl> : <p className="order-muted">No metafields pinned</p>}
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[85dvh] overflow-y-auto"><DialogHeader><DialogTitle>Order metafields</DialogTitle></DialogHeader>
      <p className="text-sm text-muted-foreground">Add named text fields to this order.</p>
      <form className="space-y-3" onSubmit={e => { e.preventDefault(); const keys = entries.map(([k]) => k.trim()); if (keys.some(k => !k) || new Set(keys).size !== keys.length) { setError("Each field needs a unique name."); return; } startTransition(async () => {
        try { const result = await updateOrderDetails(orderId, "metafields", Object.fromEntries(entries.map(([k,v]) => [k.trim(),v]))); if (result.error) setError(result.error); else { setOpen(false); router.refresh(); toast.success("Metafields saved"); } } catch { setError("Could not save. Please try again."); }
      }); }}>
        {entries.map(([k,v],i) => <div className="flex gap-2" key={i}><Input aria-label={`Field ${i+1} name`} placeholder="Name" value={k} onChange={e => setEntries(entries.map((entry,n) => n === i ? [e.target.value,v] : entry))} /><Input aria-label={`Field ${i+1} value`} placeholder="Value" value={v} onChange={e => setEntries(entries.map((entry,n) => n === i ? [k,e.target.value] : entry))} /><Button type="button" variant="ghost" aria-label={`Remove field ${i+1}`} onClick={() => setEntries(entries.filter((_,n) => i !== n))}>×</Button></div>)}
        <Button type="button" variant="outline" onClick={() => setEntries([...entries,["",""]])}>Add field</Button>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end"><Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</Button></div>
      </form>
    </DialogContent></Dialog>
  </section>;
}
