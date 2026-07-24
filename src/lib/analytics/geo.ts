export interface GeoLocation {
  country: string | null;
  countryCode: string | null;
  region: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
}

const EMPTY: GeoLocation = {
  country: null,
  countryCode: null,
  region: null,
  city: null,
  latitude: null,
  longitude: null,
};

/**
 * Rough country centroids, used only when the platform gives us a country but
 * no coordinates (Cloudflare's free tier does this). Enough to drop a pin on
 * the right landmass; not meant to be survey-grade.
 */
const COUNTRY_CENTROIDS: Record<string, [number, number]> = {
  AE: [23.4, 53.8], AR: [-38.4, -63.6], AT: [47.5, 14.6], AU: [-25.3, 133.8],
  BD: [23.7, 90.4], BE: [50.5, 4.5], BR: [-14.2, -51.9], CA: [56.1, -106.3],
  CH: [46.8, 8.2], CL: [-35.7, -71.5], CN: [35.9, 104.2], CO: [4.6, -74.3],
  CZ: [49.8, 15.5], DE: [51.2, 10.5], DK: [56.3, 9.5], EG: [26.8, 30.8],
  ES: [40.5, -3.7], FI: [61.9, 25.7], FR: [46.2, 2.2], GB: [55.4, -3.4],
  GR: [39.1, 21.8], HK: [22.4, 114.1], ID: [-0.8, 113.9], IE: [53.4, -8.2],
  IL: [31.0, 34.9], IN: [20.6, 78.9], IT: [41.9, 12.6], JP: [36.2, 138.3],
  KE: [-0.0, 37.9], KR: [35.9, 127.8], MA: [31.8, -7.1], MX: [23.6, -102.6],
  MY: [4.2, 101.98], NG: [9.1, 8.7], NL: [52.1, 5.3], NO: [60.5, 8.5],
  NZ: [-40.9, 174.9], PE: [-9.2, -75.0], PH: [12.9, 121.8], PK: [30.4, 69.3],
  PL: [51.9, 19.1], PT: [39.4, -8.2], RO: [45.9, 25.0], RU: [61.5, 105.3],
  SA: [23.9, 45.1], SE: [60.1, 18.6], SG: [1.35, 103.8], TH: [15.9, 101.0],
  TR: [38.96, 35.2], TW: [23.7, 121.0], UA: [48.4, 31.2], US: [37.1, -95.7],
  VN: [14.06, 108.3], ZA: [-30.6, 22.9],
};

const COUNTRY_NAMES = new Intl.DisplayNames(["en"], { type: "region" });

function countryName(code: string | null) {
  if (!code) return null;
  try {
    return COUNTRY_NAMES.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

/** Header values arrive percent-encoded on Vercel (e.g. "S%C3%A3o%20Paulo"). */
function decode(value: string | null): string | null {
  if (!value) return null;
  try {
    return decodeURIComponent(value) || null;
  } catch {
    return value || null;
  }
}

function num(value: string | null): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Loopback, RFC1918 and CGNAT ranges never resolve — skip the lookup. */
function isPrivateAddress(ip: string) {
  return (
    ip === "::1" ||
    ip === "127.0.0.1" ||
    ip.startsWith("10.") ||
    ip.startsWith("192.168.") ||
    ip.startsWith("169.254.") ||
    ip.startsWith("fc") ||
    ip.startsWith("fd") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip)
  );
}

export function clientIpFrom(headers: Headers): string | null {
  // x-forwarded-for is a chain; the first entry is the original client.
  const forwarded = headers.get("x-forwarded-for");
  const ip =
    forwarded?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    headers.get("cf-connecting-ip") ||
    null;
  return ip && !isPrivateAddress(ip) ? ip : null;
}

/** Geo the hosting platform already resolved — free and instant when present. */
function fromPlatformHeaders(headers: Headers): GeoLocation | null {
  const code =
    headers.get("x-vercel-ip-country") ?? headers.get("cf-ipcountry") ?? null;
  if (!code || code === "XX") return null;

  const lat = num(headers.get("x-vercel-ip-latitude"));
  const lon = num(headers.get("x-vercel-ip-longitude"));
  const centroid = COUNTRY_CENTROIDS[code.toUpperCase()];

  return {
    country: countryName(code),
    countryCode: code.toUpperCase(),
    region: decode(headers.get("x-vercel-ip-country-region")),
    city: decode(headers.get("x-vercel-ip-city")),
    latitude: lat ?? centroid?.[0] ?? null,
    longitude: lon ?? centroid?.[1] ?? null,
  };
}

interface IpApiResponse {
  country_name?: string;
  country_code?: string;
  region?: string;
  city?: string;
  latitude?: number;
  longitude?: number;
  error?: boolean;
}

/**
 * Fallback lookup for self-hosted and local runs. ipapi.co needs no key at this
 * volume because we only call it once per session, on creation.
 *
 * With no IP (localhost) we hit the keyless endpoint, which resolves the
 * *server's* own address — in dev that is the developer's connection, which is
 * exactly the pin you want to see while building this page.
 */
async function fromIpLookup(ip: string | null): Promise<GeoLocation | null> {
  const url = ip
    ? `https://ipapi.co/${encodeURIComponent(ip)}/json/`
    : "https://ipapi.co/json/";

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(2500),
      headers: { "User-Agent": "hazestudios-analytics/1.0" },
      cache: "no-store",
    });
    if (!res.ok) return null;

    const data = (await res.json()) as IpApiResponse;
    if (data.error || !data.country_code) return null;

    return {
      country: data.country_name ?? countryName(data.country_code),
      countryCode: data.country_code.toUpperCase(),
      region: data.region ?? null,
      city: data.city ?? null,
      latitude: data.latitude ?? null,
      longitude: data.longitude ?? null,
    };
  } catch {
    // Timeout, rate limit, or offline — a session without geo is still a session.
    return null;
  }
}

/**
 * Resolve a visitor's location. Never throws and never blocks longer than the
 * lookup timeout; an unresolvable visitor is recorded with null geo rather than
 * dropped, so the visitor count stays correct even when the map cannot place them.
 */
export async function resolveGeo(headers: Headers): Promise<GeoLocation> {
  const platform = fromPlatformHeaders(headers);
  if (platform) return platform;

  const lookup = await fromIpLookup(clientIpFrom(headers));
  return lookup ?? EMPTY;
}
