// Envío de Web Push real (llega aunque la pestaña esté cerrada, vía Service Worker).
// Usa VAPID: genera un par de claves con `npm run vapid` y ponlas en .env
const webpush = require("web-push");
const db = require("./db");

const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "";
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";
const SUBJECT = process.env.VAPID_SUBJECT || "mailto:admin@example.com";

let enabled = false;
if (PUBLIC_KEY && PRIVATE_KEY) {
  webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);
  enabled = true;
} else {
  console.warn(
    "[push] VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY no configuradas: las notificaciones push están " +
    "desactivadas. Genera un par con `npm run vapid` y agrégalas al .env para activarlas."
  );
}

// Envía una notificación a todos los dispositivos suscritos a un partido.
// payload: { title, body, url, tag }
async function sendToGame(gameId, payload, { excludeEndpoint } = {}) {
  if (!enabled) return { sent: 0, skipped: true };
  const subs = await db.listPushSubscriptions(gameId);
  let sent = 0;
  await Promise.all(subs.filter((s) => s.endpoint !== excludeEndpoint).map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload)
      );
      sent++;
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        // La suscripción ya no existe (usuario desinstaló / revocó permisos): la limpiamos.
        await db.removePushSubscriptionByEndpoint(s.endpoint);
      } else {
        console.error("[push] error enviando notificación:", err.message);
      }
    }
  }));
  return { sent, skipped: false };
}

module.exports = {
  sendToGame,
  enabled: () => enabled,
  publicKey: PUBLIC_KEY,
};
