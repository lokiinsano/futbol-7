require("dotenv").config();
const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const db = require("./lib/db");
const storage = require("./lib/storage");
const push = require("./lib/push");
const scheduler = require("./lib/scheduler");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const POS = new Set(["POR", "DFC", "LD", "LI", "MC", "MD", "MI", "ED", "EI", "DC"]);
const STAT = new Set(["voy", "pendiente", "cancelado"]);

app.use(express.json({ limit: "15mb" }));
app.use(express.static(path.join(__dirname, "public")));
if (storage.driver === "local") {
  app.use("/uploads", express.static(storage.localDir));
}

function publicGame(g) {
  if (!g) return null;
  return {
    code: g.code,
    name: g.name,
    courtName: g.court_name,
    courtLocation: g.court_location,
    matchDate: g.match_date,
    cupos: g.cupos,
    reminder24hSent: !!g.reminder_24h_sent,
    reminder1hSent: !!g.reminder_1h_sent,
  };
}

async function broadcastState(code) {
  const g = await db.getGameByCode(code);
  if (!g) return;
  const players = await db.listPlayers(g.id);
  io.to(code).emit("state", { game: publicGame(g), players });
}

function parseMatchDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return undefined; // señal de fecha inválida
  return d.toISOString();
}

// ---------- Web Push ----------
app.get("/api/push/vapid-public-key", (req, res) => {
  res.json({ publicKey: push.publicKey || "", enabled: push.enabled() });
});

app.post("/api/games/:code/push/subscribe", async (req, res) => {
  const g = await db.getGameByCode(req.params.code.toUpperCase());
  if (!g) return res.status(404).json({ error: "Partido no encontrado" });
  const sub = req.body.subscription;
  if (!sub || !sub.endpoint || !sub.keys) return res.status(400).json({ error: "Suscripción inválida" });
  await db.addPushSubscription(g.id, req.body.playerId || null, sub);
  res.status(201).json({ ok: true });
});

app.post("/api/games/:code/push/unsubscribe", async (req, res) => {
  const { endpoint } = req.body || {};
  if (!endpoint) return res.status(400).json({ error: "endpoint requerido" });
  await db.removePushSubscriptionByEndpoint(endpoint);
  res.json({ ok: true });
});

app.post("/api/games/:code/notify-missing", async (req, res) => {
  const g = await db.getGameByCode(req.params.code.toUpperCase());
  if (!g || String(req.body.pin) !== g.admin_pin) return res.status(403).json({ error: "PIN incorrecto" });
  const players = await db.listPlayers(g.id);
  const voy = players.filter((p) => p.status === "voy").length;
  const cupos = g.cupos || 14;
  const faltan = Math.max(0, cupos - voy);
  const result = await push.sendToGame(g.id, {
    title: faltan > 0 ? `📣 Faltan ${faltan} jugadores` : "📣 ¡Cupos completos!",
    body: `${g.name}: van ${voy}/${cupos}.${faltan > 0 ? " ¡Avisa a más gente!" : ""}`,
    url: `/?partido=${g.code}`,
    tag: `faltan-${g.code}`,
  });
  res.json({ ok: true, faltan, sent: result.sent, pushEnabled: push.enabled() });
});

// ---------- Uploads (fotos / video de perfil) ----------
app.post("/api/upload", async (req, res) => {
  try {
    const { data } = req.body || {};
    if (!data) return res.status(400).json({ error: "Archivo requerido" });
    const result = await storage.save(data);
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || "No se pudo subir" });
  }
});

// ---------- Partidos ----------
app.post("/api/games", async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const pin = String(req.body.pin || "").trim();
    const courtName = req.body.courtName ? String(req.body.courtName).trim().slice(0, 80) : null;
    const courtLocation = req.body.courtLocation ? String(req.body.courtLocation).trim().slice(0, 160) : null;
    const cupos = Math.min(30, Math.max(2, Number(req.body.cupos) || 14));
    const matchDate = parseMatchDate(req.body.matchDate);
    if (matchDate === undefined) return res.status(400).json({ error: "Fecha/hora inválida" });
    if (!name || name.length > 60 || pin.length < 4 || pin.length > 20) {
      return res.status(400).json({ error: "Nombre o PIN inválido" });
    }
    const code = await db.genCode();
    const g = await db.createGame({ code, name, adminPin: pin, courtName, courtLocation, matchDate, cupos });
    res.status(201).json({ code: g.code, gameName: g.name, adminPin: pin, game: publicGame(g) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "No se pudo crear el partido" });
  }
});

app.get("/api/games/:code", async (req, res) => {
  const g = await db.getGameByCode(req.params.code.toUpperCase());
  if (!g) return res.status(404).json({ error: "Partido no encontrado" });
  const players = await db.listPlayers(g.id);
  res.json({ ...publicGame(g), players });
});

app.patch("/api/games/:code", async (req, res) => {
  try {
    const g = await db.getGameByCode(req.params.code.toUpperCase());
    if (!g) return res.status(404).json({ error: "Partido no encontrado" });
    if (String(req.body.pin || "") !== g.admin_pin) return res.status(403).json({ error: "PIN incorrecto" });

    const fields = {};
    if (req.body.name !== undefined) {
      const name = String(req.body.name).trim();
      if (!name || name.length > 60) return res.status(400).json({ error: "Nombre inválido" });
      fields.name = name;
    }
    if (req.body.courtName !== undefined) fields.courtName = String(req.body.courtName).trim().slice(0, 80) || null;
    if (req.body.courtLocation !== undefined) fields.courtLocation = String(req.body.courtLocation).trim().slice(0, 160) || null;
    if (req.body.cupos !== undefined) fields.cupos = Math.min(30, Math.max(2, Number(req.body.cupos) || 14));

    let dateChanged = false;
    if (req.body.matchDate !== undefined) {
      const parsed = parseMatchDate(req.body.matchDate);
      if (parsed === undefined) return res.status(400).json({ error: "Fecha/hora inválida" });
      fields.matchDate = parsed;
      dateChanged = parsed !== g.match_date;
    }
    if (dateChanged) {
      fields.reminder24hSent = false;
      fields.reminder1hSent = false;
    }

    const updated = await db.updateGame(g.id, fields);
    await broadcastState(g.code);
    push.sendToGame(g.id, {
      title: "✏️ Partido actualizado",
      body: `${updated.name} se actualizó${updated.match_date ? " · " + new Date(updated.match_date).toLocaleString("es-CL") : ""}.`,
      url: `/?partido=${g.code}`,
      tag: `updated-${g.code}`,
    }).catch(() => {});
    res.json(publicGame(updated));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "No se pudo actualizar el partido" });
  }
});
app.delete("/api/games/:code", async (req, res) => {
  try {
    const g = await db.getGameByCode(req.params.code.toUpperCase());

    if (!g) {
      return res.status(404).json({ error: "Partido no encontrado" });
    }

    if (String(req.body.pin || "") !== g.admin_pin) {
      return res.status(403).json({ error: "PIN incorrecto" });
    }

    await db.deleteGame(g.id);

    io.to(g.code).emit("gameDeleted");

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "No se pudo borrar el partido" });
  }
});

app.post("/api/games/:code/join", async (req, res) => {
  const g = await db.getGameByCode(req.params.code.toUpperCase());
  if (!g) return res.status(404).json({ error: "Código inválido" });
  const name = String(req.body.name || "").trim();
  if (!name || name.length > 40) return res.status(400).json({ error: "Nombre inválido" });
  try {
    const player = await db.insertPlayer(g.id, name);
    await broadcastState(g.code);
    res.status(201).json({ id: player.id });
  } catch (e) {
    res.status(409).json({ error: "Ese nombre ya está en el partido" });
  }
});

app.patch("/api/games/:code/players/:id", async (req, res) => {
  const g = await db.getGameByCode(req.params.code.toUpperCase());
  if (!g) return res.status(404).json({ error: "Partido no encontrado" });
  const p = await db.getPlayer(Number(req.params.id), g.id);
  if (!p) return res.status(404).json({ error: "Jugador no encontrado" });

  const name = req.body.name !== undefined ? String(req.body.name).trim() : p.name;
  const position = req.body.position !== undefined ? (req.body.position || null) : p.position;
  const status = req.body.status !== undefined ? String(req.body.status) : p.status;
  const avatar = req.body.avatar !== undefined ? (req.body.avatar || null) : p.avatar;
  const media = req.body.media !== undefined ? (req.body.media || null) : p.media;

  if (!name || name.length > 40 || (position && !POS.has(position)) || !STAT.has(status)) {
    return res.status(400).json({ error: "Datos inválidos" });
  }
  try {
    await db.updatePlayer(p.id, g.id, { name, position, status, avatar, media });
  } catch (e) {
    return res.status(409).json({ error: "Ese nombre ya existe" });
  }
  await broadcastState(g.code);

  if (status === "voy" && p.status !== "voy") {
    push.sendToGame(g.id, {
      title: `✅ ${name} va a jugar`,
      body: `${g.name}: ${name} confirmó su asistencia.`,
      url: `/?partido=${g.code}`,
      tag: `voy-${g.code}`,
    }).catch(() => {});
  }
  res.json({ ok: true });
});

app.delete("/api/games/:code/players/:id", async (req, res) => {
  const g = await db.getGameByCode(req.params.code.toUpperCase());
  if (!g) return res.sendStatus(404);
  const ok = await db.deletePlayer(Number(req.params.id), g.id);
  if (!ok) return res.sendStatus(404);
  await broadcastState(g.code);
  res.sendStatus(204);
});

app.post("/api/games/:code/reset", async (req, res) => {
  const g = await db.getGameByCode(req.params.code.toUpperCase());
  if (!g || String(req.body.pin) !== g.admin_pin) return res.status(403).json({ error: "PIN incorrecto" });
  await db.resetPlayers(g.id);
  await broadcastState(g.code);
  res.json({ ok: true });
});

app.get("/*splat", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

io.on("connection", (socket) => {
  socket.on("joinGame", async (code) => {
    const g = await db.getGameByCode(String(code || "").toUpperCase());
    if (!g) return;
    socket.join(g.code);
    const players = await db.listPlayers(g.id);
    socket.emit("state", { game: publicGame(g), players });
  });
});

const PORT = process.env.PORT || 3000;
db.init()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`⚽ Fútbol 7 V4 activo en :${PORT} (DB: ${db.dialect}, storage: ${storage.driver})`);
      scheduler.start();
    });
  })
  .catch((err) => {
    console.error("No se pudo inicializar la base de datos:", err);
    process.exit(1);
  });
