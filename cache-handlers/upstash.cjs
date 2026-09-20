/* eslint-disable @typescript-eslint/no-require-imports -- loaded by Next with require() */
/**
 * The `'use cache: remote'` store: Upstash Redis when it is configured, the
 * built-in in-memory LRU when it is not.
 *
 * Why a remote store at all. The admin caches a small set of shop-wide reads —
 * settings, locations, the collection list, product facets, the dashboard's
 * aggregates — and invalidates them by tag from the Server Action that writes.
 * On Vercel each warm function has its own memory, so with the default handler
 * an `updateTag('settings')` on one instance leaves every other instance
 * serving the old store name until the entry's revalidate window runs out.
 * Redis makes the entry *and* the tag timestamps shared, so an invalidation
 * lands everywhere at once. Nothing per-user is ever cached here: the cached
 * functions read through the service role and are only reachable behind the
 * staff gate, which is what makes a shared store safe.
 *
 * Failure mode is a cache miss, never an error: a Redis outage costs the admin
 * a Supabase round trip per read, not the page.
 *
 * Wire format: one Redis string per entry — JSON with the RSC bytes base64
 * encoded — under a TTL of the entry's `expire`, plus one hash of
 * `tag → revalidated_at` shared by all entries.
 */

const { createDefaultCacheHandler } = require("next/dist/server/lib/cache-handlers/default");

const URL = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const PREFIX = process.env.CACHE_KEY_PREFIX || "hz:";
const TAGS_KEY = `${PREFIX}tags`;

/** Upstash accepts requests up to 1 MB; leave headroom for the JSON envelope. */
const MAX_ENTRY_BYTES = 900 * 1024;

if (!URL || !TOKEN) {
  // 50 MB, matching Next's own default for the in-memory handler.
  module.exports = createDefaultCacheHandler(50 * 1024 * 1024);
} else {
  const { Redis } = require("@upstash/redis");
  const redis = new Redis({ url: URL, token: TOKEN, automaticDeserialization: false });

  const pendingSets = new Map();
  let warned = false;
  const warn = (op, error) => {
    if (warned) return;
    warned = true;
    console.warn(`[cache/upstash] ${op} failed; serving without the remote cache:`, error?.message ?? error);
  };

  const entryKey = (cacheKey) => `${PREFIX}e:${cacheKey}`;

  function tagsExpired(tags, timestamp, tagTimes) {
    for (const tag of tags) {
      const at = Number(tagTimes[tag]);
      if (at && at >= timestamp) return true;
    }
    return false;
  }

  module.exports = {
    async get(cacheKey, softTags) {
      const pending = pendingSets.get(cacheKey);
      if (pending) await pending;

      let raw, tagTimes;
      try {
        // One round trip: the entry and every tag timestamp together. The tag
        // hash is a few dozen fields, far cheaper than a second request.
        [raw, tagTimes] = await redis
          .pipeline()
          .get(entryKey(cacheKey))
          .hgetall(TAGS_KEY)
          .exec();
      } catch (error) {
        warn("get", error);
        return undefined;
      }
      if (!raw) return undefined;

      let stored;
      try {
        stored = JSON.parse(raw);
      } catch {
        return undefined;
      }

      const now = Date.now();
      if (now > stored.timestamp + stored.expire * 1000) return undefined;
      if (tagsExpired([...stored.tags, ...(softTags ?? [])], stored.timestamp, tagTimes ?? {})) {
        return undefined;
      }

      const bytes = Buffer.from(stored.value, "base64");
      return {
        value: new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(bytes));
            controller.close();
          },
        }),
        tags: stored.tags,
        stale: stored.stale,
        timestamp: stored.timestamp,
        expire: stored.expire,
        revalidate: stored.revalidate,
      };
    },

    async set(cacheKey, pendingEntry) {
      let release;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      pendingSets.set(cacheKey, gate);

      try {
        const entry = await pendingEntry;

        const chunks = [];
        const reader = entry.value.getReader();
        let size = 0;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            size += value.byteLength;
            // Too big for one Upstash request: stop reading and skip the write.
            if (size > MAX_ENTRY_BYTES) return;
          }
        } finally {
          reader.releaseLock();
        }

        const payload = JSON.stringify({
          value: Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("base64"),
          tags: entry.tags,
          stale: entry.stale,
          timestamp: entry.timestamp,
          expire: entry.expire,
          revalidate: entry.revalidate,
        });

        try {
          await redis.set(entryKey(cacheKey), payload, { ex: Math.max(1, Math.ceil(entry.expire)) });
        } catch (error) {
          warn("set", error);
        }
      } finally {
        release();
        pendingSets.delete(cacheKey);
      }
    },

    async refreshTags() {
      // Tag state lives in Redis and is read on every `get`, so there is
      // nothing to sync ahead of a request.
    },

    async getExpiration() {
      // Infinity tells Next to hand the implicit (soft) tags to `get`, where
      // they are checked against the shared hash in the same round trip.
      return Infinity;
    },

    async updateTags(tags) {
      if (!tags.length) return;
      const now = Date.now();
      const fields = {};
      for (const tag of tags) fields[tag] = String(now);
      try {
        await redis.hset(TAGS_KEY, fields);
      } catch (error) {
        warn("updateTags", error);
      }
    },
  };
}
