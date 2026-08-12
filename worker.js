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










export default {
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

        return Response.json(results);

      }


      // POST new streamer
      if (request.method === "POST") {

        const data = await request.json();

        await env.DB
          .prepare(
            `
            INSERT INTO streamers
            (name, platform, channel, status)
            VALUES (?, ?, ?, ?)
            `
          )
          .bind(
            data.name,
            data.platform,
            data.channel,
            data.status
          )
          .run();


        return Response.json({
          success: true
        });

      }

            // UPDATE streamer status
      if (request.method === "PUT") {

        const data = await request.json();

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
            "SELECT * FROM articles ORDER BY id DESC"
          )
          .all();

        return Response.json(results);

      }


      // POST new article
      if (request.method === "POST") {

        const data = await request.json();

        await env.DB
          .prepare(
            `
            INSERT INTO articles
            (title, date, contentTop, image, youtube, contentBottom)
            VALUES (?, ?, ?, ?, ?, ?)
            `
          )
          .bind(
            data.title,
            data.date,
            data.contentTop,
            data.image,
            data.youtube,
            data.contentBottom
          )
          .run();


        return Response.json({
          success: true
        });

      }


      // UPDATE existing article
      if (request.method === "PUT") {

        const data = await request.json();

        await env.DB
          .prepare(
            `
            UPDATE articles
            SET title = ?, date = ?, contentTop = ?, image = ?, youtube = ?, contentBottom = ?
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
            data.id
          )
          .run();

        return Response.json({
          success: true
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

    // =====================
    // WEBSITE FILES
    // =====================

    return env.ASSETS.fetch(request);

  }
};