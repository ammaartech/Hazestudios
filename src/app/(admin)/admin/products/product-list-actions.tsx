"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ImportDialog } from "./import-dialog";

/** Header controls that sit left of "Add product": Export, Import, More actions. */
export function ProductListActions({ currency = "INR" }: { currency?: string }) {
  const router = useRouter();
  const [importing, setImporting] = useState(false);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => toast.info("Product export isn't wired up in this build yet.")}
      >
        Export
      </Button>
      <Button variant="outline" size="sm" onClick={() => setImporting(true)}>
        Import
      </Button>

      <ImportDialog
        open={importing}
        onOpenChange={setImporting}
        currency={currency}
        // The dialog stays open on its results screen; the list underneath is
        // refreshed now so it is already correct when the operator closes it.
        onImported={() => router.refresh()}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1.5">
            More actions
            <ChevronDown className="size-3.5 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuLabel>Manage products</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => router.push("/admin/products/inventory")}>
            Manage inventory
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => router.push("/admin/products/collections")}>
            Collections
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => router.push("/admin/products/purchase-orders")}>
            Purchase orders
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => router.push("/admin/products/transfers")}>
            Transfers
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
