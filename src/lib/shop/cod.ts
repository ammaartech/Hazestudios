import { createPublicClient } from "@/lib/supabase/public";
import {
  DEFAULT_COD_SETTINGS,
  parseCodSettings,
  type CodSettings,
} from "./cod-advance";

/**
 * Reads `shop_settings.cod` — the COD review rule and the advance defaults.
 *
 * On the cookie-free anon client, like `getStoreName`: the row is public under
 * 0003 and nothing in this object is sensitive. Not cached, deliberately. It is
 * read once per COD checkout and once per admin order page, and an operator
 * who has just switched the hold on expects the very next order to obey it.
 *
 * Never throws; a store that cannot read its settings behaves as one that has
 * not set any, which is the pre-0033 behaviour exactly.
 */
export async function getCodSettings(): Promise<CodSettings> {
  try {
    const { data } = await createPublicClient()
      .from("shop_settings")
      .select("cod")
      .eq("id", 1)
      .maybeSingle();
    return parseCodSettings(data?.cod);
  } catch {
    return DEFAULT_COD_SETTINGS;
  }
}
