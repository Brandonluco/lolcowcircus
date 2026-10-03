// =====================================================================
// CowTube Slots — admin API (Stage 2a)
//
// Every route here requires a valid Cloudflare Access session (the same
// requireAdmin() check the rest of your admin endpoints use). Routes:
//
//   GET  /api/slots/admin/overview       everything the admin panel shows
//   POST /api/slots/admin/face-image     upload a streamer's symbol image
//   POST /api/slots/admin/face           turn a streamer on/off the reels, opt-out
//   POST /api/slots/admin/prize          create or edit a prize symbol
//   POST /api/slots/admin/prize-image    upload a prize's symbol image
//   DELETE /api/slots/admin/prize        remove a prize
//   POST /api/slots/admin/settings       edit machine settings
//   POST /api/slots/admin/player-remove  remove a name from the leaderboard
//
// The server never trusts the browser's image processing: every upload is
// re-checked here (real file signature, exact 256x256, size limit).
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

// min / max / whether it must be a whole number / whether zero is banned.
const SETTING_RULES = {
  jackpot_points:          { min: -5,  max: 5,      int: false, nonzero: true },
  jackpot_odds:            { min: 2,   max: 1000000, int: true },
  daily_spin_limit:        { min: 1,   max: 1000,   int: true },
  daily_streamer_cap:      { min: 0.25, max: 20,    int: false },
  jackpot_cooldown_hours:  { min: 0,   max: 720,    int: false },
  min_streamers:           { min: 3,   max: 100,    int: true },
  min_odds_floor:          { min: 10,  max: 1000,   int: true },
  // Capped at 60,000 so a typo can't let the machine eat the whole free
  // D1 write allowance (100,000/day) and take comments/articles down.
  global_daily_spin_limit: { min: 100, max: 60000,  int: true }
};

// All prizes + the jackpot together may not win more often than this.
const MAX_COMBINED_WIN_RATE = 0.25;

const MAX_IMAGE_BYTES = 150 * 1024;
const IMAGE_SIZE = 256;
const MAX_PRIZE_POINTS = 5;
const MAX_PRIZES = 20;

function json(body, status = 200) {
  return Response.json(body, {
    status: status,
    headers: { "Cache-Control": "no-store" }
  });
}

// Turns a query-string / JSON value into a whole-number ID, or null if it
// is missing or not a whole number. (Plain Number(null) is 0, which would
// wrongly look like a valid ID.)
function parseId(raw) {

  if (raw === null || raw === undefined || raw === "") {
    return null;
  }

  const value = Number(raw);

  return Number.isInteger(value) ? value : null;

}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------
// Image validation — reads the real file header, not the filename/type
// ---------------------------------------------------------------------

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// Returns { format: "png" | "webp", width, height } or null if the bytes
// aren't a valid PNG/WebP.
export function readImageInfo(bytes) {

  if (bytes.length >= 24 && PNG_SIGNATURE.every((b, i) => bytes[i] === b)) {

    // IHDR chunk: width/height are big-endian 32-bit ints at offset 16/20.
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    if (String.fromCharCode(...bytes.slice(12, 16)) !== "IHDR") {
      return null;
    }

    return { format: "png", width: view.getUint32(16), height: view.getUint32(20) };

  }

  const ascii = (start, end) => String.fromCharCode(...bytes.slice(start, end));

  if (bytes.length >= 30 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") {

    const chunk = ascii(12, 16);

    if (chunk === "VP8X") {
      // 24-bit little-endian (width-1) at 24, (height-1) at 27.
      const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
      const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
      return { format: "webp", width, height };
    }

    if (chunk === "VP8L") {
      // Lossless: signature byte 0x2f, then 14-bit (width-1), 14-bit (height-1).
      if (bytes[20] !== 0x2f) return null;
      const bits = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
      const width = 1 + (bits & 0x3fff);
      const height = 1 + ((bits >>> 14) & 0x3fff);
      return { format: "webp", width, height };
    }

    if (chunk === "VP8 ") {
      // Lossy: start code 9d 01 2a, then 14-bit little-endian width/height.
      if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
      const width = (bytes[26] | (bytes[27] << 8)) & 0x3fff;
      const height = (bytes[28] | (bytes[29] << 8)) & 0x3fff;
      return { format: "webp", width, height };
    }

  }

  return null;

}

// Shared by both image-upload routes. Returns { key, format } on success
// or a Response to send straight back on failure.
async function storeSymbolImage(request, env, keyPrefix, options) {

  const expectedWidth = options?.width || IMAGE_SIZE;
  const expectedHeight = options?.height || IMAGE_SIZE;
  const maxBytes = options?.maxBytes || MAX_IMAGE_BYTES;

  const declared = Number(request.headers.get("Content-Length") || 0);

  if (declared > maxBytes * 2) {
    return json({ error: "too_large", message: `Image is too large (max ${Math.round(maxBytes / 1024)}KB).` }, 413);
  }

  const buffer = await request.arrayBuffer();

  if (buffer.byteLength === 0) {
    return json({ error: "empty", message: "No image data received." }, 400);
  }

  if (buffer.byteLength > maxBytes) {
    return json({
      error: "too_large",
      message: `Image is ${Math.round(buffer.byteLength / 1024)}KB — the limit is ${Math.round(maxBytes / 1024)}KB.`
    }, 413);
  }

  const info = readImageInfo(new Uint8Array(buffer));

  if (!info) {
    return json({ error: "bad_format", message: "Must be a real PNG or WebP image." }, 400);
  }

  if (info.width !== expectedWidth || info.height !== expectedHeight) {
    return json({
      error: "bad_dimensions",
      message: `Image must be exactly ${expectedWidth}x${expectedHeight} (this one is ${info.width}x${info.height}).`
    }, 400);
  }

  const key = `${keyPrefix}-${Date.now()}.${info.format}`;

  await env.IMAGES.put(key, buffer, {
    httpMetadata: {
      contentType: info.format === "png" ? "image/png" : "image/webp"
    }
  });

  return { key: key, format: info.format };

}

async function deleteOldImage(env, oldKey, newKey) {

  if (!oldKey || oldKey === newKey || !oldKey.startsWith("slots/")) {
    return;
  }

  try {
    await env.IMAGES.delete(oldKey);
  } catch (err) {
    console.log("Couldn't delete old slot image:", oldKey, err && err.message);
  }

}

// ---------------------------------------------------------------------
// Settings / odds math
// ---------------------------------------------------------------------

async function loadSettings(env) {

  const { results } = await env.DB.prepare("SELECT key, value FROM slot_settings").all();

  const settings = { ...DEFAULTS };

  for (const row of results) {
    const value = Number(row.value);
    if (Number.isFinite(value)) {
      settings[row.key] = value;
    }
  }

  return settings;

}

// Chance that any one spin wins something, and the average stock movement
// per 100 spins — shown live in the admin panel so odds typos are obvious.
export function oddsSummary(settings, prizes) {

  let combined = 1 / settings.jackpot_odds;
  let netPer100 = (settings.jackpot_points / settings.jackpot_odds) * 100;
  let grossPer100 = (Math.abs(settings.jackpot_points) / settings.jackpot_odds) * 100;

  for (const prize of prizes) {

    if (!prize.enabled) {
      continue;
    }

    combined += 1 / prize.odds;
    netPer100 += (prize.points / prize.odds) * 100;
    grossPer100 += (Math.abs(prize.points) / prize.odds) * 100;

  }

  return {
    combinedWinRate: combined,
    oneInEverySpins: combined > 0 ? Math.round(1 / combined) : null,
    netPointsPer100Spins: Math.round(netPer100 * 1000) / 1000,
    grossPointsPer100Spins: Math.round(grossPer100 * 1000) / 1000
  };

}

function checkNumber(name, raw, rule) {

  if (raw === null || raw === undefined || raw === "") {
    return `${name} is required.`;
  }

  const value = Number(raw);

  if (!Number.isFinite(value)) {
    return `${name} must be a number.`;
  }

  if (rule.int && !Number.isInteger(value)) {
    return `${name} must be a whole number.`;
  }

  if (rule.nonzero && value === 0) {
    return `${name} can't be zero.`;
  }

  if (value < rule.min || value > rule.max) {
    return `${name} must be between ${rule.min} and ${rule.max}.`;
  }

  return null;

}

// ---------------------------------------------------------------------
// GET /api/slots/admin/overview
// ---------------------------------------------------------------------

function imagePath(key) {
  return key ? `/api/images/${encodeURIComponent(key)}` : null;
}

async function handleOverview(env) {

  const dayStart = new Date();
  const todayKey = dayStart.toISOString().slice(0, 10);
  const startMs = Date.UTC(dayStart.getUTCFullYear(), dayStart.getUTCMonth(), dayStart.getUTCDate());

  const [streamersRes, prizesRes, spinsRes, winsTodayRes, recentRes, playersRes] = await env.DB.batch([
    env.DB.prepare(
      `
      SELECT streamers.id AS id, streamers.name AS name, streamers.ticker AS ticker,
             slot_faces.image_key AS image_key, slot_faces.enabled AS enabled,
             slot_faces.opted_out AS opted_out, slot_faces.cooldown_until AS cooldown_until
      FROM streamers
      LEFT JOIN slot_faces ON slot_faces.streamer_id = streamers.id
      ORDER BY streamers.name COLLATE NOCASE ASC
      `
    ),
    env.DB.prepare(
      "SELECT id, name, image_key, points, odds, target, enabled, sort_order FROM slot_prizes ORDER BY sort_order ASC, id ASC"
    ),
    env.DB.prepare("SELECT COALESCE(SUM(spins), 0) AS total, COUNT(*) AS players FROM slot_spins WHERE day = ?").bind(todayKey),
    env.DB.prepare("SELECT COUNT(*) AS n FROM slot_wins WHERE created_at >= ?").bind(startMs),
    env.DB.prepare(
      `
      SELECT slot_wins.created_at AS created_at, slot_wins.kind AS kind, slot_wins.points AS points,
             streamers.name AS streamer_name, slot_prizes.name AS prize_name,
             slot_players.display_name AS player_name
      FROM slot_wins
      LEFT JOIN streamers ON streamers.id = slot_wins.streamer_id
      LEFT JOIN slot_prizes ON slot_prizes.id = slot_wins.prize_id
      LEFT JOIN slot_players ON slot_players.ip_hash = slot_wins.ip_hash
      ORDER BY slot_wins.id DESC
      LIMIT 15
      `
    ),
    env.DB.prepare("SELECT display_name, jackpots FROM slot_players ORDER BY jackpots DESC, created_at ASC LIMIT 20")
  ]);

  const settings = await loadSettings(env);
  const now = Date.now();

  const streamers = streamersRes.results.map((s) => {

    let status = "off";

    if (s.opted_out) {
      status = "opted_out";
    } else if (!s.image_key) {
      status = "needs_image";
    } else if (s.enabled) {
      status = "on_reels";
    }

    return {
      id: s.id,
      name: s.name,
      ticker: s.ticker,
      image: imagePath(s.image_key),
      hasImage: !!s.image_key,
      enabled: !!s.enabled,
      optedOut: !!s.opted_out,
      onCooldown: Number(s.cooldown_until) > now,
      cooldownUntil: Number(s.cooldown_until) || 0,
      status: status
    };

  });

  const prizes = prizesRes.results.map((p) => ({
    id: p.id,
    name: p.name,
    image: imagePath(p.image_key),
    hasImage: !!p.image_key,
    points: Number(p.points),
    odds: p.odds,
    target: p.target,
    enabled: !!p.enabled,
    sortOrder: p.sort_order
  }));

  const onReels = streamers.filter((s) => s.status === "on_reels").length;

  return json({
    settings: settings,
    settingRules: SETTING_RULES,
    limits: {
      imageSize: IMAGE_SIZE,
      maxImageKb: Math.round(MAX_IMAGE_BYTES / 1024),
      maxCombinedWinRate: MAX_COMBINED_WIN_RATE,
      maxPrizePoints: MAX_PRIZE_POINTS
    },
    streamers: streamers,
    prizes: prizes,
    summary: {
      ...oddsSummary(settings, prizes),
      streamersOnReels: onReels,
      machineLive: onReels >= settings.min_streamers
    },
    today: {
      spins: Number(spinsRes.results[0]?.total) || 0,
      players: Number(spinsRes.results[0]?.players) || 0,
      wins: Number(winsTodayRes.results[0]?.n) || 0
    },
    recentWins: recentRes.results.map((r) => ({
      at: r.created_at,
      kind: r.kind,
      points: Number(r.points),
      streamer: r.streamer_name,
      prize: r.prize_name,
      player: r.player_name || null
    })),
    leaderboard: playersRes.results.map((p) => ({ name: p.display_name, jackpots: p.jackpots }))
  });

}

// ---------------------------------------------------------------------
// Faces
// ---------------------------------------------------------------------

async function handleFaceImage(request, env, url, hooks) {

  const streamerId = parseId(url.searchParams.get("streamer_id"));

  if (streamerId === null) {
    return json({ error: "bad_request", message: "Missing streamer_id." }, 400);
  }

  const streamer = await env.DB
    .prepare("SELECT id FROM streamers WHERE id = ?")
    .bind(streamerId)
    .first();

  if (!streamer) {
    return json({ error: "no_such_streamer" }, 404);
  }

  const stored = await storeSymbolImage(request, env, `slots/face-${streamerId}`);

  if (stored instanceof Response) {
    return stored;
  }

  const existing = await env.DB
    .prepare("SELECT image_key FROM slot_faces WHERE streamer_id = ?")
    .bind(streamerId)
    .first();

  // First image ever for this streamer -> put them on the reels straight
  // away (you can still switch them off). Replacing an image keeps whatever
  // on/off state they already had.
  await env.DB
    .prepare(
      `
      INSERT INTO slot_faces (streamer_id, image_key, enabled, opted_out, cooldown_until)
      VALUES (?, ?, 1, 0, 0)
      ON CONFLICT (streamer_id) DO UPDATE SET image_key = excluded.image_key
      `
    )
    .bind(streamerId, stored.key)
    .run();

  await deleteOldImage(env, existing?.image_key, stored.key);
  hooks.resetCaches();

  return json({ success: true, image: imagePath(stored.key) });

}

async function handleFace(request, env, hooks) {

  const data = await readJson(request);

  if (!data) {
    return json({ error: "bad_request" }, 400);
  }

  const streamerId = parseId(data.streamer_id);

  if (streamerId === null) {
    return json({ error: "bad_request", message: "Missing streamer_id." }, 400);
  }

  const streamer = await env.DB
    .prepare("SELECT id FROM streamers WHERE id = ?")
    .bind(streamerId)
    .first();

  if (!streamer) {
    return json({ error: "no_such_streamer" }, 404);
  }

  const existing = await env.DB
    .prepare("SELECT image_key, enabled, opted_out FROM slot_faces WHERE streamer_id = ?")
    .bind(streamerId)
    .first();

  const enabled = data.enabled === undefined ? !!existing?.enabled : !!data.enabled;
  const optedOut = data.opted_out === undefined ? !!existing?.opted_out : !!data.opted_out;

  if (enabled && !existing?.image_key) {
    return json({ error: "needs_image", message: "Upload an image for this streamer first." }, 400);
  }

  await env.DB
    .prepare(
      `
      INSERT INTO slot_faces (streamer_id, image_key, enabled, opted_out, cooldown_until)
      VALUES (?, NULL, ?, ?, 0)
      ON CONFLICT (streamer_id) DO UPDATE SET enabled = excluded.enabled, opted_out = excluded.opted_out
      `
    )
    .bind(streamerId, enabled ? 1 : 0, optedOut ? 1 : 0)
    .run();

  hooks.resetCaches();

  return json({ success: true, enabled: enabled, optedOut: optedOut });

}

// ---------------------------------------------------------------------
// Prizes
// ---------------------------------------------------------------------

async function handlePrize(request, env, hooks) {

  const data = await readJson(request);

  if (!data) {
    return json({ error: "bad_request" }, 400);
  }

  const settings = await loadSettings(env);

  const name = String(data.name || "").replace(/\s+/g, " ").trim();

  if (name.length < 1 || name.length > 30) {
    return json({ error: "bad_name", message: "Prize name must be 1 to 30 characters." }, 400);
  }

  const pointsError = checkNumber("Points", data.points, {
    min: -MAX_PRIZE_POINTS, max: MAX_PRIZE_POINTS, int: false, nonzero: true
  });

  if (pointsError) {
    return json({ error: "bad_points", message: pointsError }, 400);
  }

  const oddsError = checkNumber("Odds", data.odds, {
    min: settings.min_odds_floor, max: 1000000, int: true
  });

  if (oddsError) {
    return json({ error: "bad_odds", message: `${oddsError} (1 in N spins; the floor stops typos from flooding the machine.)` }, 400);
  }

  if (data.target !== "choice" && data.target !== "random") {
    return json({ error: "bad_target", message: "Target must be 'choice' or 'random'." }, 400);
  }

  const points = Math.round(Number(data.points) * 100) / 100;
  const odds = Number(data.odds);
  const wantEnabled = !!data.enabled;
  const hasId = !(data.id === undefined || data.id === null || data.id === "");
  const id = hasId ? parseId(data.id) : null;

  const { results: allPrizes } = await env.DB
    .prepare("SELECT id, image_key, points, odds, enabled FROM slot_prizes")
    .all();

  let existing = null;

  if (hasId) {

    if (id === null) {
      return json({ error: "bad_request" }, 400);
    }

    existing = allPrizes.find((p) => p.id === id);

    if (!existing) {
      return json({ error: "no_such_prize" }, 404);
    }

  } else if (allPrizes.length >= MAX_PRIZES) {

    return json({ error: "too_many", message: `Limit of ${MAX_PRIZES} prizes reached.` }, 400);

  }

  if (wantEnabled && !existing?.image_key) {
    return json({ error: "needs_image", message: "Upload an image before switching this prize on." }, 400);
  }

  // Would the machine still be sane with this change? Check the combined
  // win rate across the jackpot + every enabled prize.
  const proposed = allPrizes
    .filter((p) => p.id !== id)
    .map((p) => ({ points: Number(p.points), odds: p.odds, enabled: !!p.enabled }));

  proposed.push({ points: points, odds: odds, enabled: wantEnabled });

  const summary = oddsSummary(settings, proposed);

  if (summary.combinedWinRate > MAX_COMBINED_WIN_RATE) {
    return json({
      error: "too_generous",
      message: `With this change, 1 in every ${summary.oneInEverySpins} spins would win something. The machine won't allow more than 1 in ${Math.round(1 / MAX_COMBINED_WIN_RATE)}.`
    }, 400);
  }

  let savedId = id;

  if (!hasId) {

    const nextOrder = (await env.DB.prepare("SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM slot_prizes").first())?.n || 1;

    const result = await env.DB
      .prepare(
        "INSERT INTO slot_prizes (name, points, odds, target, enabled, sort_order) VALUES (?, ?, ?, ?, 0, ?)"
      )
      .bind(name, points, odds, data.target, nextOrder)
      .run();

    savedId = result.meta.last_row_id;

  } else {

    await env.DB
      .prepare("UPDATE slot_prizes SET name = ?, points = ?, odds = ?, target = ?, enabled = ? WHERE id = ?")
      .bind(name, points, odds, data.target, wantEnabled ? 1 : 0, id)
      .run();

  }

  hooks.resetCaches();

  return json({ success: true, id: savedId, summary: summary });

}

async function handlePrizeImage(request, env, url, hooks) {

  const prizeId = parseId(url.searchParams.get("prize_id"));

  if (prizeId === null) {
    return json({ error: "bad_request", message: "Missing prize_id." }, 400);
  }

  const prize = await env.DB
    .prepare("SELECT id, image_key FROM slot_prizes WHERE id = ?")
    .bind(prizeId)
    .first();

  if (!prize) {
    return json({ error: "no_such_prize" }, 404);
  }

  const stored = await storeSymbolImage(request, env, `slots/prize-${prizeId}`);

  if (stored instanceof Response) {
    return stored;
  }

  await env.DB
    .prepare("UPDATE slot_prizes SET image_key = ? WHERE id = ?")
    .bind(stored.key, prizeId)
    .run();

  await deleteOldImage(env, prize.image_key, stored.key);
  hooks.resetCaches();

  return json({ success: true, image: imagePath(stored.key) });

}

async function handlePrizeDelete(request, env, hooks) {

  const data = await readJson(request);
  const id = parseId(data?.id);

  if (id === null) {
    return json({ error: "bad_request" }, 400);
  }

  const prize = await env.DB
    .prepare("SELECT image_key FROM slot_prizes WHERE id = ?")
    .bind(id)
    .first();

  if (!prize) {
    return json({ error: "no_such_prize" }, 404);
  }

  await env.DB.batch([
    env.DB.prepare("DELETE FROM slot_prizes WHERE id = ?").bind(id),
    // Any unclaimed tokens for it are now worthless.
    env.DB.prepare("UPDATE slot_tokens SET used = 1 WHERE prize_id = ?").bind(id)
  ]);

  await deleteOldImage(env, prize.image_key, null);
  hooks.resetCaches();

  return json({ success: true });

}

// ---------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------

async function handleSettings(request, env, hooks) {

  const data = await readJson(request);

  if (!data || typeof data !== "object") {
    return json({ error: "bad_request" }, 400);
  }

  const current = await loadSettings(env);
  const next = { ...current };
  const errors = [];

  for (const [key, raw] of Object.entries(data)) {

    const rule = SETTING_RULES[key];

    if (!rule) {
      errors.push(`Unknown setting: ${key}`);
      continue;
    }

    const problem = checkNumber(key, raw, rule);

    if (problem) {
      errors.push(problem);
      continue;
    }

    next[key] = Number(raw);

  }

  if (errors.length > 0) {
    return json({ error: "invalid", message: errors.join(" "), errors: errors }, 400);
  }

  // Cross-checks that depend on more than one value.
  if (next.jackpot_odds < next.min_odds_floor) {
    return json({
      error: "invalid",
      message: `Jackpot odds can't be more common than 1 in ${next.min_odds_floor} (the minimum odds floor).`
    }, 400);
  }

  const { results: prizes } = await env.DB
    .prepare("SELECT points, odds, enabled FROM slot_prizes")
    .all();

  const tooCommon = prizes.find((p) => p.enabled && p.odds < next.min_odds_floor);

  if (tooCommon) {
    return json({
      error: "invalid",
      message: `A prize is set to 1 in ${tooCommon.odds}, which is more common than the new floor of 1 in ${next.min_odds_floor}. Change the prize first.`
    }, 400);
  }

  const summary = oddsSummary(
    next,
    prizes.map((p) => ({ points: Number(p.points), odds: p.odds, enabled: !!p.enabled }))
  );

  if (summary.combinedWinRate > MAX_COMBINED_WIN_RATE) {
    return json({
      error: "too_generous",
      message: `With these settings, 1 in every ${summary.oneInEverySpins} spins would win something. The machine won't allow more than 1 in ${Math.round(1 / MAX_COMBINED_WIN_RATE)}.`
    }, 400);
  }

  const statements = Object.keys(data).map((key) =>
    env.DB
      .prepare(
        "INSERT INTO slot_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value"
      )
      .bind(key, next[key])
  );

  if (statements.length > 0) {
    await env.DB.batch(statements);
  }

  hooks.resetCaches();

  return json({ success: true, settings: next, summary: summary });

}

// ---------------------------------------------------------------------
// Leaderboard moderation
// ---------------------------------------------------------------------

async function handlePlayerRemove(request, env, hooks) {

  const data = await readJson(request);
  const name = String(data?.name || "").trim().toLowerCase();

  if (!name) {
    return json({ error: "bad_request" }, 400);
  }

  const result = await env.DB
    .prepare("DELETE FROM slot_players WHERE name_lower = ?")
    .bind(name)
    .run();

  hooks.resetCaches();

  return json({ success: true, removed: result.meta.changes });

}

// ---------------------------------------------------------------------
// Router — slots.js hands every /api/slots/admin/* request to this.
// ---------------------------------------------------------------------

export async function handleSlotAdminRoutes(request, env, url, helpers, hooks) {

  const authError = await helpers.requireAdmin(request, env);
  if (authError) return authError;

  const path = url.pathname;
  const method = request.method;

  try {

    if (path === "/api/slots/admin/overview" && method === "GET") {
      return await handleOverview(env);
    }

    if (path === "/api/slots/admin/face-image" && method === "POST") {
      return await handleFaceImage(request, env, url, hooks);
    }

    if (path === "/api/slots/admin/face" && method === "POST") {
      return await handleFace(request, env, hooks);
    }

    if (path === "/api/slots/admin/prize" && method === "POST") {
      return await handlePrize(request, env, hooks);
    }

    if (path === "/api/slots/admin/prize-image" && method === "POST") {
      return await handlePrizeImage(request, env, url, hooks);
    }

    if (path === "/api/slots/admin/prize" && method === "DELETE") {
      return await handlePrizeDelete(request, env, hooks);
    }

    if (path === "/api/slots/admin/settings" && method === "POST") {
      return await handleSettings(request, env, hooks);
    }

    if (path === "/api/slots/admin/player-remove" && method === "POST") {
      return await handlePlayerRemove(request, env, hooks);
    }

  } catch (err) {

    console.log("Slots admin error:", err && err.message ? err.message : err);
    return json({ error: "server_error" }, 500);

  }

  return json({ error: "not_found" }, 404);

}
