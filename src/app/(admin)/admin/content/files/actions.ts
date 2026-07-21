"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function recordFile(payload: {
  url: string;
  filename: string;
  mime_type: string;
  size: number;
}) {
  const supabase = await createClient();
  const { error } = await supabase.from("files").insert(payload);
  if (error) return { error: error.message };
  revalidatePath("/content/files");
  return { ok: true };
}

export async function deleteFile(id: string, url: string) {
  const supabase = await createClient();

  // Remove from storage when the URL points at the files bucket.
  const marker = "/storage/v1/object/public/files/";
  const idx = url.indexOf(marker);
  if (idx !== -1) {
    const path = decodeURIComponent(url.slice(idx + marker.length));
    await supabase.storage.from("files").remove([path]);
  }

  const { error } = await supabase.from("files").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/content/files");
  return { ok: true };
}
