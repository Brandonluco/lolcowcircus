// Hard ceiling on how many chat connections this single shared room will
// ever hold at once, regardless of who they're from. This is the backstop
// against a flood taking the whole room down for every visitor.
const MAX_TOTAL_SESSIONS = 500;

// How many concurrent connections a single IP may hold open at once. This
// is separate from the per-message rate limit below — that only throttles
// how often an already-open connection can *send*, it does nothing to stop
// one IP from opening hundreds of connections and just holding them open.
const MAX_SESSIONS_PER_IP = 20;

export class ChatRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Set();
    // Tracks how many open sessions belong to each IP, so we can enforce
    // MAX_SESSIONS_PER_IP without scanning this.sessions on every connect.
    this.sessionCountByIp = new Map();
    // Which IP each open session belongs to, so the broadcast loop can
    // release a dead session's slot even though it isn't the session whose
    // own close/error listener is currently running (see releaseSession).
    this.sessionIp = new Map();
    // In-memory per-IP cooldown for this room. This is separate from the
    // /api/comments throttle because someone can open a websocket connection
    // directly (skipping the REST endpoint and its client entirely) and
    // spam messages straight into this handler, which otherwise rebroadcasts
    // anything it receives with no limit at all.
    this.lastMessageAt = new Map();
  }

  async fetch(request) {
    const upgradeHeader = request.headers.get("Upgrade");

    if (upgradeHeader !== "websocket") {
      return new Response("Expected websocket", {
        status: 400
      });
    }

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";

    // Reject outright, before ever accepting the socket, if either cap is
    // already at its limit. This is what actually stops a flood: a rejected
    // connection costs almost nothing, an accepted one that has to be torn
    // down later already did its damage.
    if (this.sessions.size >= MAX_TOTAL_SESSIONS) {
      console.log("Rejected connection from", ip, "- room is full");
      return new Response("Chat room is full, try again shortly", {
        status: 503
      });
    }

    const ipCount = this.sessionCountByIp.get(ip) || 0;

    if (ipCount >= MAX_SESSIONS_PER_IP) {
      console.log("Rejected connection from", ip, "- too many open connections from this IP");
      return new Response("Too many open connections from this address", {
        status: 429
      });
    }

    const pair = new WebSocketPair();

    const [client, server] = Object.values(pair);

    server.accept();

    this.sessions.add(server);
    this.sessionCountByIp.set(ip, ipCount + 1);
    this.sessionIp.set(server, ip);

    // "close" and "error" can both fire for the same socket in some cases,
    // and now the broadcast loop can also trigger a release for a socket
    // other than the one currently running this listener — so cleanup is
    // keyed off a "released" flag stored per-session rather than one shared
    // closure variable, and releaseSession takes whichever session it's
    // cleaning up instead of always assuming it's `server`.
    const releasedSessions = new WeakSet();

    const releaseSession = (session) => {
      if (releasedSessions.has(session)) {
        return;
      }
      releasedSessions.add(session);

      this.sessions.delete(session);

      const sessionIp = this.sessionIp.get(session);
      this.sessionIp.delete(session);

      const current = this.sessionCountByIp.get(sessionIp) || 0;
      if (current <= 1) {
        this.sessionCountByIp.delete(sessionIp);
      } else {
        this.sessionCountByIp.set(sessionIp, current - 1);
      }
    };

    server.addEventListener("error", (event) => {
  console.log("WebSocket error:", event);
  releaseSession(server);
});

    server.addEventListener("close", () => {
  releaseSession(server);
});

server.addEventListener("message", (event) => {

    const now = Date.now();
    const last = this.lastMessageAt.get(ip) || 0;

    // Same 3s window as the /api/comments cooldown, so this can't be used
    // as a side door around it.
    if (now - last < 3000) {
      console.log("Dropped chat message from", ip, "- rate limited");
      return;
    }

    this.lastMessageAt.set(ip, now);

    console.log("Broadcasting:", event.data);

  // A socket can be in a half-dead state (e.g. the client vanished but the
  // "close" event for it hasn't fired yet) at the exact moment we try to
  // broadcast to it. send() throwing on one stale session used to bubble
  // all the way up out of this handler uncaught — which is very likely
  // what's shown up in your logs as the Durable Object being reset. Now a
  // single bad socket just gets cleaned up and skipped instead of taking
  // the whole broadcast down.
  for (const session of this.sessions) {

    try {
      session.send(event.data);
    } catch (err) {
      console.log("Dropping dead session during broadcast:", err);
      releaseSession(session);
    }

  }

});

    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }
}










function slugify(title) {

  return String(title || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "article";

}

async function generateUniqueSlugInTable(env, table, title, excludeId) {

  const base = slugify(title);

  let slug = base;
  let counter = 2;

  while (true) {

    let query = `SELECT id FROM ${table} WHERE slug = ?`;
    const bindings = [slug];

    if (excludeId) {
      query += " AND id != ?";
      bindings.push(excludeId);
    }

    const existing = await env.DB.prepare(query).bind(...bindings).first();

    if (!existing) {
      break;
    }

    slug = `${base}-${counter}`;
    counter++;

  }

  return slug;

}

async function generateUniqueSlug(env, title, excludeId) {
  return generateUniqueSlugInTable(env, "articles", title, excludeId);
}

async function generateUniqueStreamerSlug(env, name, excludeId) {
  return generateUniqueSlugInTable(env, "streamers", name, excludeId);
}

function escapeHtml(str) {

  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

}

// Comment/chat color gets dropped straight into a style="color:..." attribute
// on the client, so it has to be a real hex color and nothing else — a client
// can send any string here by POSTing to the API directly instead of going
// through the UI's color picker, so this can't just be trusted.
function sanitizeColor(color) {

  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#8B5A2B";

}

// =====================================================================
// CLOUDFLARE ACCESS VERIFICATION (admin routes)
// =====================================================================
//
// Access already stops anyone without credentials from loading the admin
// panel. This adds the same check at the API layer, so a request that
// never went through Access — a direct curl/fetch to one of these URLs,
// or a future admin route someone forgets to add to the Access policy —
// still can't get through. It works entirely off the sign-in you already
// do: once you're authenticated, Cloudflare stamps every request your
// browser makes to a Access-protected path with a signed token in the
// Cf-Access-Jwt-Assertion header, automatically, with zero change needed
// in admin.js. This just verifies that token is real before letting a
// request reach the database.
//
// Requires two Variables set in the Cloudflare dashboard for this Worker
// (Workers & Pages > cowtube > Settings > Variables and Secrets):
//   ACCESS_TEAM_DOMAIN   e.g. "yourteam.cloudflareaccess.com"
//   ACCESS_AUD           the Application Audience (AUD) tag, found on the
//                         Access application's Overview tab in Zero Trust
//
// Also requires the Access application (in Zero Trust > Access > Applications)
// to actually cover the admin API paths below, not just admin.html — see
// the deploy notes for the exact path list.

function base64UrlDecodeToBytes(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64UrlDecodeToString(str) {
  return new TextDecoder().decode(base64UrlDecodeToBytes(str));
}

// Cached in memory for the life of this Worker instance so a burst of
// admin requests doesn't refetch Cloudflare's public keys every time —
// refreshed at most once every 10 minutes.
let cachedAccessJwks = null;
let cachedAccessJwksAt = 0;

async function getAccessJwks(teamDomain) {

  if (cachedAccessJwks && Date.now() - cachedAccessJwksAt < 10 * 60 * 1000) {
    return cachedAccessJwks;
  }

  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);

  if (!res.ok) {
    throw new Error(`Failed to fetch Access certs: ${res.status}`);
  }

  cachedAccessJwks = await res.json();
  cachedAccessJwksAt = Date.now();

  return cachedAccessJwks;

}

// Verifies a Cf-Access-Jwt-Assertion token: real signature from your
// Access team, not expired, right issuer, right audience. Throws on any
// failure — callers treat "threw" the same as "not authorized".
async function verifyAccessJwt(token, env) {

  const parts = token.split(".");

  if (parts.length !== 3) {
    throw new Error("Malformed token");
  }

  const [headerB64, payloadB64, signatureB64] = parts;

  const header = JSON.parse(base64UrlDecodeToString(headerB64));
  const payload = JSON.parse(base64UrlDecodeToString(payloadB64));

  const jwks = await getAccessJwks(env.ACCESS_TEAM_DOMAIN);
  const jwk = jwks.keys.find((k) => k.kid === header.kid);

  if (!jwk) {
    throw new Error("No matching Access signing key for this token");
  }

  const cryptoKey = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );

  const signedData = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = base64UrlDecodeToBytes(signatureB64);

  const validSignature = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    signature,
    signedData
  );

  if (!validSignature) {
    throw new Error("Bad Access token signature");
  }

  const nowSeconds = Math.floor(Date.now() / 1000);

  if (payload.exp && nowSeconds >= payload.exp) {
    throw new Error("Access token expired");
  }

  if (payload.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) {
    throw new Error("Access token has the wrong issuer");
  }

  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];

  if (!audiences.includes(env.ACCESS_AUD)) {
    throw new Error("Access token has the wrong audience");
  }

  return payload;

}

// Call this at the top of every admin-only route. Returns a Response to
// send straight back (request rejected) or null (request is genuinely
// from an Access-authenticated session, safe to continue).
async function requireAdmin(request, env) {

  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) {
    console.log("ACCESS_TEAM_DOMAIN/ACCESS_AUD not configured — blocking admin request until set up");
    return Response.json({ error: "admin_not_configured" }, { status: 500 });
  }

  const token = request.headers.get("Cf-Access-Jwt-Assertion");

  if (!token) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  try {

    await verifyAccessJwt(token, env);
    return null;

  } catch (err) {

    console.log("Access JWT rejected:", err.message);
    return Response.json({ error: "unauthorized" }, { status: 401 });

  }

}

// Simple per-IP cooldown so one visitor can't flood chat/comments faster
// than a person realistically types. Stores one row per (ip, action) pair
// with the timestamp of their last accepted post; a new post from the same
// IP within the cooldown window gets rejected instead of inserted.
// `action` keeps chat, article comments, etc. on separate cooldowns so
// posting in one doesn't eat into the other's allowance.
async function isRateLimited(env, ip, action, cooldownSeconds) {

  const now = Date.now();

  const existing = await env.DB
    .prepare(
      "SELECT last_posted_at FROM rate_limits WHERE ip_address = ? AND action = ?"
    )
    .bind(ip, action)
    .first();

  if (existing && now - existing.last_posted_at < cooldownSeconds * 1000) {
    return true;
  }

  await env.DB
    .prepare(
      `
      INSERT INTO rate_limits (ip_address, action, last_posted_at)
      VALUES (?, ?, ?)
      ON CONFLICT (ip_address, action) DO UPDATE SET last_posted_at = excluded.last_posted_at
      `
    )
    .bind(ip, action, now)
    .run();

  return false;

}

// Checks whether a YouTube channel is currently live using the official
// YouTube Data API v3 instead of scraping the channel page. Uses the
// "uploads playlist" trick to keep this cheap: a channel's uploads playlist
// ID is always its channel ID with the leading "UC" swapped for "UU", so we
// can skip an extra channels.list call entirely. Total cost per check is
// ~2 quota units (1 for the playlist lookup, 1 for the video's own status) —
// well within the free 10,000 units/day, versus 100 units for a single
// search.list call.
async function checkYoutubeLive(channelId, env) {

  if (!env.YOUTUBE_API_KEY) {
    console.log("YOUTUBE_API_KEY not set — skipping YouTube live check");
    return null;
  }

  if (!channelId.startsWith("UC")) {
    // Not a standard channel ID — can't derive the uploads playlist ID this way.
    console.log(`YouTube check skipped for ${channelId}: not a UC... channel ID`);
    return null;
  }

  const uploadsPlaylistId = "UU" + channelId.slice(2);

  try {

    // 1 unit — the most recent video they've published (a livestream shows
    // up here the moment it starts, same as a regular upload would).
    const playlistRes = await fetch(
      `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=1&playlistId=${encodeURIComponent(uploadsPlaylistId)}&key=${env.YOUTUBE_API_KEY}`
    );

    const playlistData = await playlistRes.json();

    if (!playlistRes.ok) {
      console.log(`YouTube playlistItems failed for ${channelId}: status=${playlistRes.status} error=${JSON.stringify(playlistData.error)}`);
      return null;
    }

    const latestVideoId = playlistData.items?.[0]?.snippet?.resourceId?.videoId;

    if (!latestVideoId) {
      return null;
    }

    // 1 unit — read that video's actual broadcast status directly from
    // YouTube's own data instead of guessing from page HTML.
    const videoRes = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${encodeURIComponent(latestVideoId)}&key=${env.YOUTUBE_API_KEY}`
    );

    const videoData = await videoRes.json();

    if (!videoRes.ok) {
      console.log(`YouTube videos.list failed for ${channelId}: status=${videoRes.status} error=${JSON.stringify(videoData.error)}`);
      return null;
    }

    // liveBroadcastContent is "live", "upcoming", or "none" — straight from
    // YouTube, not inferred.
    const liveBroadcastContent = videoData.items?.[0]?.snippet?.liveBroadcastContent;

    console.log(`YouTube check for ${channelId}: videoId=${latestVideoId} liveBroadcastContent=${liveBroadcastContent}`);

    return liveBroadcastContent === "live" ? latestVideoId : null;

  } catch (err) {

    console.log("YouTube live check failed for", channelId, err.message);
    return null;

  }

}

// Loops over every streamer with a YouTube channel ID on file and refreshes
// their cached live status in D1. Called on a schedule (see wrangler.toml).
async function updateYoutubeLiveStatuses(env) {

  const { results } = await env.DB
    .prepare(
      `
      SELECT id, embed_channel_id, youtube_live_video_id FROM streamers
      WHERE platform LIKE '%youtube%'
      AND embed_channel_id IS NOT NULL
      AND embed_channel_id != ''
      `
    )
    .all();

  for (const streamer of results) {

    const liveVideoId = await checkYoutubeLive(streamer.embed_channel_id, env);

    // Skip the write entirely if nothing changed since last check. This is
    // the common case (a streamer isn't live most of the time), so this
    // cuts the row-write cost of this cron job down to roughly "once per
    // streamer per time their live status actually flips", instead of
    // once per streamer every single time the cron runs (every 5 minutes,
    // 288 times a day, forever, regardless of whether anything changed).
    if ((liveVideoId || null) === (streamer.youtube_live_video_id || null)) {
      continue;
    }

    const now = new Date().toISOString();

    await env.DB
      .prepare(
        `
        UPDATE streamers
        SET youtube_live_video_id = ?,
            youtube_checked_at = ?,
            last_live_at = CASE WHEN ? IS NOT NULL THEN ? ELSE last_live_at END
        WHERE id = ?
        `
      )
      .bind(liveVideoId, now, liveVideoId, now, streamer.id)
      .run();

  }

}

// Gets a short-lived app access token from Kick using the client_credentials
// grant. Only needs the client ID/secret (stored as Cloudflare secrets) — no
// user login involved, since we're only reading public channel data.
async function getKickAppToken(env) {

  try {

    const res = await fetch("https://id.kick.com/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: env.KICK_CLIENT_ID,
        client_secret: env.KICK_CLIENT_SECRET
      })
    });

    if (!res.ok) {
      console.log("Kick token request failed:", res.status);
      return null;
    }

    const data = await res.json();

    return data.access_token || null;

  } catch (err) {

    console.log("Kick token request error:", err.message);
    return null;

  }

}

// Checks whether a single Kick channel is currently live via Kick's official API.
async function checkKickLive(slug, token) {

  try {

    const res = await fetch(
      `https://api.kick.com/public/v1/channels?slug=${encodeURIComponent(slug)}`,
      {
        headers: {
          "Authorization": `Bearer ${token}`
        }
      }
    );

    if (!res.ok) {
      return false;
    }

    const data = await res.json();

    const channel = data.data && data.data[0];

    return Boolean(channel && channel.stream && channel.stream.is_live);

  } catch (err) {

    console.log("Kick live check failed for", slug, err.message);
    return false;

  }

}

// Loops over every Kick streamer and refreshes their cached live status in D1.
async function updateKickLiveStatuses(env) {

  const { results } = await env.DB
    .prepare(
      `
      SELECT id, channel, kick_channel, kick_is_live FROM streamers
      WHERE platform LIKE '%kick%'
      `
    )
    .all();

  if (results.length === 0) {
    return;
  }

  const token = await getKickAppToken(env);

  if (!token) {
    // Couldn't get a token this run — skip rather than wrongly marking
    // everyone offline. We'll try again on the next cron cycle.
    return;
  }

  for (const streamer of results) {

    const slugRaw = streamer.kick_channel || streamer.channel || "";
    const slug = slugRaw.startsWith("@") ? slugRaw.slice(1) : slugRaw;

    if (!slug) {
      continue;
    }

    const isLive = await checkKickLive(slug, token);

    // Same fix as the YouTube check: skip the write entirely when nothing
    // changed since last time, instead of writing a row every 5 minutes
    // for every Kick streamer regardless of whether their status moved.
    const wasLive = Boolean(streamer.kick_is_live);

    if (isLive === wasLive) {
      continue;
    }

    const now = new Date().toISOString();

    await env.DB
      .prepare(
        `
        UPDATE streamers
        SET kick_is_live = ?,
            kick_checked_at = ?,
            last_live_at = CASE WHEN ? THEN ? ELSE last_live_at END
        WHERE id = ?
        `
      )
      .bind(isLive ? 1 : 0, now, isLive ? 1 : 0, now, streamer.id)
      .run();

  }

}

// Instagram's live flag is set by hand, with no automated check to correct
// it — so unlike YouTube/Kick, nothing will ever turn it back off on its
// own. This clears it automatically after 6 hours, which covers every
// realistic Instagram Live length (most run under an hour; anyone doing
// genuinely long broadcasts is already on YouTube or Kick, which are
// checked for real). Prevents a forgotten toggle from showing LIVE for days.
async function expireStaleInstagramLive(env) {

  const cutoff = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();

  await env.DB
    .prepare(
      `
      UPDATE streamers
      SET instagram_is_live = 0
      WHERE instagram_is_live = 1
      AND instagram_live_set_at < ?
      `
    )
    .bind(cutoff)
    .run();

}

export default {

  // Runs on the cron schedule defined in wrangler.toml.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(updateYoutubeLiveStatuses(env));
    ctx.waitUntil(updateKickLiveStatuses(env));
    ctx.waitUntil(expireStaleInstagramLive(env));
  },

  async fetch(request, env) {

    const url = new URL(request.url);

    if (url.pathname === "/api/chat") {

  const id = env.CHAT_ROOM.idFromName("main");

  const room = env.CHAT_ROOM.get(id);

  return room.fetch(request);

}

    // =====================
    // COMMENTS API
    // =====================

    if (url.pathname === "/api/comments") {

      // GET comments
      if (request.method === "GET") {

        const { results } = await env.DB
          .prepare(
            "SELECT * FROM comments ORDER BY id ASC"
          )
          .all();

        return Response.json(results);
      }


      // POST comment
      if (request.method === "POST") {

        const ip = request.headers.get("CF-Connecting-IP") || "unknown";

        if (await isRateLimited(env, ip, "comment", 3)) {

          return Response.json(
            { error: "rate_limited" },
            { status: 429 }
          );

        }

        const data = await request.json();

        await env.DB
          .prepare(
            `
            INSERT INTO comments
            (username, message, color, created_at)
            VALUES (?, ?, ?, ?)
            `
          )
          .bind(
            data.username,
            data.message,
            sanitizeColor(data.color),
            data.created_at
          )
          .run();


        return Response.json({
          success: true
        });
      }
    }
    
    // =====================
    // ALERT API
    // =====================

    if (url.pathname === "/api/alert") {

      // GET current alert
      if (request.method === "GET") {

        const { results } = await env.DB
          .prepare(
            "SELECT * FROM alerts ORDER BY id DESC LIMIT 1"
          )
          .all();

        if (results.length === 0) {
          return Response.json(null);
        }

        return Response.json(results[0]);

      }


      // POST new alert
      if (request.method === "POST") {

        const authError = await requireAdmin(request, env);
        if (authError) return authError;

        const data = await request.json();

        await env.DB
          .prepare(
            "INSERT INTO alerts (type, message) VALUES (?, ?)"
          )
          .bind(
            data.type,
            data.message
          )
          .run();


        return Response.json({
          success: true
        });

      }


      // DELETE alert
      if (request.method === "DELETE") {

        const authError = await requireAdmin(request, env);
        if (authError) return authError;

        await env.DB
          .prepare(
            "DELETE FROM alerts"
          )
          .run();


        return Response.json({
          success: true
        });

      }

    }


    // =====================
    // FEATURED VIDEOS API
    // =====================

    if (url.pathname === "/api/featured-videos") {

      // GET all featured videos
      if (request.method === "GET") {

        const { results } = await env.DB
          .prepare(
            "SELECT * FROM featured_videos ORDER BY id DESC"
          )
          .all();

        return Response.json(results);

      }


      // POST new featured video
      if (request.method === "POST") {

        const authError = await requireAdmin(request, env);
        if (authError) return authError;

        const data = await request.json();

        if (!data.embed_url) {
          return Response.json({
            error: "embed_url is required"
          }, {
            status: 400
          });
        }

        await env.DB
          .prepare(
            "INSERT INTO featured_videos (embed_url, title) VALUES (?, ?)"
          )
          .bind(
            data.embed_url,
            data.title || null
          )
          .run();


        return Response.json({
          success: true
        });

      }

    }


    // DELETE a single featured video by id
    if (url.pathname.startsWith("/api/featured-videos/") && request.method === "DELETE") {

      const authError = await requireAdmin(request, env);
      if (authError) return authError;

      const id = url.pathname.split("/api/featured-videos/")[1];

      await env.DB
        .prepare(
          "DELETE FROM featured_videos WHERE id = ?"
        )
        .bind(id)
        .run();


      return Response.json({
        success: true
      });

    }


    // =====================
    // STREAMERS API
    // =====================

    if (url.pathname === "/api/streamers") {

      // GET streamers
      if (request.method === "GET") {

        const { results } = await env.DB
          .prepare(
            "SELECT * FROM streamers ORDER BY id ASC"
          )
          .all();

        // Backfill slugs for any streamers created before slugs existed
        for (const streamer of results) {
          if (!streamer.slug) {
            const newSlug = await generateUniqueStreamerSlug(env, streamer.name, streamer.id);
            await env.DB
              .prepare("UPDATE streamers SET slug = ? WHERE id = ?")
              .bind(newSlug, streamer.id)
              .run();
            streamer.slug = newSlug;
          }
        }

        return Response.json(results);

      }


      // POST new streamer
      if (request.method === "POST") {

        const authError = await requireAdmin(request, env);
        if (authError) return authError;

        const data = await request.json();

        const slug = await generateUniqueStreamerSlug(env, data.name);

        await env.DB
          .prepare(
            `
            INSERT INTO streamers
            (name, platform, channel, status, slug, embed_channel_id, ticker)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            `
          )
          .bind(
            data.name,
            data.platform,
            data.channel,
            data.status,
            slug,
            data.embedChannelId || null,
            data.ticker || null
          )
          .run();


        return Response.json({
          success: true,
          slug: slug
        });

      }

            // UPDATE streamer status
      if (request.method === "PUT") {

        const authError = await requireAdmin(request, env);
        if (authError) return authError;

        const data = await request.json();

        // Full edit from the admin Edit button — has name/platform/channel present.
        if (data.name !== undefined) {

          await env.DB
            .prepare(
              `
              UPDATE streamers
              SET name = ?, platform = ?, channel = ?, status = ?, embed_channel_id = ?, kick_channel = ?, ticker = ?
              WHERE id = ?
              `
            )
            .bind(
              data.name,
              data.platform,
              data.channel,
              data.status,
              data.embedChannelId || null,
              data.kickChannel || null,
              data.ticker || null,
              data.id
            )
            .run();

          return Response.json({ success: true });

        }

        if (data.embedChannelId !== undefined) {

          await env.DB
            .prepare(
              "UPDATE streamers SET embed_channel_id = ? WHERE id = ?"
            )
            .bind(
              data.embedChannelId || null,
              data.id
            )
            .run();

          return Response.json({ success: true });

        }

        if (data.kickChannel !== undefined) {

          await env.DB
            .prepare(
              "UPDATE streamers SET kick_channel = ? WHERE id = ?"
            )
            .bind(
              data.kickChannel || null,
              data.id
            )
            .run();

          return Response.json({ success: true });

        }

        // Only one streamer can be pinned as featured at a time, so setting
        // one clears any previous pin first rather than requiring the admin
        // to manually unpin the old one.
        if (data.featuredPinned !== undefined) {

          if (data.featuredPinned) {

            await env.DB
              .prepare("UPDATE streamers SET featured_pinned = 0")
              .run();

            await env.DB
              .prepare("UPDATE streamers SET featured_pinned = 1 WHERE id = ?")
              .bind(data.id)
              .run();

          } else {

            await env.DB
              .prepare("UPDATE streamers SET featured_pinned = 0 WHERE id = ?")
              .bind(data.id)
              .run();

          }

          return Response.json({ success: true });

        }

        // Stock trend is a manual, admin-set signal (not automated) — "up"
        // or "down" to flag a streamer as more/less entertaining lately,
        // or null to clear it back to no opinion set. Every change (including
        // clearing) is also logged to stock_history with a timestamp, so the
        // full up/down timeline can be graphed later — the streamers.stock_trend
        // column only ever holds the current value, this table is what makes
        // history possible.
        if (data.stockTrend !== undefined) {

          await env.DB
            .prepare(
              "UPDATE streamers SET stock_trend = ? WHERE id = ?"
            )
            .bind(
              data.stockTrend,
              data.id
            )
            .run();

          await env.DB
            .prepare(
              "INSERT INTO stock_history (streamer_id, trend, changed_at) VALUES (?, ?, ?)"
            )
            .bind(
              data.id,
              data.stockTrend,
              Date.now()
            )
            .run();

          return Response.json({ success: true });

        }

        // Instagram has no public API to verify live status, so this is a
        // manual, self-reported toggle rather than something we check
        // automatically. instagram_live_set_at gets stamped here so the
        // cron can auto-expire it after 6 hours (see expireStaleInstagramLive)
        // instead of it staying stuck "live" forever if it's forgotten.
        if (data.instagramLive !== undefined) {

          await env.DB
            .prepare(
              `
              UPDATE streamers
              SET instagram_is_live = ?,
                  instagram_live_set_at = ?
              WHERE id = ?
              `
            )
            .bind(
              data.instagramLive ? 1 : 0,
              data.instagramLive ? new Date().toISOString() : null,
              data.id
            )
            .run();

          return Response.json({ success: true });

        }

        await env.DB
          .prepare(
            "UPDATE streamers SET status = ? WHERE id = ?"
          )
          .bind(
            data.status,
            data.id
          )
          .run();

        return Response.json({
          success: true
        });

      }

      // DELETE streamer
      if (request.method === "DELETE") {

        const authError = await requireAdmin(request, env);
        if (authError) return authError;

        const data = await request.json();

        await env.DB
          .prepare(
            "DELETE FROM streamers WHERE id = ?"
          )
          .bind(data.id)
          .run();


        return Response.json({
          success: true
        });

      }

    }

    // =====================
    // ARTICLES API
    // =====================

    if (url.pathname === "/api/articles") {

      // GET articles (newest first)
      if (request.method === "GET") {

        const { results } = await env.DB
          .prepare(
            `
            SELECT articles.*, streamers.name AS streamerName, streamers.slug AS streamerSlug,
              (SELECT COUNT(*) FROM article_comments WHERE article_comments.article_id = articles.id) AS commentCount
            FROM articles
            LEFT JOIN streamers ON articles.streamer_id = streamers.id
            ORDER BY articles.id DESC
            `
          )
          .all();

        // Backfill slugs for any articles created before slugs existed
        for (const article of results) {
          if (!article.slug) {
            const newSlug = await generateUniqueSlug(env, article.title, article.id);
            await env.DB
              .prepare("UPDATE articles SET slug = ? WHERE id = ?")
              .bind(newSlug, article.id)
              .run();
            article.slug = newSlug;
          }
        }

        return Response.json(results);

      }


      // POST new article
      if (request.method === "POST") {

        const authError = await requireAdmin(request, env);
        if (authError) return authError;

        const data = await request.json();

        const slug = await generateUniqueSlug(env, data.title);

        await env.DB
          .prepare(
            `
            INSERT INTO articles
            (title, date, contentTop, image, image_width, image_height, youtube, contentBottom, slug, streamer_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `
          )
          .bind(
            data.title,
            data.date,
            data.contentTop,
            data.image,
            data.imageWidth || null,
            data.imageHeight || null,
            data.youtube,
            data.contentBottom,
            slug,
            data.streamerId || null
          )
          .run();


        return Response.json({
          success: true,
          slug: slug
        });

      }


      // UPDATE existing article
      if (request.method === "PUT") {

        const authError = await requireAdmin(request, env);
        if (authError) return authError;

        const data = await request.json();

        // Keep the existing slug stable even if the title changes, so
        // previously shared links keep working. Only generate a fresh
        // one if this article somehow doesn't have one yet.
        const existing = await env.DB
          .prepare("SELECT slug FROM articles WHERE id = ?")
          .bind(data.id)
          .first();

        const slug = (existing && existing.slug)
          ? existing.slug
          : await generateUniqueSlug(env, data.title, data.id);

        await env.DB
          .prepare(
            `
            UPDATE articles
            SET title = ?, date = ?, contentTop = ?, image = ?, image_width = ?, image_height = ?, youtube = ?, contentBottom = ?, slug = ?, streamer_id = ?
            WHERE id = ?
            `
          )
          .bind(
            data.title,
            data.date,
            data.contentTop,
            data.image,
            data.imageWidth || null,
            data.imageHeight || null,
            data.youtube,
            data.contentBottom,
            slug,
            data.streamerId || null,
            data.id
          )
          .run();

        return Response.json({
          success: true,
          slug: slug
        });

      }


      // DELETE article
      if (request.method === "DELETE") {

        const authError = await requireAdmin(request, env);
        if (authError) return authError;

        const data = await request.json();

        await env.DB
          .prepare(
            "DELETE FROM articles WHERE id = ?"
          )
          .bind(data.id)
          .run();


        return Response.json({
          success: true
        });

      }

    }

    // =====================
    // ARTICLE COMMENTS API
    // =====================

    if (url.pathname === "/api/article-comments") {

      // GET comments for one article (public - no IP addresses included)
      if (request.method === "GET") {

        const articleId = url.searchParams.get("article_id");

        const { results } = await env.DB
          .prepare(
            "SELECT id, article_id, username, message, color, created_at, parent_id FROM article_comments WHERE article_id = ? ORDER BY id ASC"
          )
          .bind(articleId)
          .all();

        return Response.json(results);

      }


      // POST new comment (blocked if the IP is banned)
      if (request.method === "POST") {

        const ip = request.headers.get("CF-Connecting-IP") || "unknown";

        const banned = await env.DB
          .prepare(
            "SELECT ip_address FROM banned_ips WHERE ip_address = ?"
          )
          .bind(ip)
          .first();

        if (banned) {

          return Response.json(
            { error: "banned" },
            { status: 403 }
          );

        }

        if (await isRateLimited(env, ip, "article_comment", 8)) {

          return Response.json(
            { error: "rate_limited" },
            { status: 429 }
          );

        }

        const data = await request.json();

        await env.DB
          .prepare(
            `
            INSERT INTO article_comments
            (article_id, username, message, color, created_at, ip_address, parent_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            `
          )
          .bind(
            data.article_id,
            data.username,
            data.message,
            sanitizeColor(data.color),
            data.created_at,
            ip,
            data.parent_id ?? null
          )
          .run();

        return Response.json({
          success: true
        });

      }


      // DELETE a comment (admin)
      if (request.method === "DELETE") {

        const authError = await requireAdmin(request, env);
        if (authError) return authError;

        const data = await request.json();

        await env.DB
          .prepare(
            "DELETE FROM article_comments WHERE id = ?"
          )
          .bind(data.id)
          .run();

        return Response.json({
          success: true
        });

      }

    }


    // GET all comments including IP addresses (admin moderation view)
    if (url.pathname === "/api/article-comments/admin") {

      if (request.method === "GET") {

        const authError = await requireAdmin(request, env);
        if (authError) return authError;

        const { results } = await env.DB
          .prepare(
            `
            SELECT article_comments.*, articles.title AS article_title, parent.username AS reply_to_username
            FROM article_comments
            LEFT JOIN articles ON articles.id = article_comments.article_id
            LEFT JOIN article_comments AS parent ON parent.id = article_comments.parent_id
            ORDER BY article_comments.id DESC
            `
          )
          .all();

        return Response.json(results);

      }

    }


    // =====================
    // BANNED IPS API
    // =====================

    if (url.pathname === "/api/banned-ips") {

      const authError = await requireAdmin(request, env);
      if (authError) return authError;

      // GET banned IPs
      if (request.method === "GET") {

        const { results } = await env.DB
          .prepare(
            "SELECT * FROM banned_ips ORDER BY banned_at DESC"
          )
          .all();

        return Response.json(results);

      }


      // POST ban an IP
      if (request.method === "POST") {

        const data = await request.json();

        await env.DB
          .prepare(
            "INSERT OR IGNORE INTO banned_ips (ip_address, banned_at) VALUES (?, ?)"
          )
          .bind(
            data.ip_address,
            new Date().toISOString()
          )
          .run();

        return Response.json({
          success: true
        });

      }


      // DELETE unban an IP
      if (request.method === "DELETE") {

        const data = await request.json();

        await env.DB
          .prepare(
            "DELETE FROM banned_ips WHERE ip_address = ?"
          )
          .bind(data.ip_address)
          .run();

        return Response.json({
          success: true
        });

      }

    }

    // =====================
    // ARTICLE IMAGE UPLOADS (R2)
    // =====================

    if (url.pathname === "/api/upload-image" && request.method === "POST") {

      const authError = await requireAdmin(request, env);
      if (authError) return authError;

      const contentType = request.headers.get("Content-Type") || "";

      if (!contentType.startsWith("image/")) {
        return Response.json({ error: "must be an image" }, { status: 400 });
      }

      const contentLength = Number(request.headers.get("Content-Length") || 0);
      const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB

      if (contentLength > MAX_IMAGE_BYTES) {
        return Response.json({ error: "image too large (10MB max)" }, { status: 413 });
      }

      const filename = url.searchParams.get("filename") || "upload";

      const key = `${Date.now()}-${filename}`;

      await env.IMAGES.put(key, request.body, {
        httpMetadata: {
          contentType: contentType
        }
      });

      return Response.json({
        success: true,
        path: `/api/images/${encodeURIComponent(key)}`
      });

    }

    if (url.pathname.startsWith("/api/images/")) {

      const key = decodeURIComponent(url.pathname.replace("/api/images/", ""));

      const object = await env.IMAGES.get(key);

      if (!object) {
        return new Response("Not found", { status: 404 });
      }

      const headers = new Headers();

      object.writeHttpMetadata(headers);

      headers.set("etag", object.httpEtag);

      return new Response(object.body, { headers });

    }

    // GET a single article by slug (used by the single-article page)
    if (url.pathname.startsWith("/api/articles/")) {

      if (request.method === "GET") {

        const slug = decodeURIComponent(url.pathname.replace("/api/articles/", ""));

        const article = await env.DB
          .prepare(
            `
            SELECT articles.*, streamers.name AS streamerName, streamers.slug AS streamerSlug
            FROM articles
            LEFT JOIN streamers ON articles.streamer_id = streamers.id
            WHERE articles.slug = ?
            `
          )
          .bind(slug)
          .first();

        if (!article) {
          return new Response("Not found", { status: 404 });
        }

        return Response.json(article);

      }

    }

    // =====================
    // STREAMER ARTICLES API (used by streamer pages)
    // =====================

    if (url.pathname.startsWith("/api/streamers/") && url.pathname.endsWith("/articles") && request.method === "GET") {

      const streamerSlug = decodeURIComponent(
        url.pathname.replace("/api/streamers/", "").replace("/articles", "")
      );

      const streamer = await env.DB
        .prepare("SELECT * FROM streamers WHERE slug = ?")
        .bind(streamerSlug)
        .first();

      if (!streamer) {
        return new Response("Not found", { status: 404 });
      }

      const { results: articles } = await env.DB
        .prepare(
          `
          SELECT articles.*, streamers.name AS streamerName, streamers.slug AS streamerSlug,
            (SELECT COUNT(*) FROM article_comments WHERE article_comments.article_id = articles.id) AS commentCount
          FROM articles
          LEFT JOIN streamers ON articles.streamer_id = streamers.id
          WHERE streamers.slug = ?
          ORDER BY articles.id DESC
          `
        )
        .bind(streamerSlug)
        .all();

      return Response.json({ streamer, articles });

    }

    // =====================
    // STOCK HISTORY API (not used by any page yet — this just exposes the
    // timeline being logged in PUT /api/streamers above, ready for a future
    // chart to read from)
    // =====================

    if (url.pathname.startsWith("/api/streamers/") && url.pathname.endsWith("/stock-history") && request.method === "GET") {

      const streamerId = url.pathname.replace("/api/streamers/", "").replace("/stock-history", "");

      const { results } = await env.DB
        .prepare(
          "SELECT trend, changed_at FROM stock_history WHERE streamer_id = ? ORDER BY changed_at ASC"
        )
        .bind(streamerId)
        .all();

      return Response.json(results);

    }

    // Bulk version of the above — every streamer, joined with whatever
    // stock_history rows they have from the last 30 days, in a single query.
    // Used by both the homepage "top movers" widget and the full stock.html
    // page, so neither has to make one request per streamer. A streamer
    // with no rows in the window still comes back (as a single row with
    // trend/changed_at both null, courtesy of the LEFT JOIN) so the frontend
    // can show "no recent movement" instead of just omitting them.
    if (url.pathname === "/api/stock-history" && request.method === "GET") {

      const cutoff = Date.now() - (30 * 24 * 60 * 60 * 1000);

      const { results } = await env.DB
        .prepare(
          `
          SELECT streamers.id AS streamer_id, streamers.name, streamers.ticker,
            stock_history.trend, stock_history.changed_at
          FROM streamers
          LEFT JOIN stock_history
            ON stock_history.streamer_id = streamers.id
            AND stock_history.changed_at >= ?
          ORDER BY streamers.id ASC, stock_history.changed_at ASC
          `
        )
        .bind(cutoff)
        .all();

      return Response.json(results);

    }

    // =====================
    // STREAMER DIRECTORY + INDIVIDUAL STREAMER PAGES (server-rendered meta tags)
    // =====================

    if (url.pathname === "/streamers" || url.pathname.startsWith("/streamer/")) {

      const isDirectory = url.pathname === "/streamers";

      let pageTitle = "Streamers | CowTube";
      let plainDescription = "Browse every streamer covered on CowTube.";
      let injectedExtra = "";

      if (!isDirectory) {

        const slug = decodeURIComponent(url.pathname.replace("/streamer/", ""));

        const streamer = await env.DB
          .prepare("SELECT * FROM streamers WHERE slug = ?")
          .bind(slug)
          .first();

        if (!streamer) {
          return new Response("Streamer not found", { status: 404 });
        }

        pageTitle = escapeHtml(streamer.name) + " | CowTube";
        plainDescription = `Articles about ${escapeHtml(streamer.name)} on CowTube.`;
        injectedExtra = `<script>window.SINGLE_STREAMER_SLUG = ${JSON.stringify(streamer.slug)};</script>`;

      } else {

        injectedExtra = `<script>window.SHOW_STREAMER_DIRECTORY = true;</script>`;

      }

      const templateRequest = new Request(new URL("/", request.url), request);
      const templateResponse = await env.ASSETS.fetch(templateRequest);
      let html = await templateResponse.text();

      const canonicalUrl = `${url.origin}${url.pathname}`;

      const injectedTags = `
    <base href="/">
    <title>${pageTitle}</title>
    <meta name="description" content="${plainDescription}">
    <link rel="canonical" href="${canonicalUrl}">
    <meta property="og:type" content="website">
    <meta property="og:title" content="${pageTitle}">
    <meta property="og:description" content="${plainDescription}">
    <meta property="og:url" content="${canonicalUrl}">
    ${injectedExtra}
`;

      html = html.replace(/<title>.*?<\/title>/i, "");
      html = html.replace("<head>", `<head>\n${injectedTags}`);

      return new Response(html, {
        headers: { "Content-Type": "text/html;charset=UTF-8" }
      });

    }

    // =====================
    // INDIVIDUAL ARTICLE PAGES (server-rendered meta tags for sharing/SEO)
    // =====================

    if (url.pathname.startsWith("/article/")) {

      const slug = decodeURIComponent(url.pathname.replace("/article/", ""));

      const article = await env.DB
        .prepare("SELECT * FROM articles WHERE slug = ?")
        .bind(slug)
        .first();

      if (!article) {
        return new Response("Article not found", { status: 404 });
      }

      const templateRequest = new Request(new URL("/", request.url), request);
      const templateResponse = await env.ASSETS.fetch(templateRequest);
      let html = await templateResponse.text();

      const pageTitle = escapeHtml(article.title) + " | CowTube";

      const plainDescription = escapeHtml(
        (article.contentTop || "").replace(/\s+/g, " ").trim().slice(0, 200)
      );

      const imageUrl = article.image
        ? (article.image.startsWith("http") ? article.image : `${url.origin}${article.image}`)
        : `${url.origin}/Images/Banner/CowTubeClean.png`;

      const canonicalUrl = `${url.origin}/article/${article.slug}`;

      const injectedTags = `
    <base href="/">
    <title>${pageTitle}</title>
    <meta name="description" content="${plainDescription}">
    <link rel="canonical" href="${canonicalUrl}">
    <meta property="og:type" content="article">
    <meta property="og:title" content="${pageTitle}">
    <meta property="og:description" content="${plainDescription}">
    <meta property="og:image" content="${imageUrl}">
    <meta property="og:url" content="${canonicalUrl}">
    <meta name="twitter:card" content="summary_large_image">
    <script>window.SINGLE_ARTICLE_SLUG = ${JSON.stringify(article.slug)};</script>
`;

      html = html.replace(/<title>.*?<\/title>/i, "");
      html = html.replace("<head>", `<head>\n${injectedTags}`);

      return new Response(html, {
        headers: { "Content-Type": "text/html;charset=UTF-8" }
      });

    }

    // =====================
    // HOMEPAGE (server-rendered alert box)
    // =====================
    // The alert box used to start hidden in the static HTML and only get
    // shown/populated by client-side JS after an async fetch — meaning any
    // active alert would pop into existence and shove everything below it
    // down a beat after the page had already rendered. That's a layout
    // shift on essentially every homepage load whenever an alert is active,
    // regardless of scrolling. Baking the correct final state directly into
    // the HTML the server sends means there's nothing to pop in — the first
    // paint is already correct. loadAlert() in script.js still runs on
    // load too, but now it's just confirming state that's already right
    // rather than fixing a wrong one — it was never live-polling and still
    // isn't, so an alert posted while someone already has the page open
    // won't appear until they reload, same as before this change.
    if (url.pathname === "/") {

      const alert = await env.DB
        .prepare("SELECT * FROM alerts ORDER BY id DESC LIMIT 1")
        .first();

      const templateResponse = await env.ASSETS.fetch(request);
      let html = await templateResponse.text();

      let renderedAlertBox;

      if (!alert) {

        renderedAlertBox = `<div id="alertBox" class="hidden"></div>`;

      } else {

        const bgColor = alert.type === "maintenance" ? "#e74c3c" : "#2ecc71";

        renderedAlertBox = `<div id="alertBox" style="background-color: ${bgColor};">${escapeHtml(alert.message)}</div>`;

      }

      html = html.replace(
        `<div id="alertBox" class="hidden"></div>`,
        renderedAlertBox
      );

      return new Response(html, {
        headers: { "Content-Type": "text/html;charset=UTF-8" }
      });

    }

    // =====================
    // WEBSITE FILES
    // =====================

    return env.ASSETS.fetch(request);

  }
};