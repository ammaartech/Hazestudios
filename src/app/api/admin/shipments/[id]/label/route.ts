import { NextResponse, type NextRequest } from "next/server";
import { requireStaff } from "@/lib/auth/staff";
import { getShipmentLabel } from "@/lib/couriers/shipments";

/**
 * The printable shipping label for a courier booking.
 *
 * A Route Handler rather than a Server Action because the result is a file:
 * the browser opens it in a tab and prints it, which a JSON-returning action
 * cannot give it. Staff-gated up front — the label carries a customer's full
 * address and phone number, the bucket it lives in is private, and this route
 * is the only way out of it.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  if (!staff.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const label = await getShipmentLabel(id);
  // Plain text, not JSON: this URL is opened in a tab by a "Print label"
  // button, so the failure has to read as a sentence there.
  if (!label.ok) return new Response(label.error, { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });

  return new Response(Buffer.from(label.pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${label.filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
