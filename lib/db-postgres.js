// Adaptador PostgreSQL (uso en producción).
// Se activa automáticamente cuando DATABASE_URL empieza con "postgres".
// Implementa la misma interfaz async que lib/db-sqlite.js.
const crypto = require("crypto");
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === "false" ? false : { rejectUnauthorized: false },
});

async function q(text, params = []) {
  return pool.query(text, params);
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS games(
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  admin_pin TEXT NOT NULL,
  court_name TEXT,
  court_location TEXT,
  match_date TIMESTAMPTZ,
  cupos INTEGER NOT NULL DEFAULT 14,
  reminder_24h_sent BOOLEAN NOT NULL DEFAULT FALSE,
  reminder_1h_sent BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS players(
  id SERIAL PRIMARY KEY,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position TEXT,
  status TEXT NOT NULL DEFAULT 'pendiente',
  avatar TEXT,
  media TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(game_id, name)
);
CREATE TABLE IF NOT EXISTS push_subscriptions(
  id SERIAL PRIMARY KEY,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player_id INTEGER,
  endpoint TEXT UNIQUE NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

async function generateCode() {
  let c;
  let exists = true;
  do {
    c = crypto.randomBytes(3).toString("hex").toUpperCase();
    const r = await q("SELECT 1 FROM games WHERE code = $1", [c]);
    exists = r.rowCount > 0;
  } while (exists);
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
  dialect: "postgres",

  async init() {
    await q(SCHEMA);
  },

  async genCode() { return generateCode(); },

  async createGame({ code, name, adminPin, courtName, courtLocation, matchDate, cupos }) {
    const r = await q(`
      INSERT INTO games(code, name, admin_pin, court_name, court_location, match_date, cupos)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *
    `, [code, name, adminPin, courtName || null, courtLocation || null, matchDate || null, cupos || 14]);
    return r.rows[0];
  },

  async getGameByCode(code) {
    const r = await q("SELECT * FROM games WHERE code = $1", [code]);
    return r.rows[0] || null;
  },

  async getGameById(id) {
    const r = await q("SELECT * FROM games WHERE id = $1", [id]);
    return r.rows[0] || null;
  },

  async updateGame(id, fields) {
    const sets = [];
    const values = [];
    let i = 1;
    for (const [key, col] of Object.entries(FIELD_MAP)) {
      if (Object.prototype.hasOwnProperty.call(fields, key)) {
        sets.push(`${col} = $${i++}`);
        values.push(fields[key]);
      }
    }
    if (sets.length) {
      sets.push("updated_at = NOW()");
      values.push(id);
      await q(`UPDATE games SET ${sets.join(", ")} WHERE id = $${i}`, values);
    }
    return this.getGameById(id);
  },

  async listPlayers(gameId) {
    const r = await q("SELECT * FROM players WHERE game_id = $1 ORDER BY id", [gameId]);
    return r.rows;
  },

  async getPlayer(id, gameId) {
    const r = await q("SELECT * FROM players WHERE id = $1 AND game_id = $2", [id, gameId]);
    return r.rows[0] || null;
  },

  async insertPlayer(gameId, name) {
    const r = await q("INSERT INTO players(game_id, name, status) VALUES($1,$2,'pendiente') RETURNING *", [gameId, name]);
    return r.rows[0];
  },

  async updatePlayer(id, gameId, { name, position, status, avatar, media }) {
    await q(`
      UPDATE players SET name=$1, position=$2, status=$3, avatar=$4, media=$5, updated_at=NOW()
      WHERE id=$6 AND game_id=$7
    `, [name, position, status, avatar, media, id, gameId]);
    return this.getPlayer(id, gameId);
  },

  async deletePlayer(id, gameId) {
    const r = await q("DELETE FROM players WHERE id=$1 AND game_id=$2", [id, gameId]);
    return r.rowCount > 0;
  },

  async resetPlayers(gameId) {
    await q("DELETE FROM players WHERE game_id=$1", [gameId]);
  },
  async deleteGame(gameId) {
    await q("DELETE FROM games WHERE id=$1", [gameId]);
  },

  async addPushSubscription(gameId, playerId, subscription) {
    await q(`
      INSERT INTO push_subscriptions(game_id, player_id, endpoint, p256dh, auth)
      VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(endpoint) DO UPDATE SET game_id=EXCLUDED.game_id, player_id=EXCLUDED.player_id,
        p256dh=EXCLUDED.p256dh, auth=EXCLUDED.auth
    `, [gameId, playerId || null, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth]);
  },

  async removePushSubscriptionByEndpoint(endpoint) {
    await q("DELETE FROM push_subscriptions WHERE endpoint=$1", [endpoint]);
  },

  async listPushSubscriptions(gameId) {
    const r = await q("SELECT * FROM push_subscriptions WHERE game_id=$1", [gameId]);
    return r.rows;
  },

  async markReminderSent(gameId, which) {
    const col = which === "24h" ? "reminder_24h_sent" : "reminder_1h_sent";
    await q(`UPDATE games SET ${col}=TRUE WHERE id=$1`, [gameId]);
  },

  async listUpcomingGames() {
    const r = await q(`
      SELECT * FROM games
      WHERE match_date IS NOT NULL AND (reminder_24h_sent = FALSE OR reminder_1h_sent = FALSE)
    `);
    return r.rows;
  },
};
