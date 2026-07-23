"use client";

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

/** Header controls that sit left of "Add product": Export, Import, More actions. */
export function ProductListActions() {
  const router = useRouter();

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => toast.info("Product export isn't wired up in this build yet.")}
      >
        Export
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => toast.info("Product import isn't wired up in this build yet.")}
      >
        Import
      </Button>
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
