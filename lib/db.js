// Selector de motor de base de datos.
// - Local / pruebas: SQLite (por defecto, sin configuración).
// - Producción: define DATABASE_URL=postgres://... y se usa PostgreSQL automáticamente.
// Ambos adaptadores exponen exactamente las mismas funciones async,
// así que el resto de la app (server.js, lib/push.js, lib/scheduler.js) no sabe ni le importa cuál está activo.
const usePostgres = !!(process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith("postgres"));

module.exports = usePostgres ? require("./db-postgres") : require("./db-sqlite");
