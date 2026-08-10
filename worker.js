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
    // WEBSITE FILES
    // =====================

    return env.ASSETS.fetch(request);

  }
};