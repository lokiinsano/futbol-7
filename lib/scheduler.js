// Revisa periódicamente los partidos con fecha definida y dispara los
// recordatorios de 24h y 1h antes por Web Push. Corre en el propio proceso
// del servidor: suficiente para un uso amateur de un partido semanal.
// Para producción a mayor escala, se recomienda mover esto a un cron real
// o una cola (ver README, sección "Producción").
const db = require("./db");
const push = require("./push");

const CHECK_INTERVAL_MS = Number(process.env.REMINDER_CHECK_INTERVAL_MS || 60 * 1000);

async function remind(game, which) {
  const players = await db.listPlayers(game.id);
  const voy = players.filter((p) => p.status === "voy").length;
  const cupos = game.cupos || 14;
  const faltan = Math.max(0, cupos - voy);
  const cuando = which === "24h" ? "mañana" : "en 1 hora";
  let body = `${game.name} es ${cuando}${game.court_name ? " en " + game.court_name : ""}. Van ${voy}/${cupos}.`;
  if (faltan > 0) body += ` Faltan ${faltan} jugadores.`;

  await push.sendToGame(game.id, {
    title: `⏰ Recordatorio: ${game.name}`,
    body,
    url: `/?partido=${game.code}`,
    tag: `reminder-${which}-${game.code}`,
  });
  await db.markReminderSent(game.id, which);
}

async function checkOnce() {
  let games = [];
  try {
    games = await db.listUpcomingGames();
  } catch (e) {
    console.error("[scheduler] error listando partidos próximos:", e.message);
    return;
  }
  const now = Date.now();
  for (const g of games) {
    if (!g.match_date) continue;
    const matchTime = new Date(g.match_date).getTime();
    if (Number.isNaN(matchTime)) continue;
    const diffHours = (matchTime - now) / 3600000;

    if (!g.reminder_24h_sent && diffHours <= 24 && diffHours > 1) {
      await remind(g, "24h").catch((e) => console.error("[scheduler] error recordatorio 24h:", e.message));
    }
    if (!g.reminder_1h_sent && diffHours <= 1 && diffHours > -0.25) {
      await remind(g, "1h").catch((e) => console.error("[scheduler] error recordatorio 1h:", e.message));
    }
  }
}

function start() {
  checkOnce().catch(() => {});
  setInterval(() => { checkOnce().catch((e) => console.error("[scheduler]", e.message)); }, CHECK_INTERVAL_MS);
  console.log(`[scheduler] recordatorios 24h/1h activos (revisión cada ${Math.round(CHECK_INTERVAL_MS / 1000)}s)`);
}

module.exports = { start, checkOnce };
