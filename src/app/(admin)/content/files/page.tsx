import { PageHeader } from "@/components/admin/page-header";
import { SearchInput } from "@/components/admin/search-input";
import { createClient } from "@/lib/supabase/server";
import type { FileRecord } from "@/lib/types";
import { FileCard } from "./file-card";
import { FileUploader } from "./file-uploader";

export const metadata = { title: "Files" };
export const dynamic = "force-dynamic";

export default async function FilesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("files")
    .select("*")
    .order("created_at", { ascending: false });
  if (q) query = query.ilike("filename", `%${q}%`);
  const { data } = await query;
  const files = (data ?? []) as FileRecord[];

  return (
    <div>
      <PageHeader title="Files">
        <FileUploader />
      </PageHeader>

      <div className="mb-4">
        <SearchInput placeholder="Search files" />
      </div>

      {files.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          Upload images, videos, and documents to use across your store.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {files.map((file) => (
            <FileCard key={file.id} file={file} />
          ))}
        </div>
      )}
    </div>
  );
}
