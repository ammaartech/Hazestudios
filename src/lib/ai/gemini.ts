/**
 * Google Gemini backend for the product AI features.
 *
 * Deliberately dependency-free — it talks to the Generative Language REST API
 * with `fetch`, so it has no `@/` imports and can be exercised directly from a
 * plain node test (see scripts/verify-ai.mjs). The only inputs are `fetch`,
 * `process.env.GEMINI_API_KEY`, and the image URLs.
 *
 * Two things differ from a URL-passing API: Gemini does not fetch remote image
 * URLs itself, so every photo is fetched here and inlined as base64; and Gemini
 * 3.x rejects `thinkingConfig.thinkingBudget`, so thinking is left at its
 * default rather than forced off.
 */

/**
 * A stable alias that tracks the current Flash model. Pinned versions
 * (e.g. gemini-2.5-flash) get gated off for new API keys and 404, and specific
 * previews return 503 under load; the alias routes to available capacity. Swap
 * this one line to change models.
 */
const MODEL = "gemini-flash-latest";

const MAX_IMAGES = 3;
/** Inline images are base64 in the request body; keep well under the ~20MB cap. */
const MAX_IMAGE_BYTES = 7 * 1024 * 1024;

export interface ProductClassification {
  category: string;
  productType: string;
  confidence: "high" | "medium" | "low";
}

/** The JSON shape Gemini is constrained to return. */
const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    category: { type: "string" },
    productType: { type: "string" },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
  },
  required: ["category", "productType", "confidence"],
} as const;

const SYSTEM =
  "You classify e-commerce product photographs for a fashion catalogue. " +
  "Return the product's category and type from the garment itself — ignore " +
  "the model, the background, and any props. `category` is a broad " +
  "merchandising grouping (e.g. 'Tops', 'Outerwear', 'Footwear'); " +
  "`productType` is the specific item in one or two words (e.g. 'T-shirt'). " +
  "When a provided existing value fits, reuse it verbatim so the catalogue " +
  "stays consistent. If the image is not a sellable product, set confidence " +
  "to 'low'.";

export function geminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

/** Fetches an image URL and returns it as a Gemini inline-data part, or null. */
async function toInlineData(
  url: string
): Promise<{ inline_data: { mime_type: string; data: string } } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;

    const mime = res.headers.get("content-type") ?? "image/jpeg";
    if (!mime.startsWith("image/")) return null;

    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) return null;

    return { inline_data: { mime_type: mime, data: bytes.toString("base64") } };
  } catch {
    return null;
  }
}

async function generate(key: string, body: unknown): Promise<Response> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
  // One retry on the transient capacity/quota codes; anything else surfaces.
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "x-goog-api-key": key, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok || (res.status !== 429 && res.status !== 503) || attempt === 1) {
      return res;
    }
    await new Promise((r) => setTimeout(r, 700));
  }
  // Unreachable — the loop always returns — but satisfies the type checker.
  throw new Error("unreachable");
}

/**
 * Classifies product photos into a category and product type.
 *
 * Returns null when nothing usable could be produced (no key, no fetchable
 * image, a blocked or empty response), so the caller maps every failure to one
 * graceful message rather than distinguishing them.
 */
export async function classifyProductImages(
  imageUrls: string[],
  hints: { existingCategories?: string[]; existingTypes?: string[] } = {}
): Promise<ProductClassification | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;

  const candidates = imageUrls
    .filter((u) => /^https?:\/\//i.test(u))
    .slice(0, MAX_IMAGES);
  if (!candidates.length) return null;

  const parts = (await Promise.all(candidates.map(toInlineData))).filter(
    (p): p is NonNullable<typeof p> => p !== null
  );
  if (!parts.length) return null;

  const hintLines: string[] = [];
  if (hints.existingCategories?.length) {
    hintLines.push(`Existing categories: ${hints.existingCategories.join(", ")}.`);
  }
  if (hints.existingTypes?.length) {
    hintLines.push(`Existing product types: ${hints.existingTypes.join(", ")}.`);
  }

  const body = {
    system_instruction: { parts: [{ text: SYSTEM }] },
    contents: [
      {
        parts: [
          ...parts,
          {
            text:
              (hintLines.length ? hintLines.join(" ") + "\n\n" : "") +
              "Classify this product.",
          },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
      // No thinkingConfig: Gemini 3.x rejects thinkingBudget, and the default
      // is fast enough for a single classification.
    },
  };

  let json: {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  try {
    const res = await generate(key, body);
    if (!res.ok) return null;
    json = await res.json();
  } catch {
    return null;
  }

  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) return null;

  try {
    const parsed = JSON.parse(text) as Partial<ProductClassification>;
    const category = typeof parsed.category === "string" ? parsed.category.trim() : "";
    const productType =
      typeof parsed.productType === "string" ? parsed.productType.trim() : "";
    if (!category && !productType) return null;

    return {
      category,
      productType,
      confidence:
        parsed.confidence === "high" || parsed.confidence === "low"
          ? parsed.confidence
          : "medium",
    };
  } catch {
    return null;
  }
}
