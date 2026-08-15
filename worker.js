export class ChatRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Set();
  }

  async fetch(request) {
    const upgradeHeader = request.headers.get("Upgrade");

    if (upgradeHeader !== "websocket") {
      return new Response("Expected websocket", {
        status: 400
      });
    }

    const pair = new WebSocketPair();

    const [client, server] = Object.values(pair);

    server.accept();

    this.sessions.add(server);

    server.addEventListener("error", (event) => {
  console.log("WebSocket error:", event);
});

    server.addEventListener("close", () => {
  this.sessions.delete(server);
});

server.addEventListener("error", () => {
  this.sessions.delete(server);
});

server.addEventListener("message", (event) => {

    console.log("Broadcasting:", event.data);

  for (const session of this.sessions) {

    session.send(event.data);

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

// Checks whether a YouTube channel is currently live by following the
// channel's /live redirect (the same page a real visitor's browser loads),
// then confirming the resolved page is actually an active broadcast.
// No API key, no quota — just an ordinary fetch.
async function checkYoutubeLive(channelId) {

  try {

    const res = await fetch(
      `https://www.youtube.com/channel/${encodeURIComponent(channelId)}/live`,
      {
        redirect: "follow",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          // Without this, YouTube can route automated-looking requests
          // through a cookie consent page instead of the actual channel
          // page, which silently breaks this whole approach (no error,
          // just never finds a match). This tells YouTube consent is
          // already handled, same as a browser that already clicked through it.
          "Cookie": "CONSENT=YES+cb; SOCS=CAI"
        }
      }
    );

    console.log(`YouTube check for ${channelId}: status=${res.status} resolvedUrl=${res.url}`);

    if (!res.ok) {
      return null;
    }

    const html = await res.text();

    // YouTube's /live URL no longer reliably redirects to /watch?v=... in
    // the response URL — it can return 200 on the /live URL itself. So we
    // read the actual video ID out of the page's own canonical link instead
    // of relying on the URL changing.
    const canonicalMatch = html.match(
      /<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([a-zA-Z0-9_-]{6,})"/
    );

    if (!canonicalMatch) {
      // Page isn't pointing at a specific video at all — not live.
      return null;
    }

    const videoId = canonicalMatch[1];
    const isLive = html.includes('"isLiveNow":true') || html.includes('"isLive":true');

    console.log(`YouTube check for ${channelId}: videoId=${videoId} isLive=${isLive}`);

    return isLive ? videoId : null;

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
      SELECT id, embed_channel_id FROM streamers
      WHERE platform LIKE '%youtube%'
      AND embed_channel_id IS NOT NULL
      AND embed_channel_id != ''
      `
    )
    .all();

  for (const streamer of results) {

    const liveVideoId = await checkYoutubeLive(streamer.embed_channel_id);

    await env.DB
      .prepare(
        "UPDATE streamers SET youtube_live_video_id = ?, youtube_checked_at = ? WHERE id = ?"
      )
      .bind(liveVideoId, new Date().toISOString(), streamer.id)
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
      SELECT id, channel, kick_channel FROM streamers
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

    await env.DB
      .prepare(
        "UPDATE streamers SET kick_is_live = ?, kick_checked_at = ? WHERE id = ?"
      )
      .bind(isLive ? 1 : 0, new Date().toISOString(), streamer.id)
      .run();

  }

}

export default {

  // Runs on the cron schedule defined in wrangler.toml.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(updateYoutubeLiveStatuses(env));
    ctx.waitUntil(updateKickLiveStatuses(env));
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
            data.color,
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

        const data = await request.json();

        const slug = await generateUniqueStreamerSlug(env, data.name);

        await env.DB
          .prepare(
            `
            INSERT INTO streamers
            (name, platform, channel, status, slug, embed_channel_id)
            VALUES (?, ?, ?, ?, ?, ?)
            `
          )
          .bind(
            data.name,
            data.platform,
            data.channel,
            data.status,
            slug,
            data.embedChannelId || null
          )
          .run();


        return Response.json({
          success: true,
          slug: slug
        });

      }

            // UPDATE streamer status
      if (request.method === "PUT") {

        const data = await request.json();

        // Full edit from the admin Edit button — has name/platform/channel present.
        if (data.name !== undefined) {

          await env.DB
            .prepare(
              `
              UPDATE streamers
              SET name = ?, platform = ?, channel = ?, status = ?, embed_channel_id = ?, kick_channel = ?
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
            SELECT articles.*, streamers.name AS streamerName, streamers.slug AS streamerSlug
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

        const data = await request.json();

        const slug = await generateUniqueSlug(env, data.title);

        await env.DB
          .prepare(
            `
            INSERT INTO articles
            (title, date, contentTop, image, youtube, contentBottom, slug, streamer_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `
          )
          .bind(
            data.title,
            data.date,
            data.contentTop,
            data.image,
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
            SET title = ?, date = ?, contentTop = ?, image = ?, youtube = ?, contentBottom = ?, slug = ?, streamer_id = ?
            WHERE id = ?
            `
          )
          .bind(
            data.title,
            data.date,
            data.contentTop,
            data.image,
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
            data.color,
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

      const filename = url.searchParams.get("filename") || "upload";

      const key = `${Date.now()}-${filename}`;

      await env.IMAGES.put(key, request.body, {
        httpMetadata: {
          contentType: request.headers.get("Content-Type") || "application/octet-stream"
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
          SELECT articles.*, streamers.name AS streamerName, streamers.slug AS streamerSlug
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
    // WEBSITE FILES
    // =====================

    return env.ASSETS.fetch(request);

  }
};