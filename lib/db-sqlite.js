// Adaptador SQLite (uso local / desarrollo).
// Implementa la misma interfaz async que lib/db-postgres.js para que
// server.js, lib/push.js y lib/scheduler.js sean independientes del motor.
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const Database = require("better-sqlite3");

const dbPath = process.env.DB_PATH || path.join(__dirname, "..", "futbol7.db");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS games(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      admin_pin TEXT NOT NULL,
      court_name TEXT,
      court_location TEXT,
      match_date TEXT,
      cupos INTEGER NOT NULL DEFAULT 14,
      reminder_24h_sent INTEGER NOT NULL DEFAULT 0,
      reminder_1h_sent INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS players(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      position TEXT,
      status TEXT NOT NULL DEFAULT 'pendiente',
      avatar TEXT,
      media TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(game_id, name),
      FOREIGN KEY(game_id) REFERENCES games(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS push_subscriptions(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id INTEGER NOT NULL,
      player_id INTEGER,
      endpoint TEXT UNIQUE NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(game_id) REFERENCES games(id) ON DELETE CASCADE
    );
  `);
  // Migración suave desde bases de datos de V2/V3 que no tenían estas columnas.
  const gcols = db.prepare("PRAGMA table_info(games)").all().map((c) => c.name);
  const addGameCol = (name, def) => {
    if (!gcols.includes(name)) {
      try { db.exec(`ALTER TABLE games ADD COLUMN ${name} ${def}`); } catch (e) { /* ya existe */ }
    }
  };
  addGameCol("court_name", "TEXT");
  addGameCol("court_location", "TEXT");
  addGameCol("match_date", "TEXT");
  addGameCol("cupos", "INTEGER NOT NULL DEFAULT 14");
  addGameCol("reminder_24h_sent", "INTEGER NOT NULL DEFAULT 0");
  addGameCol("reminder_1h_sent", "INTEGER NOT NULL DEFAULT 0");
  addGameCol("updated_at", "TEXT");

  const pcols = db.prepare("PRAGMA table_info(players)").all().map((c) => c.name);
  const addPlayerCol = (name, def) => {
    if (!pcols.includes(name)) {
      try { db.exec(`ALTER TABLE players ADD COLUMN ${name} ${def}`); } catch (e) { /* ya existe */ }
    }
  };
  addPlayerCol("avatar", "TEXT");
  addPlayerCol("media", "TEXT");
}
migrate();

function generateCode() {
  let c;
  do { c = crypto.randomBytes(3).toString("hex").toUpperCase(); }
  while (db.prepare("SELECT 1 FROM games WHERE code = ?").get(c));
  return c;
}

const FIELD_MAP = {
  name: "name",
  courtName: "court_name",
  courtLocation: "court_location",
  matchDate: "match_date",
  cupos: "cupos",
  reminder24hSent: "reminder_24h_sent",
  reminder1hSent: "reminder_1h_sent",
};

module.exports = {
  dialect: "sqlite",

  async init() { /* migrate() ya corrió al cargar el módulo */ },

  async genCode() { return generateCode(); },

  async createGame({ code, name, adminPin, courtName, courtLocation, matchDate, cupos }) {
    const r = db.prepare(`
      INSERT INTO games(code, name, admin_pin, court_name, court_location, match_date, cupos)
      VALUES(?,?,?,?,?,?,?)
    `).run(code, name, adminPin, courtName || null, courtLocation || null, matchDate || null, cupos || 14);
    return this.getGameById(r.lastInsertRowid);
  },

  async getGameByCode(code) {
    return db.prepare("SELECT * FROM games WHERE code = ?").get(code) || null;
  },

  async getGameById(id) {
    return db.prepare("SELECT * FROM games WHERE id = ?").get(id) || null;
  },

  async updateGame(id, fields) {
    const sets = [];
    const values = [];
    for (const [key, col] of Object.entries(FIELD_MAP)) {
      if (Object.prototype.hasOwnProperty.call(fields, key)) {
        sets.push(`${col} = ?`);
        let v = fields[key];
        if (typeof v === "boolean") v = v ? 1 : 0;
        values.push(v);
      }
    }
    if (sets.length) {
      sets.push("updated_at = CURRENT_TIMESTAMP");
      values.push(id);
      db.prepare(`UPDATE games SET ${sets.join(", ")} WHERE id = ?`).run(...values);
    }
    return this.getGameById(id);
  },

  async listPlayers(gameId) {
    return db.prepare("SELECT * FROM players WHERE game_id = ? ORDER BY id").all(gameId);
  },

  async getPlayer(id, gameId) {
    return db.prepare("SELECT * FROM players WHERE id = ? AND game_id = ?").get(id, gameId) || null;
  },

  async insertPlayer(gameId, name) {
    const r = db.prepare("INSERT INTO players(game_id, name, status) VALUES(?,?,'pendiente')").run(gameId, name);
    return this.getPlayer(r.lastInsertRowid, gameId);
  },

  async updatePlayer(id, gameId, { name, position, status, avatar, media }) {
    db.prepare(`
      UPDATE players SET name=?, position=?, status=?, avatar=?, media=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND game_id=?
    `).run(name, position, status, avatar, media, id, gameId);
    return this.getPlayer(id, gameId);
  },

  async deletePlayer(id, gameId) {
    const r = db.prepare("DELETE FROM players WHERE id=? AND game_id=?").run(id, gameId);
    return r.changes > 0;
  },

  async resetPlayers(gameId) {
    db.prepare("DELETE FROM players WHERE game_id=?").run(gameId);
  },

  async addPushSubscription(gameId, playerId, subscription) {
    db.prepare(`
      INSERT INTO push_subscriptions(game_id, player_id, endpoint, p256dh, auth)
      VALUES(?,?,?,?,?)
      ON CONFLICT(endpoint) DO UPDATE SET game_id=excluded.game_id, player_id=excluded.player_id,
        p256dh=excluded.p256dh, auth=excluded.auth
    `).run(gameId, playerId || null, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth);
  },

  async removePushSubscriptionByEndpoint(endpoint) {
    db.prepare("DELETE FROM push_subscriptions WHERE endpoint=?").run(endpoint);
  },

  async listPushSubscriptions(gameId) {
    return db.prepare("SELECT * FROM push_subscriptions WHERE game_id=?").all(gameId);
  },

  async markReminderSent(gameId, which) {
    const col = which === "24h" ? "reminder_24h_sent" : "reminder_1h_sent";
    db.prepare(`UPDATE games SET ${col}=1 WHERE id=?`).run(gameId);
  },

  async listUpcomingGames() {
    return db.prepare(`
      SELECT * FROM games
      WHERE match_date IS NOT NULL AND (reminder_24h_sent = 0 OR reminder_1h_sent = 0)
    `).all();
  },
};
