"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2, Smile, AtSign, Hash, Link as LinkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

import { Textarea } from "@/components/ui/textarea";
import { formatDateTime } from "@/lib/format";
import { addOrderNote, deleteOrderNote } from "../actions";

export interface OrderNote {
  id: string;
  body: string;
  author_email: string | null;
  created_at: string;
}

/**
 * Internal notes — the team's running commentary on an order.
 *
 * Explicitly not the customer's note from checkout, which is rendered
 * separately and read-only. The distinction is stated in the empty state rather
 * than left to the heading, because writing "customer asked for a bigger size"
 * into a box the customer can see is a mistake worth designing against.
 */
export function OrderNotes({
  orderId,
  notes,
}: {
  orderId: string;
  notes: OrderNote[];
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!body.trim() || pending) return;
    startTransition(async () => {
      const result = await addOrderNote(orderId, body);
      if (result.error) toast.error(result.error);
      else {
        setBody("");
        router.refresh();
      }
    });
  }

  return (
    <section className="order-timeline">
      <h2>Timeline</h2>
      <div>
        <div className="timeline-composer">
          <div className="timeline-input"><span className="timeline-avatar">fog</span>
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            aria-label="Leave a comment"
            placeholder="Leave a comment…"
            rows={1}
            // Ctrl/Cmd+Enter submits: these get typed mid-task, often one-handed
            // while reading something else, and reaching for the mouse to post a
            // line of text is friction the keyboard already solves.
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
          />
          </div>
          <div className="timeline-footer">
            <div className="timeline-tools">
              <Button variant="ghost" size="sm" aria-label="Insert smile" onClick={() => setBody(body + " 🙂")}><Smile size={15} /></Button>
              <Button variant="ghost" size="sm" aria-label="Insert mention text" onClick={() => setBody(body + " @")}><AtSign size={15} /></Button>
              <Button variant="ghost" size="sm" aria-label="Insert order reference" onClick={() => setBody(body + " #")}><Hash size={15} /></Button>
              <Button variant="ghost" size="sm" aria-label="Insert link" onClick={() => setBody(body + " https://")}><LinkIcon size={15} /></Button>
            </div>
            <Button size="sm" onClick={submit} disabled={pending || !body.trim()}>
              {pending ? "Posting…" : "Post"}
            </Button>
          </div>
        </div>

        <p className="timeline-help">Only you and other staff can see comments</p>
        {notes.length > 0 && (
          <div className="space-y-1">
            {notes.map((note) => (
              <div key={note.id} className="timeline-entry group flex gap-3 text-sm">
                <div className="min-w-0 flex-1">
                  {/* `whitespace-pre-wrap`: notes are typed prose and people use
                      line breaks to separate thoughts. Collapsing them would run
                      a list of chase-up dates into one paragraph. */}
                  <p className="whitespace-pre-wrap break-words">{note.body}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {note.author_email ?? "Unknown"} · {formatDateTime(note.created_at)}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="Delete note"
                  // Revealed on hover/focus rather than always shown: a delete
                  // control beside every line makes a log look provisional.
                  className="text-muted-foreground opacity-0 transition-opacity duration-150 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                  onClick={() =>
                    startTransition(async () => {
                      const result = await deleteOrderNote(note.id, orderId);
                      if (result.error) toast.error(result.error);
                      else router.refresh();
                    })
                  }
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
