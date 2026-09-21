import Link from "next/link";
import { KeyRound, PackageSearch, PlugZap } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { Carrier } from "@/lib/delivery/carriers";

/**
 * The tracking page for a carrier whose credentials have not been entered.
 *
 * Deliberately not `ComingSoon`. That component says "on the roadmap" and shows
 * a phase badge, which is right for a feature nobody has asked for and wrong
 * here: the integration exists (src/lib/couriers) and the operator has an
 * account with the courier. What they need is the list of credentials to go
 * and fetch, and where to paste them.
 */
export function CarrierSetup({ carrier }: { carrier: Carrier }) {
  const steps = [
    {
      icon: KeyRound,
      title: `Get your ${carrier.name} API credentials`,
      body: `${carrier.credentials} — issued from your ${carrier.name} account, not from here.`,
    },
    {
      icon: PlugZap,
      title: "Connect the account",
      body: (
        <>
          Paste them into{" "}
          <Link href="/admin/settings/shipping" className="font-medium text-foreground underline">
            Settings → Shipping and delivery
          </Link>
          , alongside the pickup address. Credentials are stored server-side in the integrations table, the same way Qikink&rsquo;s
          are, so the secret never reaches a browser.
        </>
      ),
    },
    {
      icon: PackageSearch,
      title: "Book from any order, track here",
      body: `Press Ship now on an order and pick ${carrier.name}. Each parcel then appears on this page with its AWB, current stage, and anything that has stalled.`,
    },
  ];

  return (
    <Card>
      <CardContent className="py-10">
        <div className="mx-auto max-w-xl">
          <div className="text-center">
            <span className="mx-auto flex size-11 items-center justify-center rounded-full bg-muted">
              <PackageSearch className="size-5 text-muted-foreground" />
            </span>
            <h2 className="mt-3 text-base font-semibold text-foreground">
              {carrier.name} is not connected yet
            </h2>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              Nothing ships through {carrier.name} until its API credentials are
              added, so there is nothing to track on this page so far.
            </p>
          </div>

          {/* Left-aligned under a centred heading on purpose: this is a list to
              work through, and centred body copy is measurably slower to read
              once it runs past a line. */}
          <ol className="mt-7 space-y-4 text-left">
            {steps.map((step, i) => (
              <li key={step.title} className="flex gap-3">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-card text-xs font-semibold tabular-nums text-muted-foreground">
                  {i + 1}
                </span>
                <div className="min-w-0 space-y-0.5">
                  <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                    <step.icon className="size-3.5 shrink-0 text-muted-foreground" />
                    {step.title}
                  </p>
                  <p className="text-[13px] text-muted-foreground">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </CardContent>
    </Card>
  );
}
