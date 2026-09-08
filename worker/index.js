/**
 * Optional Cloudflare Worker: signed ingest + edge-cached reads.
 * Static Pages still serve the HTML. This worker is only for live alerts.
 */
const MAX_ITEMS = 200;
const CACHE_SECONDS = 15;

function json(data, status, extra) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=${CACHE_SECONDS}, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=60`,
      "access-control-allow-origin": "*",
      ...(extra || {}),
    },
  });
}

function timingSafeEqual(a, b) {
  const enc = new TextEncoder();
  const aa = enc.encode(a);
  const bb = enc.encode(b);
  if (aa.byteLength !== bb.byteLength) return false;
  let out = 0;
  for (let i = 0; i < aa.byteLength; i++) out |= aa[i] ^ bb[i];
  return out === 0;
}

async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "content-type,x-timestamp,x-signature",
          "access-control-allow-methods": "GET,POST,OPTIONS",
        },
      });
    }

    if (url.pathname !== "/api/alerts" && url.pathname !== "/") {
      return json({ error: "not found" }, 404);
    }

    if (request.method === "GET") {
      const raw = await env.ALERTS.get("bundle");
      const bundle = raw ? JSON.parse(raw) : { updated_at: null, count: 0, items: [] };
      return json(bundle, 200);
    }

    if (request.method !== "POST") {
      return json({ error: "method not allowed" }, 405);
    }

    const ts = request.headers.get("X-Timestamp") || "";
    const sig = request.headers.get("X-Signature") || "";
    const body = await request.text();
    const now = Math.floor(Date.now() / 1000);
    if (!ts || Math.abs(now - Number(ts)) > 300) {
      return json({ error: "stale timestamp" }, 401);
    }
    const expected = await hmacHex(env.ALERT_SECRET, `${ts}.${body}`);
    if (!timingSafeEqual(expected, sig)) {
      return json({ error: "bad signature" }, 401);
    }

    let event;
    try {
      event = JSON.parse(body);
    } catch {
      return json({ error: "invalid json" }, 400);
    }
    const raw = await env.ALERTS.get("bundle");
    const current = raw ? JSON.parse(raw) : { items: [] };
    const items = [event, ...(current.items || []).filter((x) => x.id !== event.id)].slice(0, MAX_ITEMS);
    const bundle = { updated_at: event.ts || new Date().toISOString(), count: items.length, items };
    await env.ALERTS.put("bundle", JSON.stringify(bundle));
    return json({ ok: true, count: bundle.count }, 200, { "cache-control": "no-store" });
  },
};
