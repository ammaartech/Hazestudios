"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Internal notes</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Add a note for the team…"
            rows={2}
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
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Only visible to staff — the customer never sees this.
            </p>
            <Button size="sm" onClick={submit} disabled={pending || !body.trim()}>
              {pending ? "Saving…" : "Add note"}
            </Button>
          </div>
        </div>

        {notes.length > 0 && (
          <div className="space-y-3 border-t pt-4">
            {notes.map((note) => (
              <div key={note.id} className="group flex gap-3 text-sm">
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
      </CardContent>
    </Card>
  );
}
