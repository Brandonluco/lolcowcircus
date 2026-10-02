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

      // Internal-only call from the worker's /api/comments/clear admin
      // endpoint below — Durable Object stubs aren't reachable from the
      // public internet, only from within this Worker, so this can't be
      // hit directly by a visitor. Tells everyone currently connected to
      // clear their chat view live, instead of only wiping it for people
      // on their next page load.
      if (request.method === "POST") {

        for (const session of this.sessions) {
          try {
            session.send(JSON.stringify({ type: "clear" }));
          } catch (err) {
            console.log("Dropping dead session while broadcasting clear:", err);
            this.sessions.delete(session);
          }
        }

        return new Response(null, { status: 204 });

      }

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

// Spotify track IDs are always 22 base62 characters. Accepts whatever an
// admin might realistically paste — the bare ID, a full share link (with
// or without the ?si=... tracking param), or a spotify:track:... URI — and
// pulls just the ID out of it. Returns null for anything that doesn't
// contain a real-looking one, so garbage never reaches the database and
// this can't become an injection point later just because someone pastes
// something unexpected here.
function extractSpotifyTrackId(input) {

  const value = String(input || "").trim();

  const urlMatch = value.match(/track[/:]([A-Za-z0-9]{22})/);

  if (urlMatch) {
    return urlMatch[1];
  }

  return /^[A-Za-z0-9]{22}$/.test(value) ? value : null;

}

// Accepts whatever an admin might realistically paste for a reel — the
// normal instagram.com/reel/... link, one with a tracking query string
// still attached, an instagram.com/reels/... link, or a share link missing
// "www." — and, if it's genuinely a real Instagram reel/post permalink,
// returns a clean, canonical https://www.instagram.com/reel/<code>/ URL.
// Returns null for anything else (a random URL, plain text, a javascript:
// URI, etc.), so garbage — or something crafted to break out of the embed
// markup — never reaches the database and this can't become an injection
// point later just because someone pastes something unexpected here.
function extractInstagramReelUrl(input) {

  const value = String(input || "").trim();

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:") {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  if (host !== "instagram.com" && host !== "www.instagram.com") {
    return null;
  }

  const match = parsed.pathname.match(/^\/(?:reel|reels|p)\/([A-Za-z0-9_-]+)\/?$/);
  if (!match) {
    return null;
  }

  return `https://www.instagram.com/reel/${match[1]}/`;

}

// Optional field on Creator of the Week: a link to the creator's own
// Instagram profile, so their name in that box can point somewhere. Same
// reasoning as extractInstagramReelUrl above — only a genuine
// instagram.com/<username>/ profile URL is accepted, reserved path
// segments that aren't usernames (reel/reels/p/explore) are rejected so
// this can't be pointed at something other than an actual profile, and
// anything else (including empty input, since this field is optional)
// returns null rather than storing garbage.
function extractInstagramProfileUrl(input) {

  const value = String(input || "").trim();
  if (!value) {
    return null;
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:") {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  if (host !== "instagram.com" && host !== "www.instagram.com") {
    return null;
  }

  const match = parsed.pathname.match(/^\/([A-Za-z0-9_.]{1,30})\/?$/);
  if (!match) {
    return null;
  }

  const reserved = ["reel", "reels", "p", "explore", "stories", "accounts"];
  if (reserved.includes(match[1].toLowerCase())) {
    return null;
  }

  return `https://www.instagram.com/${match[1]}/`;

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

  let token = request.headers.get("Cf-Access-Jwt-Assertion");

  if (!token) {
    // Fallback: check if the browser sent the Cloudflare Access cookie directly
    const cookieHeader = request.headers.get("Cookie") || "";
    const match = cookieHeader.match(/CF_Authorization=([^;]+)/);
    if (match) {
      token = match[1];
    }
  }

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

// Splits an array into chunks of at most `size` — used below because
// videos.list accepts at most 50 comma-separated IDs per call. With 50 or
// fewer YouTube streamers this is just one chunk (one call); past that it's
// still far fewer calls than one-per-channel.
function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

// Finds each channel's most recently uploaded video via the "uploads
// playlist" trick (a channel's uploads playlist ID is always its channel ID
// with the leading "UC" swapped for "UU"), so no extra channels.list call
// is needed to look that playlist ID up. This step costs 1 quota unit PER
// CHANNEL and can't be batched — YouTube's playlistItems.list only accepts
// a single playlist ID per request, unlike videos.list below. Returns a
// Map of channelId -> videoId (or null if the channel has no videos, isn't
// a standard "UC..." ID, or the call failed).
async function fetchLatestVideoIds(channelIds, env) {

  const result = new Map();

  for (const channelId of channelIds) {

    if (!channelId.startsWith("UC")) {
      // Not a standard channel ID — can't derive the uploads playlist ID this way.
      console.log(`YouTube check skipped for ${channelId}: not a UC... channel ID`);
      result.set(channelId, null);
      continue;
    }

    const uploadsPlaylistId = "UU" + channelId.slice(2);

    try {

      const playlistRes = await fetch(
        `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=1&playlistId=${encodeURIComponent(uploadsPlaylistId)}&key=${env.YOUTUBE_API_KEY}`
      );

      const playlistData = await playlistRes.json();

      if (!playlistRes.ok) {
        console.log(`YouTube playlistItems failed for ${channelId}: status=${playlistRes.status} error=${JSON.stringify(playlistData.error)}`);
        result.set(channelId, null);
        continue;
      }

      result.set(channelId, playlistData.items?.[0]?.snippet?.resourceId?.videoId || null);

    } catch (err) {

      console.log("YouTube playlistItems failed for", channelId, err.message);
      result.set(channelId, null);

    }

  }

  return result;

}

// THE BATCHING: videos.list accepts up to 50 comma-separated video IDs for
// a flat 1 quota unit total — not 1 unit per ID — so every video gathered
// above goes through here in as few calls as possible (just one, for up to
// 50 YouTube streamers) instead of the old one-call-per-channel approach.
// Returns a Map of videoId -> snippet (liveBroadcastContent, publishedAt).
async function fetchVideoSnippets(videoIds, env) {

  const result = new Map();

  for (const chunk of chunkArray(videoIds, 50)) {

    try {

      const videoRes = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${chunk.map(encodeURIComponent).join(",")}&key=${env.YOUTUBE_API_KEY}`
      );

      const videoData = await videoRes.json();

      if (!videoRes.ok) {
        console.log(`YouTube videos.list failed for a batch of ${chunk.length}: status=${videoRes.status} error=${JSON.stringify(videoData.error)}`);
        continue;
      }

      for (const item of videoData.items || []) {
        result.set(item.id, item.snippet);
      }

    } catch (err) {

      console.log(`YouTube videos.list failed for a batch of ${chunk.length}:`, err.message);

    }

  }

  return result;

}

// Loops over every streamer with a YouTube channel ID on file and refreshes
// their cached live status AND latest-video info in D1. Called on a
// schedule (see wrangler.toml).
//
// Quota cost per run is now ~1 unit per channel (the playlistItems.list
// lookup) plus 1 more unit per 50 channels (the batched videos.list call) —
// down from 2 units per channel before. For 20 YouTube streamers that's
// ~21 units per run instead of ~40, which at a 15-minute interval
// (96 runs/day) comes to roughly 2,000 units/day, well under the free
// 10,000/day ceiling with real room to grow the roster further.
async function updateYoutubeLiveStatuses(env) {

  if (!env.YOUTUBE_API_KEY) {
    console.log("YOUTUBE_API_KEY not set — skipping YouTube check");
    return;
  }

  const { results } = await env.DB
    .prepare(
      `
      SELECT id, embed_channel_id, youtube_live_video_id, latest_video_id
      FROM streamers
      WHERE platform LIKE '%youtube%'
      AND embed_channel_id IS NOT NULL
      AND embed_channel_id != ''
      `
    )
    .all();

  if (results.length === 0) {
    return;
  }

  const latestVideoIdByChannel = await fetchLatestVideoIds(
    results.map((streamer) => streamer.embed_channel_id),
    env
  );

  const videoIdsToCheck = Array.from(new Set(
    Array.from(latestVideoIdByChannel.values()).filter(Boolean)
  ));

  const snippetByVideoId = await fetchVideoSnippets(videoIdsToCheck, env);

  for (const streamer of results) {

    const latestVideoId = latestVideoIdByChannel.get(streamer.embed_channel_id);

    if (!latestVideoId) {
      // API call failed, channel has no videos, or an unusable channel ID —
      // leave whatever's already stored alone rather than clobbering it.
      continue;
    }

    const snippet = snippetByVideoId.get(latestVideoId);

    if (!snippet) {
      // Was in the batch request but didn't come back (e.g. that one video
      // got deleted/privated between the two calls) — same as above, leave
      // the stored value alone rather than guessing.
      continue;
    }

    // liveBroadcastContent is "live", "upcoming", or "none" — straight from
    // YouTube, not inferred.
    const liveBroadcastContent = snippet.liveBroadcastContent;
    const liveVideoId = liveBroadcastContent === "live" ? latestVideoId : null;
    const publishedAt = snippet.publishedAt || null;

    console.log(`YouTube check for ${streamer.embed_channel_id}: videoId=${latestVideoId} liveBroadcastContent=${liveBroadcastContent}`);

    const liveChanged = (liveVideoId || null) !== (streamer.youtube_live_video_id || null);
    const newVideoChanged = (latestVideoId || null) !== (streamer.latest_video_id || null);

    // Skip the write entirely if nothing changed since last check — this
    // only affects D1 write cost, not API quota, but no reason to write
    // rows that haven't changed either.
    if (!liveChanged && !newVideoChanged) {
      continue;
    }

    const now = new Date().toISOString();

    await env.DB
      .prepare(
        `
        UPDATE streamers
        SET youtube_live_video_id = ?,
            youtube_checked_at = ?,
            last_live_at = CASE WHEN ? IS NOT NULL THEN ? ELSE last_live_at END,
            latest_video_id = ?,
            latest_video_published_at = ?
        WHERE id = ?
        `
      )
      .bind(
        liveVideoId,
        now,
        liveVideoId, now,
        latestVideoId,
        publishedAt,
        streamer.id
      )
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
    // changed since last time, instead of writing a row every 15 minutes
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

    // Admin "Clear Chat" — wipes the persisted history AND tells anyone
    // currently connected to clear their view live, so a spam flood
    // doesn't keep sitting there for late arrivals just because it's
    // already been dealt with for people already in the room.
    if (url.pathname === "/api/comments/clear" && request.method === "POST") {

      const authError = await requireAdmin(request, env);
      if (authError) return authError;

      await env.DB.prepare("DELETE FROM comments").run();

      const id = env.CHAT_ROOM.idFromName("main");
      const room = env.CHAT_ROOM.get(id);

      await room.fetch("https://internal/clear", { method: "POST" });

      return Response.json({ success: true });

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


      // POST comment (blocked if the IP is banned — same list article
      // comments already check, so a ban actually stops someone site-wide
      // instead of just on articles)
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

        if (await isRateLimited(env, ip, "comment", 3)) {

          return Response.json(
            { error: "rate_limited" },
            { status: 429 }
          );

        }

        const data = await request.json();

        // The client trims to 500 chars / 20 chars, but that's only
        // enforced in the browser — anyone can POST directly to this
        // endpoint with whatever they want, so the same limits are
        // enforced again here before anything touches the database.
        const username = String(data.username || "").slice(0, 20);
        const message = String(data.message || "").trim().slice(0, 500);

        if (!message) {
          return Response.json(
            { error: "message is required" },
            { status: 400 }
          );
        }

        await env.DB
          .prepare(
            `
            INSERT INTO comments
            (username, message, color, created_at)
            VALUES (?, ?, ?, ?)
            `
          )
          .bind(
            username,
            message,
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
    // SONG OF THE WEEK API
    // =====================

    if (url.pathname === "/api/song-of-the-week") {

      // GET current pick
      if (request.method === "GET") {

        const { results } = await env.DB
          .prepare(
            "SELECT * FROM song_of_the_week ORDER BY id DESC LIMIT 1"
          )
          .all();

        if (results.length === 0) {
          return Response.json(null);
        }

        return Response.json(results[0]);

      }


      // POST new pick
      if (request.method === "POST") {

        const authError = await requireAdmin(request, env);
        if (authError) return authError;

        const data = await request.json();

        const trackId = extractSpotifyTrackId(data.trackId);

        if (!trackId) {
          return Response.json({
            error: "Couldn't find a valid Spotify track ID in that — paste the track's share link or just its ID."
          }, {
            status: 400
          });
        }

        await env.DB
          .prepare(
            "INSERT INTO song_of_the_week (track_id) VALUES (?)"
          )
          .bind(
            trackId
          )
          .run();


        return Response.json({
          success: true,
          trackId: trackId
        });

      }


      // DELETE current pick
      if (request.method === "DELETE") {

        const authError = await requireAdmin(request, env);
        if (authError) return authError;

        await env.DB
          .prepare(
            "DELETE FROM song_of_the_week"
          )
          .run();


        return Response.json({
          success: true
        });

      }

    }


    // =========================
    // CREATOR OF THE WEEK API
    // =========================

    // History note: every pick ever set stays in this table forever — POST
    // only ever INSERTs a new row, it never overwrites or removes old ones.
    // is_current marks which single row (if any) is the one currently
    // shown on the homepage; "current" is just a flag, not a separate
    // table, so /history and /leaderboard below can draw on the exact same
    // data as the homepage without needing to be kept in sync with it.

    if (url.pathname === "/api/creator-of-the-week") {

      // GET current pick
      if (request.method === "GET") {

        const { results } = await env.DB
          .prepare(
            "SELECT * FROM creator_of_the_week WHERE is_current = 1 ORDER BY id DESC LIMIT 1"
          )
          .all();

        if (results.length === 0) {
          return Response.json(null);
        }

        return Response.json(results[0]);

      }


      // POST new pick (or swap in a new video for the same creator —
      // this is meant to be updated as often as the admin likes, not
      // locked to once a week). The old current row isn't deleted, just
      // unmarked, so it still shows up in history/leaderboard afterward.
      if (request.method === "POST") {

        const authError = await requireAdmin(request, env);
        if (authError) return authError;

        const data = await request.json();

        const creatorName = String(data.creatorName || "").trim();

        if (!creatorName) {
          return Response.json({
            error: "Enter a creator name."
          }, {
            status: 400
          });
        }

        const reelUrl = extractInstagramReelUrl(data.reelUrl);

        if (!reelUrl) {
          return Response.json({
            error: "Couldn't find a valid Instagram reel link in that — paste the reel's share link (instagram.com/reel/...)."
          }, {
            status: 400
          });
        }

        // Optional — if something was entered but it isn't a real
        // instagram.com/<username>/ profile link, reject rather than
        // silently dropping it, so a typo doesn't just vanish.
        let profileUrl = null;
        if (String(data.profileUrl || "").trim()) {
          profileUrl = extractInstagramProfileUrl(data.profileUrl);
          if (!profileUrl) {
            return Response.json({
              error: "That profile link doesn't look like a real Instagram profile (instagram.com/username/) — leave it blank if you'd rather skip it."
            }, {
              status: 400
            });
          }
        }

        // Batched so this can't ever land on two "current" rows at once
        // (e.g. two admin tabs saving around the same moment) — both
        // statements commit together or not at all.
        await env.DB.batch([

          env.DB.prepare(
            "UPDATE creator_of_the_week SET is_current = 0 WHERE is_current = 1"
          ),

          env.DB.prepare(
            "INSERT INTO creator_of_the_week (creator_name, profile_url, reel_url, featured_at, is_current) VALUES (?, ?, ?, ?, 1)"
          ).bind(
            creatorName,
            profileUrl,
            reelUrl,
            Date.now()
          )

        ]);


        return Response.json({
          success: true,
          creatorName: creatorName,
          profileUrl: profileUrl,
          reelUrl: reelUrl
        });

      }


      // DELETE — clears the CURRENT pick only (so the homepage box goes
      // back to hidden). History is never erased this way; past picks
      // stay exactly as they were, just with nothing currently flagged.
      if (request.method === "DELETE") {

        const authError = await requireAdmin(request, env);
        if (authError) return authError;

        await env.DB
          .prepare(
            "UPDATE creator_of_the_week SET is_current = 0 WHERE is_current = 1"
          )
          .run();


        return Response.json({
          success: true
        });

      }

    }


    // Full chronological history — every pick ever set, most recent
    // first. Public: this is meant for visitors to browse, same as the
    // Streamer Stock history page.
    if (url.pathname === "/api/creator-of-the-week/history" && request.method === "GET") {

      const { results } = await env.DB
        .prepare(
          "SELECT * FROM creator_of_the_week ORDER BY featured_at DESC, id DESC"
        )
        .all();

      return Response.json(results);

    }


    // Leaderboard — how many times each name has been featured, most
    // featured first. Grouped on the exact name text as the admin typed
    // it each time, so using the same spelling/capitalization for a
    // repeat creator matters for this to count them correctly.
    if (url.pathname === "/api/creator-of-the-week/leaderboard" && request.method === "GET") {

      const { results } = await env.DB
        .prepare(`
          SELECT
            creator_name,
            profile_url,
            COUNT(*) as times_featured,
            MAX(featured_at) as last_featured
          FROM creator_of_the_week
          GROUP BY creator_name
          ORDER BY times_featured DESC, last_featured DESC
        `)
        .all();

      return Response.json(results);

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

        // stock_score is computed fresh every time rather than cached on
        // the streamers row — it's just a running SUM of stock_history, and
        // at this site's scale that's cheap enough to compute on read, so
        // there's no cached total that could ever drift out of sync with
        // the actual history.
        const { results } = await env.DB
          .prepare(
            `
            SELECT
              streamers.*,
              COALESCE((SELECT SUM(points) FROM stock_history WHERE stock_history.streamer_id = streamers.id), 0) AS stock_score
            FROM streamers
            ORDER BY streamers.id ASC
            `
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
    // STOCK HISTORY API
    // =====================

    // Admin-only: logs one point adjustment for a streamer — either a
    // routine ±0.02 nudge (the Stock Up/Down buttons) or a one-off custom
    // amount for something bigger (a very good or very bad stretch, getting
    // banned from a platform, etc). Nothing is ever overwritten or capped —
    // this is a running total that just keeps accumulating forever, same
    // idea as a real stock price. Multiple adjustments logged on the same
    // day both count (they're separate rows), rather than the later one
    // replacing the earlier one.
    if (url.pathname === "/api/streamers/stock" && request.method === "POST") {

      const authError = await requireAdmin(request, env);
      if (authError) return authError;

      const data = await request.json();

      const points = Number(data.points);

      if (!data.id || !Number.isFinite(points) || points === 0) {
        return Response.json({
          error: "Need a streamer ID and a non-zero point value."
        }, {
          status: 400
        });
      }

      const note = data.note ? String(data.note).trim().slice(0, 200) : null;

      await env.DB
        .prepare(
          "INSERT INTO stock_history (streamer_id, points, note, changed_at) VALUES (?, ?, ?, ?)"
        )
        .bind(
          data.id,
          points,
          note,
          Date.now()
        )
        .run();

      const { results } = await env.DB
        .prepare(
          "SELECT SUM(points) as total FROM stock_history WHERE streamer_id = ?"
        )
        .bind(data.id)
        .all();

      return Response.json({
        success: true,
        newTotal: results[0]?.total || 0
      });

    }

    // One streamer's full point-adjustment history, oldest first — not
    // currently used by any page (both script.js and stock.js use the bulk
    // endpoint below instead, so neither needs one request per streamer),
    // kept available for anything that wants a single streamer's timeline
    // on its own later.
    if (url.pathname.startsWith("/api/streamers/") && url.pathname.endsWith("/stock-history") && request.method === "GET") {

      const streamerId = url.pathname.replace("/api/streamers/", "").replace("/stock-history", "");

      const { results } = await env.DB
        .prepare(
          "SELECT points, note, changed_at FROM stock_history WHERE streamer_id = ? ORDER BY changed_at ASC"
        )
        .bind(streamerId)
        .all();

      return Response.json(results);

    }

    // Bulk version — every streamer, joined with their ENTIRE point history
    // (no date filter; this is lifetime data, not a rolling window), in a
    // single query. Used by both the homepage "top movers" widget (which
    // only displays the last 30 days of this, cut client-side) and the full
    // stock.html page (which lets the visitor pick 30d/3mo/6mo/1yr/all,
    // also client-side) — neither needs its own endpoint, since at this
    // site's scale the whole history for every streamer is still tiny to
    // send in one response. A streamer with no history at all still comes
    // back (as a single row with points/changed_at both null, courtesy of
    // the LEFT JOIN) so the frontend can show "no movement yet" instead of
    // just omitting them.
    if (url.pathname === "/api/stock-history" && request.method === "GET") {

      const { results } = await env.DB
        .prepare(
          `
          SELECT streamers.id AS streamer_id, streamers.name, streamers.ticker,
            stock_history.points, stock_history.changed_at
          FROM streamers
          LEFT JOIN stock_history
            ON stock_history.streamer_id = streamers.id
          ORDER BY streamers.id ASC, stock_history.changed_at ASC
          `
        )
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