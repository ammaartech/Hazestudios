"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import Image from "next/image";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowUpFromLine, GripVertical, RotateCw, Star, X } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export type MediaStatus = "uploading" | "ready" | "error";

export interface DraftImage {
  /** DB id when persisted, client uuid otherwise — stable either way, which is
   *  what lets the save upsert images instead of wiping and re-inserting them */
  id: string;
  /** object URL while uploading, public Storage URL once it lands */
  url: string;
  alt: string;
  status?: MediaStatus;
  error?: string;
  /** retained only for retry after a failed upload */
  file?: File;
}

const MAX_BYTES = 20 * 1024 * 1024;
const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"];

export function isUploading(images: DraftImage[]): boolean {
  return images.some((i) => i.status === "uploading");
}

/** Errored uploads never reach the database. */
export function uploadableImages(images: DraftImage[]): DraftImage[] {
  return images.filter((i) => i.status !== "error" && i.status !== "uploading");
}

/* -------------------------------------------------------------------------- */

function SortableThumb({
  image,
  index,
  onRemove,
  onAltChange,
  onRetry,
  onMakeCover,
}: {
  image: DraftImage;
  index: number;
  onRemove: () => void;
  onAltChange: (alt: string) => void;
  onRetry: () => void;
  onMakeCover: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: image.id });

  const isCover = index === 0;
  const uploading = image.status === "uploading";
  const failed = image.status === "error";
  const draggable = !uploading && !failed;

  // Keep interactive controls from starting a drag (PointerSensor listens on
  // the image surface). stopPropagation on pointerdown lets the click through.
  const stop = (e: ReactPointerEvent) => e.stopPropagation();

  return (
    <figure
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "group/media relative flex flex-col overflow-hidden rounded-xl border bg-card",
        "motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-200",
        failed ? "border-destructive" : isCover ? "border-primary/40 ring-1 ring-primary/20" : "border-border",
        isDragging ? "z-20 shadow-xl ring-2 ring-primary/60" : "shadow-xs"
      )}
    >
      {/* The photo itself is the drag surface — grab the image to move it.
          Uniform tile size keeps @dnd-kit's rect strategy exact, so the
          reorder is smooth rather than the jumpy mixed-size grid it was. */}
      <div
        {...(draggable ? attributes : {})}
        {...(draggable ? listeners : {})}
        aria-label={draggable ? `Reorder ${image.alt || `image ${index + 1}`}` : undefined}
        className={cn(
          "relative aspect-square w-full touch-none overflow-hidden bg-muted outline-none",
          draggable && "cursor-grab active:cursor-grabbing focus-visible:ring-3 focus-visible:ring-ring/50",
          isDragging && "cursor-grabbing"
        )}
      >
        <Image
          src={image.url}
          alt={image.alt || "Product image"}
          fill
          sizes="(max-width: 640px) 50vw, 200px"
          draggable={false}
          className={cn(
            "object-cover transition-opacity duration-200 select-none",
            uploading && "opacity-50"
          )}
          unoptimized
        />

        {/* Storage uploads report no byte progress, so this is an honest
            indeterminate bar rather than a fabricated percentage. */}
        {uploading && (
          <div className="absolute inset-x-0 bottom-0 h-1 overflow-hidden bg-foreground/10">
            <div className="h-full w-1/3 rounded-full bg-primary motion-safe:animate-[media-progress_1.1s_ease-in-out_infinite]" />
          </div>
        )}

        {failed && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-card/95 p-2 text-center">
            <p className="text-xs font-medium text-destructive">Upload failed</p>
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-input px-2 py-1 text-xs font-medium transition-colors duration-150 hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <RotateCw className="size-3" />
              Retry
            </button>
          </div>
        )}

        {/* Grip hint — signposts draggability without being the only handle. */}
        {draggable && (
          <span className="pointer-events-none absolute left-2 top-2 flex size-6 items-center justify-center rounded-md bg-foreground/55 text-background opacity-0 transition-opacity duration-150 group-hover/media:opacity-100">
            <GripVertical className="size-3.5" />
          </span>
        )}

        {draggable && (
          <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover/media:opacity-100">
            {!isCover && (
              <button
                type="button"
                aria-label="Make cover image"
                title="Make cover image"
                onPointerDown={stop}
                onClick={onMakeCover}
                className="flex size-6 cursor-pointer items-center justify-center rounded-md bg-foreground/60 text-background transition-colors duration-150 hover:bg-foreground/85 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <Star className="size-3.5" />
              </button>
            )}
            <button
              type="button"
              aria-label="Remove image"
              onPointerDown={stop}
              onClick={onRemove}
              className="flex size-6 cursor-pointer items-center justify-center rounded-md bg-foreground/60 text-background transition-colors duration-150 hover:bg-destructive hover:text-white focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <X className="size-3.5" />
            </button>
          </div>
        )}

        {isCover && !failed && (
          <span className="absolute bottom-2 left-2 rounded-md bg-primary px-1.5 py-0.5 text-[0.6875rem] font-semibold text-primary-foreground shadow-sm">
            Cover
          </span>
        )}
      </div>

      <input
        value={image.alt}
        onChange={(e) => onAltChange(e.target.value)}
        placeholder="Describe this image"
        aria-label={`Alt text for image ${index + 1}`}
        className="w-full border-t border-border bg-card px-2.5 py-2 text-xs outline-none transition-colors duration-150 placeholder:text-muted-foreground focus:bg-accent/50"
      />
    </figure>
  );
}

/* -------------------------------------------------------------------------- */

export function MediaUploader({
  images,
  update,
  bucket = "product-images",
}: {
  images: DraftImage[];
  /** functional form: uploads resolve out of order and must not clobber
   *  each other or an edit the operator made while they were in flight */
  update: (fn: (prev: DraftImage[]) => DraftImage[]) => void;
  bucket?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const objectUrls = useRef(new Set<string>());

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => {
    const urls = objectUrls.current;
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const uploadOne = useCallback(
    async (id: string, file: File) => {
      const supabase = createClient();
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "png";
      const path = `${id}.${ext}`;

      const { error } = await supabase.storage
        .from(bucket)
        .upload(path, file, { cacheControl: "3600", upsert: true });

      if (error) {
        update((prev) =>
          prev.map((i) =>
            i.id === id ? { ...i, status: "error", error: error.message } : i
          )
        );
        return;
      }

      const { data } = supabase.storage.from(bucket).getPublicUrl(path);
      update((prev) =>
        prev.map((i) =>
          i.id === id
            ? { ...i, url: data.publicUrl, status: "ready", error: undefined, file: undefined }
            : i
        )
      );
    },
    [bucket, update]
  );

  const addFiles = useCallback(
    (fileList: FileList | File[]) => {
      const files: File[] = [];
      for (const file of Array.from(fileList)) {
        if (!ACCEPTED.includes(file.type)) {
          toast.error(`${file.name} isn't a supported image type.`);
          continue;
        }
        if (file.size > MAX_BYTES) {
          toast.error(`${file.name} is over the 20 MB limit.`);
          continue;
        }
        files.push(file);
      }
      if (!files.length) return;

      // Previews appear on this tick from a local object URL — the operator
      // never waits on the network to see what they just dropped.
      const drafts: DraftImage[] = files.map((file) => {
        const url = URL.createObjectURL(file);
        objectUrls.current.add(url);
        return {
          id: crypto.randomUUID(),
          url,
          alt: "",
          status: "uploading" as const,
          file,
        };
      });

      update((prev) => [...prev, ...drafts]);
      // Parallel, not sequential: ten images used to mean ten serial round trips.
      drafts.forEach((d, i) => void uploadOne(d.id, files[i]));
    },
    [update, uploadOne]
  );

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    update((prev) => {
      const from = prev.findIndex((i) => i.id === active.id);
      const to = prev.findIndex((i) => i.id === over.id);
      return from < 0 || to < 0 ? prev : arrayMove(prev, from, to);
    });
  }

  const uploadingCount = images.filter((i) => i.status === "uploading").length;

  return (
    <div>
      <style>{`@keyframes media-progress{0%{transform:translateX(-100%)}100%{transform:translateX(400%)}}`}</style>

      {images.length > 0 && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
          accessibility={{
            announcements: {
              onDragStart: ({ active }) => `Picked up image ${active.id}.`,
              onDragOver: ({ over }) =>
                over ? `Image moved over position ${over.id}.` : "",
              onDragEnd: ({ over }) =>
                over ? `Image dropped into position.` : "Move cancelled.",
              onDragCancel: () => "Move cancelled.",
            },
          }}
        >
          <SortableContext
            items={images.map((i) => i.id)}
            strategy={rectSortingStrategy}
          >
            <div className="mb-3 grid grid-cols-2 gap-3 min-[520px]:grid-cols-3 md:grid-cols-4">
              {images.map((image, index) => (
                <SortableThumb
                  key={image.id}
                  image={image}
                  index={index}
                  onRemove={() =>
                    update((prev) => prev.filter((i) => i.id !== image.id))
                  }
                  onAltChange={(alt) =>
                    update((prev) =>
                      prev.map((i) => (i.id === image.id ? { ...i, alt } : i))
                    )
                  }
                  onMakeCover={() =>
                    update((prev) => {
                      const from = prev.findIndex((i) => i.id === image.id);
                      return from < 0 ? prev : arrayMove(prev, from, 0);
                    })
                  }
                  onRetry={() => {
                    if (!image.file) return;
                    update((prev) =>
                      prev.map((i) =>
                        i.id === image.id
                          ? { ...i, status: "uploading", error: undefined }
                          : i
                      )
                    );
                    void uploadOne(image.id, image.file);
                  }}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <div
        role="button"
        tabIndex={0}
        aria-label="Add images"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          addFiles(e.dataTransfer.files);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed py-10 transition-colors duration-150 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
          dragOver
            ? "border-primary bg-primary/5"
            : "border-input hover:border-muted-foreground/50 hover:bg-accent/40"
        )}
      >
        <span className="flex size-10 items-center justify-center rounded-full bg-foreground text-background">
          <ArrowUpFromLine className="size-5" />
        </span>
        <div className="text-center">
          <p className="text-sm font-medium">
            {uploadingCount > 0
              ? `Uploading ${uploadingCount} image${uploadingCount === 1 ? "" : "s"}…`
              : "Add images"}
          </p>
          <p className="text-xs text-muted-foreground">
            Drop files here or click to browse · the first image is the cover
          </p>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED.join(",")}
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) addFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
