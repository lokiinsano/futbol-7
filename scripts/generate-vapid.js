// Genera un par de claves VAPID para Web Push.
// Uso: npm run vapid
// Copia el resultado a tu archivo .env (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY).
const webpush = require("web-push");

const keys = webpush.generateVAPIDKeys();
console.log("\nAgrega esto a tu archivo .env:\n");
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log(`VAPID_SUBJECT=mailto:tu-correo@ejemplo.com\n`);
