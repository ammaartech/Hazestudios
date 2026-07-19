"use client";

import { useRef, useState, useTransition } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import type { ShopSettings } from "@/lib/types";
import { updateShopSettings } from "../actions";

export function BrandForm({ settings }: { settings: ShopSettings }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [logoUrl, setLogoUrl] = useState(settings.brand?.logo_url ?? "");
  const [primaryColor, setPrimaryColor] = useState(
    settings.brand?.primary_color ?? "#008060"
  );
  const [secondaryColor, setSecondaryColor] = useState(
    settings.brand?.secondary_color ?? "#1a1a1a"
  );
  const [slogan, setSlogan] = useState(settings.brand?.slogan ?? "");

  async function uploadLogo(file: File) {
    setUploading(true);
    const supabase = createClient();
    const ext = file.name.split(".").pop() ?? "png";
    const path = `logo-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("brand").upload(path, file);
    setUploading(false);
    if (error) {
      toast.error(`Upload failed: ${error.message}`);
      return;
    }
    const { data } = supabase.storage.from("brand").getPublicUrl(path);
    setLogoUrl(data.publicUrl);
  }

  function handleSave() {
    startTransition(async () => {
      const result = await updateShopSettings({
        brand: {
          logo_url: logoUrl || undefined,
          primary_color: primaryColor,
          secondary_color: secondaryColor,
          slogan: slogan || undefined,
        },
      });
      if (result.error) toast.error(result.error);
      else {
        toast.success("Brand saved");
        router.refresh();
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Brand</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Logo</Label>
          <div className="flex items-center gap-4">
            <span className="flex size-16 items-center justify-center overflow-hidden rounded-md border bg-muted">
              {logoUrl ? (
                <Image
                  src={logoUrl}
                  alt="Store logo"
                  width={64}
                  height={64}
                  className="size-16 object-contain"
                  unoptimized
                />
              ) : (
                <span className="text-xs text-muted-foreground">No logo</span>
              )}
            </span>
            <Button
              type="button"
              variant="outline"
              disabled={uploading}
              onClick={() => inputRef.current?.click()}
            >
              {uploading ? "Uploading…" : "Upload logo"}
            </Button>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) uploadLogo(file);
                e.target.value = "";
              }}
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="primary-color">Primary color</Label>
            <div className="flex items-center gap-2">
              <input
                id="primary-color"
                type="color"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                className="size-9 cursor-pointer rounded-md border border-input bg-card p-1"
              />
              <Input
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                className="w-28 font-mono text-xs"
                aria-label="Primary color hex"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="secondary-color">Secondary color</Label>
            <div className="flex items-center gap-2">
              <input
                id="secondary-color"
                type="color"
                value={secondaryColor}
                onChange={(e) => setSecondaryColor(e.target.value)}
                className="size-9 cursor-pointer rounded-md border border-input bg-card p-1"
              />
              <Input
                value={secondaryColor}
                onChange={(e) => setSecondaryColor(e.target.value)}
                className="w-28 font-mono text-xs"
                aria-label="Secondary color hex"
              />
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="slogan">Slogan</Label>
          <Input
            id="slogan"
            value={slogan}
            onChange={(e) => setSlogan(e.target.value)}
            placeholder="A short tagline for your brand"
          />
        </div>

        <Button onClick={handleSave} disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </CardContent>
    </Card>
  );
}
