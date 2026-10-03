// =====================================================================
// CowTube Slots — server side (Stage 1: public API)
//
// Every outcome is decided HERE, never in the browser. The browser only
// ever asks "spin", and gets back what to animate. Nothing it reports
// back is trusted.
//
// Routes (all under /api/slots/):
//   GET  config       what's on the reels + your spins left + your name
//   POST spin         roll one spin
//   POST claim        a "choice" prize winner picks their streamer
//   POST name         set your leaderboard name (after your first win)
//   GET  leaderboard  top players
//
// Free-tier notes: a spin costs ~1 Worker request and ~1 D1 write. The
// symbol list/settings are cached in memory for 60s so spins don't re-read
// them, and a site-wide daily spin budget stops a flood from ever eating
// the whole D1 write allowance (which would take comments/articles down).
// =====================================================================

const DEFAULTS = {
  jackpot_points: 0.5,
  jackpot_odds: 1000,
  daily_spin_limit: 100,
  daily_streamer_cap: 2.0,
  jackpot_cooldown_hours: 24,
  min_streamers: 6,
  min_odds_floor: 50,
  global_daily_spin_limit: 30000
};

const CONFIG_TTL_MS = 60 * 1000;
const GLOBAL_TTL_MS = 30 * 1000;
const LEADERBOARD_TTL_MS = 60 * 1000;
const TOKEN_TTL_MS = 10 * 60 * 1000;
const NEAR_MISS_CHANCE = 0.2;
const CAP_EPSILON = 0.000001;

// ---------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------

function json(body, status = 200) {
  return Response.json(body, {
    status: status,
    headers: { "Cache-Control": "no-store" }
  });
}

// Uniform random integer in [0, n) with no modulo bias.
function randomInt(n) {
  const limit = Math.floor(0x100000000 / n) * n;
  const buf = new Uint32Array(1);
  do {
    crypto.getRandomValues(buf);
  } while (buf[0] >= limit);
  return buf[0] % n;
}

// Uniform random float in [0, 1) with 53 bits of precision.
function randomUnit() {
  const buf = new Uint32Array(2);
  crypto.getRandomValues(buf);
  return ((buf[0] >>> 5) * 67108864 + (buf[1] >>> 6)) / 9007199254740992;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function randomHex(bytes) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Daily limits reset at 00:00 UTC — same moment Cloudflare's own free-tier
// limits reset, so the site-wide spin budget lines up with them.
function todayUtc() {
  const now = new Date();
  return {
    day: now.toISOString().slice(0, 10),
    start: Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  };
}

// IPs are never stored raw for the slot machine — only this salted hash.
async function hashIp(env, ip) {
  const data = new TextEncoder().encode(`${env.SLOT_HASH_SALT}:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function imagePath(key) {
  return key ? `/api/images/${encodeURIComponent(key)}` : null;
}

// ---------------------------------------------------------------------
// Cached config: settings + faces on the reels + enabled prizes
// ---------------------------------------------------------------------

let configCache = { at: 0, data: null };

async function loadConfig(env, force) {

  const now = Date.now();

  if (!force && configCache.data && now - configCache.at < CONFIG_TTL_MS) {
    return configCache.data;
  }

  const [settingsRes, facesRes, prizesRes] = await env.DB.batch([
    env.DB.prepare("SELECT key, value FROM slot_settings"),
    env.DB.prepare(
      `
      SELECT slot_faces.streamer_id AS id, streamers.name AS name,
             slot_faces.image_key AS image_key, slot_faces.cooldown_until AS cooldown_until
      FROM slot_faces
      JOIN streamers ON streamers.id = slot_faces.streamer_id
      WHERE slot_faces.enabled = 1
        AND slot_faces.opted_out = 0
        AND slot_faces.image_key IS NOT NULL
      ORDER BY streamers.name ASC
      `
    ),
    env.DB.prepare(
      `
      SELECT id, name, image_key, points, odds, target
      FROM slot_prizes
      WHERE enabled = 1 AND image_key IS NOT NULL
      ORDER BY sort_order ASC, id ASC
      `
    )
  ]);

  const settings = { ...DEFAULTS };
  for (const row of settingsRes.results) {
    const value = Number(row.value);
    if (Number.isFinite(value)) {
      settings[row.key] = value;
    }
  }

  const floor = Math.max(2, settings.min_odds_floor);

  const data = {
    settings: settings,
    faces: facesRes.results.map((f) => ({
      id: f.id,
      name: f.name,
      image: imagePath(f.image_key),
      cooldownUntil: Number(f.cooldown_until) || 0
    })),
    prizes: prizesRes.results.map((p) => ({
      id: p.id,
      name: p.name,
      image: imagePath(p.image_key),
      points: Number(p.points),
      odds: Math.max(floor, Number(p.odds) || floor),
      target: p.target
    })),
    jackpotOdds: Math.max(floor, settings.jackpot_odds)
  };

  configCache = { at: now, data: data };

  return data;

}

// ---------------------------------------------------------------------
// Site-wide daily spin budget (the circuit breaker)
// ---------------------------------------------------------------------

let globalCache = { at: 0, day: "", total: 0 };

async function globalSpinsToday(env, day) {

  const now = Date.now();

  if (globalCache.day !== day || now - globalCache.at >= GLOBAL_TTL_MS) {

    const row = await env.DB
      .prepare("SELECT COALESCE(SUM(spins), 0) AS total FROM slot_spins WHERE day = ?")
      .bind(day)
      .first();

    globalCache = { at: now, day: day, total: Number(row?.total) || 0 };

  }

  return globalCache.total;

}

// ---------------------------------------------------------------------
// Stock changes (with the per-streamer daily cap enforced atomically)
// ---------------------------------------------------------------------

// Net slot points each streamer has moved so far today.
async function slotNetsToday(env, startMs) {

  const { results } = await env.DB
    .prepare(
      `
      SELECT streamer_id, SUM(points) AS net
      FROM stock_history
      WHERE source = 'slot' AND changed_at >= ?
      GROUP BY streamer_id
      `
    )
    .bind(startMs)
    .all();

  const nets = new Map();
  for (const row of results) {
    nets.set(Number(row.streamer_id), Number(row.net) || 0);
  }
  return nets;

}

function hasCapRoom(nets, streamerId, points, cap) {
  const net = nets.get(Number(streamerId)) || 0;
  return Math.abs(net + points) <= cap + CAP_EPSILON;
}

// One single INSERT ... SELECT ... WHERE: the cap check and the insert
// happen as one step, so two simultaneous wins can't both squeeze past it.
async function applyStockChange(env, streamerId, points, note, cap, startMs) {

  const result = await env.DB
    .prepare(
      `
      INSERT INTO stock_history (streamer_id, points, note, changed_at, source)
      SELECT ?1, ?2, ?3, ?4, 'slot'
      WHERE ABS(
        COALESCE(
          (SELECT SUM(points) FROM stock_history
           WHERE streamer_id = ?1 AND source = 'slot' AND changed_at >= ?5),
          0
        ) + ?2
      ) <= ?6
      `
    )
    .bind(streamerId, points, note, Date.now(), startMs, cap + CAP_EPSILON)
    .run();

  return result.meta.changes === 1;

}

// ---------------------------------------------------------------------
// Rolling the outcome
// ---------------------------------------------------------------------

// ONE roll decides everything: jackpot, one of the prizes, or nothing.
// Odds are fixed per outcome ("1 in N"), so adding more streamers never
// makes wins more frequent — it only changes who wins.
function rollOutcome(cfg) {

  const r = randomUnit();
  let acc = 1 / cfg.jackpotOdds;

  if (r < acc) {
    return { type: "jackpot" };
  }

  for (const prize of cfg.prizes) {
    acc += 1 / prize.odds;
    if (r < acc) {
      return { type: "prize", prize: prize };
    }
  }

  return { type: "none" };

}

const faceRef = (f) => ({ type: "face", id: f.id });
const prizeRef = (p) => ({ type: "prize", id: p.id });
const refKey = (r) => `${r.type}:${r.id}`;

// A losing spin: three symbols that are never all the same, with an
// occasional "near miss" (two matching). Purely cosmetic.
function noWinReels(cfg) {

  const pool = [...cfg.faces.map(faceRef), ...cfg.prizes.map(prizeRef)];
  const pick = () => pool[randomInt(pool.length)];

  const a = pick();
  let b = pick();
  let c = pick();

  if (randomUnit() < NEAR_MISS_CHANCE) {
    b = a;
  }

  let guard = 0;
  while (refKey(a) === refKey(b) && refKey(b) === refKey(c) && guard++ < 50) {
    c = pick();
  }

  return shuffle([a, b, c]);

}

// ---------------------------------------------------------------------
// Win bookkeeping
// ---------------------------------------------------------------------

// Logs the win and bumps the leaderboard count (only for positive wins,
// and only if this visitor already has a leaderboard name — otherwise
// the count is credited from the log when they claim a name).
async function recordWin(env, ipHash, kind, prizeId, streamerId, points) {

  await env.DB.batch([
    env.DB
      .prepare(
        "INSERT INTO slot_wins (ip_hash, kind, prize_id, streamer_id, points, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .bind(ipHash, kind, prizeId, streamerId, points, Date.now()),
    env.DB
      .prepare("UPDATE slot_players SET jackpots = jackpots + 1 WHERE ip_hash = ? AND ? > 0")
      .bind(ipHash, points)
  ]);

  if (points <= 0) {
    return false;
  }

  const player = await env.DB
    .prepare("SELECT 1 AS ok FROM slot_players WHERE ip_hash = ?")
    .bind(ipHash)
    .first();

  return !player; // true = this winner still needs to pick a name

}

async function isBanned(env, ip) {

  const banned = await env.DB
    .prepare("SELECT ip_address FROM banned_ips WHERE ip_address = ?")
    .bind(ip)
    .first();

  return !!banned;

}

// ---------------------------------------------------------------------
// GET /api/slots/config
// ---------------------------------------------------------------------

async function handleConfig(request, env) {

  if (!env.SLOT_HASH_SALT) {
    return json({ available: false, reason: "not_configured" });
  }

  const cfg = await loadConfig(env, false);
  const { day } = todayUtc();
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const ipHash = await hashIp(env, ip);

  const [spinRes, playerRes] = await env.DB.batch([
    env.DB.prepare("SELECT spins FROM slot_spins WHERE ip_hash = ? AND day = ?").bind(ipHash, day),
    env.DB.prepare("SELECT display_name FROM slot_players WHERE ip_hash = ?").bind(ipHash)
  ]);

  const used = Number(spinRes.results[0]?.spins) || 0;
  const dailyLimit = cfg.settings.daily_spin_limit;
  const available = cfg.faces.length >= cfg.settings.min_streamers;

  return json({
    available: available,
    reason: available ? null : "not_enough_streamers",
    faces: cfg.faces.map((f) => ({ id: f.id, name: f.name, image: f.image })),
    prizes: cfg.prizes.map((p) => ({
      id: p.id,
      name: p.name,
      image: p.image,
      points: p.points,
      target: p.target
    })),
    jackpotPoints: cfg.settings.jackpot_points,
    dailyLimit: dailyLimit,
    spinsLeft: Math.max(0, dailyLimit - used),
    playerName: playerRes.results[0]?.display_name || null
  });

}

// ---------------------------------------------------------------------
// POST /api/slots/spin
// ---------------------------------------------------------------------

async function handleSpin(request, env) {

  if (!env.SLOT_HASH_SALT) {
    return json({ error: "not_configured" }, 500);
  }

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";

  if (await isBanned(env, ip)) {
    return json({ error: "banned" }, 403);
  }

  const cfg = await loadConfig(env, false);
  const settings = cfg.settings;

  if (cfg.faces.length < settings.min_streamers) {
    return json({ error: "machine_unavailable" }, 503);
  }

  const { day, start } = todayUtc();

  // Circuit breaker: if the whole site has already spun this many times
  // today, the machine rests until 00:00 UTC rather than risk the free
  // database allowance.
  const globalTotal = await globalSpinsToday(env, day);

  if (globalTotal >= settings.global_daily_spin_limit) {
    return json({ error: "machine_resting" }, 503);
  }

  const ipHash = await hashIp(env, ip);

  // Atomic spin counter. If this visitor is already at their limit the
  // UPDATE's WHERE clause fails and no row comes back.
  const dailyLimit = settings.daily_spin_limit;

  const spinRow = await env.DB
    .prepare(
      `
      INSERT INTO slot_spins (ip_hash, day, spins) VALUES (?1, ?2, 1)
      ON CONFLICT (ip_hash, day) DO UPDATE SET spins = spins + 1 WHERE spins < ?3
      RETURNING spins
      `
    )
    .bind(ipHash, day, dailyLimit)
    .first();

  if (!spinRow) {
    return json({ error: "daily_limit", spinsLeft: 0 }, 429);
  }

  if (globalCache.day === day) {
    globalCache.total += 1;
  }

  const spinsLeft = Math.max(0, dailyLimit - Number(spinRow.spins));
  const outcome = rollOutcome(cfg);
  const cap = settings.daily_streamer_cap;
  const now = Date.now();

  // ----- Jackpot: three matching faces ---------------------------------
  if (outcome.type === "jackpot") {

    const points = settings.jackpot_points;
    const nets = await slotNetsToday(env, start);

    const candidates = shuffle(
      cfg.faces.filter((f) => f.cooldownUntil <= now && hasCapRoom(nets, f.id, points, cap))
    );

    for (const face of candidates.slice(0, 4)) {

      // Claim the cooldown first (atomic — only one spin can win it).
      const cooldownMs = settings.jackpot_cooldown_hours * 60 * 60 * 1000;

      const claimed = await env.DB
        .prepare(
          "UPDATE slot_faces SET cooldown_until = ? WHERE streamer_id = ? AND cooldown_until <= ?"
        )
        .bind(now + cooldownMs, face.id, now)
        .run();

      if (claimed.meta.changes !== 1) {
        continue;
      }

      const applied = await applyStockChange(env, face.id, points, "Slot jackpot", cap, start);

      if (!applied) {
        // Cap blocked it after all — hand the cooldown back and try another.
        await env.DB
          .prepare("UPDATE slot_faces SET cooldown_until = 0 WHERE streamer_id = ?")
          .bind(face.id)
          .run();
        continue;
      }

      face.cooldownUntil = now + cooldownMs;
      configCache.at = 0; // refresh the cache on next request

      const needsName = await recordWin(env, ipHash, "jackpot", null, face.id, points);

      return json({
        ok: true,
        outcome: "jackpot",
        reels: [faceRef(face), faceRef(face), faceRef(face)],
        win: { streamerId: face.id, streamerName: face.name, points: points },
        needsName: needsName,
        spinsLeft: spinsLeft
      });

    }

    // Nobody could take the jackpot right now (cooldowns / caps): this
    // spin quietly becomes a normal losing spin.
    return json({ ok: true, outcome: "none", reels: noWinReels(cfg), spinsLeft: spinsLeft });

  }

  // ----- Special prize --------------------------------------------------
  if (outcome.type === "prize") {

    const prize = outcome.prize;
    const reels = [prizeRef(prize), prizeRef(prize), prizeRef(prize)];
    const nets = await slotNetsToday(env, start);
    const withRoom = cfg.faces.filter((f) => hasCapRoom(nets, f.id, prize.points, cap));

    if (withRoom.length === 0) {
      return json({ ok: true, outcome: "none", reels: noWinReels(cfg), spinsLeft: spinsLeft });
    }

    // Random target (e.g. the rotten tooth): the SERVER picks the victim.
    if (prize.target === "random") {

      for (const face of shuffle(withRoom).slice(0, 4)) {

        const applied = await applyStockChange(env, face.id, prize.points, `Slot: ${prize.name}`, cap, start);

        if (!applied) {
          continue;
        }

        const needsName = await recordWin(env, ipHash, "prize", prize.id, face.id, prize.points);

        return json({
          ok: true,
          outcome: "prize_random",
          reels: reels,
          prize: { id: prize.id, name: prize.name, points: prize.points },
          win: { streamerId: face.id, streamerName: face.name, points: prize.points },
          needsName: needsName,
          spinsLeft: spinsLeft
        });

      }

      return json({ ok: true, outcome: "none", reels: noWinReels(cfg), spinsLeft: spinsLeft });

    }

    // Winner's choice: issue a one-time token; the pick happens in /claim.
    const token = randomHex(24);

    await env.DB
      .prepare(
        "INSERT INTO slot_tokens (token, ip_hash, prize_id, points, expires_at, used) VALUES (?, ?, ?, ?, ?, 0)"
      )
      .bind(token, ipHash, prize.id, prize.points, now + TOKEN_TTL_MS)
      .run();

    return json({
      ok: true,
      outcome: "prize_choice",
      reels: reels,
      prize: { id: prize.id, name: prize.name, points: prize.points },
      token: token,
      expiresInSeconds: Math.floor(TOKEN_TTL_MS / 1000),
      pickList: withRoom.map((f) => ({ id: f.id, name: f.name, image: f.image })),
      spinsLeft: spinsLeft
    });

  }

  // ----- Nothing --------------------------------------------------------
  return json({ ok: true, outcome: "none", reels: noWinReels(cfg), spinsLeft: spinsLeft });

}

// ---------------------------------------------------------------------
// POST /api/slots/claim   { token, streamer_id }
// ---------------------------------------------------------------------

async function handleClaim(request, env) {

  if (!env.SLOT_HASH_SALT) {
    return json({ error: "not_configured" }, 500);
  }

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";

  if (await isBanned(env, ip)) {
    return json({ error: "banned" }, 403);
  }

  let data;
  try {
    data = await request.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }

  const token = String(data?.token || "");
  const streamerId = Number(data?.streamer_id);

  if (!/^[0-9a-f]{48}$/.test(token) || !Number.isInteger(streamerId)) {
    return json({ error: "bad_request" }, 400);
  }

  const cfg = await loadConfig(env, false);
  const face = cfg.faces.find((f) => f.id === streamerId);

  // Only streamers currently on the reels (and not opted out) can be picked.
  if (!face) {
    return json({ error: "streamer_not_eligible" }, 400);
  }

  const ipHash = await hashIp(env, ip);
  const now = Date.now();
  const { start } = todayUtc();
  const cap = cfg.settings.daily_streamer_cap;

  // Atomically mark the token used. Only the visitor it was issued to can
  // use it, only once, and only before it expires.
  const used = await env.DB
    .prepare(
      "UPDATE slot_tokens SET used = 1 WHERE token = ? AND ip_hash = ? AND used = 0 AND expires_at > ?"
    )
    .bind(token, ipHash, now)
    .run();

  if (used.meta.changes !== 1) {
    return json({ error: "invalid_or_expired_token" }, 400);
  }

  const tokenRow = await env.DB
    .prepare(
      `
      SELECT slot_tokens.prize_id AS prize_id, slot_tokens.points AS points, slot_prizes.name AS prize_name
      FROM slot_tokens
      LEFT JOIN slot_prizes ON slot_prizes.id = slot_tokens.prize_id
      WHERE slot_tokens.token = ?
      `
    )
    .bind(token)
    .first();

  const points = Number(tokenRow.points);
  const prizeName = tokenRow.prize_name || "Prize";

  const applied = await applyStockChange(env, streamerId, points, `Slot: ${prizeName}`, cap, start);

  if (!applied) {
    // That streamer hit today's cap in the meantime. Give the token back so
    // the winner can choose someone else instead of losing the prize.
    await env.DB
      .prepare("UPDATE slot_tokens SET used = 0 WHERE token = ?")
      .bind(token)
      .run();

    return json({ error: "streamer_at_cap" }, 409);
  }

  const needsName = await recordWin(env, ipHash, "prize", tokenRow.prize_id, streamerId, points);

  return json({
    ok: true,
    win: { streamerId: face.id, streamerName: face.name, points: points },
    prize: { id: tokenRow.prize_id, name: prizeName, points: points },
    needsName: needsName
  });

}

// ---------------------------------------------------------------------
// POST /api/slots/name   { name }
// ---------------------------------------------------------------------

const RESERVED_NAMES = [
  "admin", "administrator", "mod", "moderator", "owner", "staff", "system",
  "cowtube", "underground", "undergroundcowtube", "support", "official", "anonymous"
];

// Checked against a "squashed" version of the name (lowercase, common
// look-alike characters swapped, everything non-alphanumeric removed) so
// simple tricks like f.u.c.k or sh1t don't slip through.
const BLOCKED_FRAGMENTS = [
  "fuck", "shit", "cunt", "bitch", "nigg", "fag", "retard", "rape", "nazi",
  "hitler", "kike", "spic", "chink", "whore", "slut", "dick", "cock", "pussy"
];

function squashName(name) {
  return name
    .toLowerCase()
    .replace(/0/g, "o").replace(/1/g, "i").replace(/3/g, "e")
    .replace(/4/g, "a").replace(/5/g, "s").replace(/7/g, "t")
    .replace(/@/g, "a").replace(/\$/g, "s")
    .replace(/[^a-z]/g, "");
}

async function handleName(request, env) {

  if (!env.SLOT_HASH_SALT) {
    return json({ error: "not_configured" }, 500);
  }

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";

  if (await isBanned(env, ip)) {
    return json({ error: "banned" }, 403);
  }

  let data;
  try {
    data = await request.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }

  const name = String(data?.name || "").replace(/\s+/g, " ").trim();

  if (name.length < 3 || name.length > 20) {
    return json({ error: "name_length", message: "Names must be 3 to 20 characters." }, 400);
  }

  if (!/^[A-Za-z0-9 _.\-]+$/.test(name)) {
    return json({ error: "name_characters", message: "Use letters, numbers, spaces, _ . or - only." }, 400);
  }

  const squashed = squashName(name);

  if (RESERVED_NAMES.includes(squashed) || BLOCKED_FRAGMENTS.some((bad) => squashed.includes(bad))) {
    return json({ error: "name_not_allowed", message: "That name isn't allowed." }, 400);
  }

  const ipHash = await hashIp(env, ip);

  // You need at least one win before you can claim a leaderboard name —
  // otherwise anyone could squat names without ever playing.
  const [winsRes, existingRes, streamersRes] = await env.DB.batch([
    env.DB.prepare("SELECT COUNT(*) AS n FROM slot_wins WHERE ip_hash = ? AND points > 0").bind(ipHash),
    env.DB.prepare("SELECT display_name FROM slot_players WHERE ip_hash = ?").bind(ipHash),
    env.DB.prepare("SELECT name FROM streamers")
  ]);

  const wins = Number(winsRes.results[0]?.n) || 0;

  if (wins === 0) {
    return json({ error: "no_wins_yet" }, 403);
  }

  if (existingRes.results.length > 0) {
    return json({ error: "name_already_set" }, 409);
  }

  // Can't impersonate a streamer on the leaderboard either.
  const nameLower = name.toLowerCase();

  if (streamersRes.results.some((s) => squashName(String(s.name || "")) === squashed)) {
    return json({ error: "name_not_allowed", message: "That name isn't allowed." }, 400);
  }

  try {

    await env.DB
      .prepare(
        `
        INSERT INTO slot_players (ip_hash, display_name, name_lower, jackpots, created_at)
        VALUES (?, ?, ?, (SELECT COUNT(*) FROM slot_wins WHERE ip_hash = ? AND points > 0), ?)
        `
      )
      .bind(ipHash, name, nameLower, ipHash, Date.now())
      .run();

  } catch (err) {

    if (String(err.message || err).includes("UNIQUE")) {
      return json({ error: "name_taken", message: "Someone already has that name." }, 409);
    }

    throw err;

  }

  leaderboardCache.at = 0;

  return json({ ok: true, name: name });

}

// ---------------------------------------------------------------------
// GET /api/slots/leaderboard
// ---------------------------------------------------------------------

let leaderboardCache = { at: 0, rows: [] };

async function handleLeaderboard(env) {

  const now = Date.now();

  if (now - leaderboardCache.at >= LEADERBOARD_TTL_MS) {

    const { results } = await env.DB
      .prepare(
        `
        SELECT display_name, jackpots
        FROM slot_players
        WHERE jackpots > 0
        ORDER BY jackpots DESC, created_at ASC
        LIMIT 10
        `
      )
      .all();

    leaderboardCache = {
      at: now,
      rows: results.map((r) => ({ name: r.display_name, jackpots: r.jackpots }))
    };

  }

  return json(leaderboardCache.rows);

}

// ---------------------------------------------------------------------
// Router — worker.js hands every /api/slots/* request to this.
// Returns a Response, or null if the route isn't one of ours.
// ---------------------------------------------------------------------

export async function handleSlotRoutes(request, env, url, helpers) {

  const path = url.pathname;
  const method = request.method;

  try {

    if (path === "/api/slots/config" && method === "GET") {
      return await handleConfig(request, env);
    }

    if (path === "/api/slots/spin" && method === "POST") {
      return await handleSpin(request, env);
    }

    if (path === "/api/slots/claim" && method === "POST") {
      return await handleClaim(request, env);
    }

    if (path === "/api/slots/name" && method === "POST") {
      return await handleName(request, env);
    }

    if (path === "/api/slots/leaderboard" && method === "GET") {
      return await handleLeaderboard(env);
    }

  } catch (err) {

    console.log("Slots error:", err && err.message ? err.message : err);
    return json({ error: "server_error" }, 500);

  }

  return null;

}
