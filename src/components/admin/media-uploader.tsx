"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import {
  DndContext,
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
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowUpFromLine, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export interface DraftImage {
  /** DB id when persisted, local uuid otherwise */
  id: string;
  url: string;
  alt: string;
  isNew?: boolean;
}

function SortableThumb({
  image,
  index,
  onRemove,
  onAltChange,
}: {
  image: DraftImage;
  index: number;
  onRemove: () => void;
  onAltChange: (alt: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: image.id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "group relative overflow-hidden rounded-md border border-input bg-card",
        index === 0 ? "col-span-2 row-span-2" : "",
        isDragging && "z-10 opacity-80 shadow-lg"
      )}
    >
      <div
        {...attributes}
        {...listeners}
        className="relative aspect-square w-full cursor-grab active:cursor-grabbing"
      >
        <Image
          src={image.url}
          alt={image.alt || "Product image"}
          fill
          sizes="(max-width: 768px) 50vw, 200px"
          className="object-cover"
          unoptimized
        />
      </div>
      <button
        type="button"
        aria-label="Remove image"
        onClick={onRemove}
        className="absolute right-1.5 top-1.5 hidden size-6 cursor-pointer items-center justify-center rounded-full bg-black/60 text-white transition-colors duration-150 hover:bg-black/80 group-hover:flex"
      >
        <X className="size-3.5" />
      </button>
      <input
        value={image.alt}
        onChange={(e) => onAltChange(e.target.value)}
        placeholder="Alt text"
        aria-label="Image alt text"
        className="w-full border-t border-input bg-card px-2 py-1 text-xs outline-none placeholder:text-muted-foreground focus:bg-accent/40"
      />
    </div>
  );
}

export function MediaUploader({
  images,
  onChange,
  bucket = "product-images",
}: {
  images: DraftImage[];
  onChange: (images: DraftImage[]) => void;
  bucket?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  async function uploadFiles(files: FileList | File[]) {
    const list = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (!list.length) return;

    setUploading(true);
    const supabase = createClient();
    const uploaded: DraftImage[] = [];

    for (const file of list) {
      const ext = file.name.split(".").pop() ?? "png";
      const path = `${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from(bucket).upload(path, file, {
        cacheControl: "3600",
        upsert: false,
      });
      if (error) {
        toast.error(`Upload failed for ${file.name}: ${error.message}`);
        continue;
      }
      const { data } = supabase.storage.from(bucket).getPublicUrl(path);
      uploaded.push({
        id: crypto.randomUUID(),
        url: data.publicUrl,
        alt: "",
        isNew: true,
      });
    }

    setUploading(false);
    if (uploaded.length) onChange([...images, ...uploaded]);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = images.findIndex((i) => i.id === active.id);
    const newIndex = images.findIndex((i) => i.id === over.id);
    onChange(arrayMove(images, oldIndex, newIndex));
  }

  return (
    <div>
      {images.length > 0 && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={images.map((i) => i.id)} strategy={rectSortingStrategy}>
            <div className="mb-3 grid grid-cols-3 gap-3 sm:grid-cols-4">
              {images.map((image, index) => (
                <SortableThumb
                  key={image.id}
                  image={image}
                  index={index}
                  onRemove={() => onChange(images.filter((i) => i.id !== image.id))}
                  onAltChange={(alt) =>
                    onChange(images.map((i) => (i.id === image.id ? { ...i, alt } : i)))
                  }
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <div
        role="button"
        tabIndex={0}
        aria-label="Upload images"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          uploadFiles(e.dataTransfer.files);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed py-10 transition-colors duration-150",
          dragOver
            ? "border-primary bg-primary/5"
            : "border-input hover:border-muted-foreground/50 hover:bg-accent/40"
        )}
      >
        {uploading ? (
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        ) : (
          <span className="flex size-10 items-center justify-center rounded-full bg-foreground text-background">
            <ArrowUpFromLine className="size-5" />
          </span>
        )}
        <div className="text-center">
          <p className="text-sm font-medium">
            {uploading ? "Uploading…" : "Add files"}
          </p>
          <p className="text-xs text-muted-foreground">
            or drop images to upload · first image is the cover
          </p>
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) uploadFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
