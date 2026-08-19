# ⚽ Fútbol 7 · V4

Organiza partidos de fútbol 7 con jugadores sincronizados en tiempo real, formación visual,
perfiles con foto/video, y ahora **fecha/cancha, cuenta regresiva y notificaciones push reales**.

## Qué mantiene la V3 (sin cambios de comportamiento)

- Crear partido con nombre y PIN de administrador.
- Código único de 6 caracteres para unirse.
- Jugadores sincronizados en tiempo real por Socket.IO.
- Estados: Voy / Pendiente / Cancelado.
- Posiciones de fútbol 7 y formación visual sobre la cancha.
- Perfil de jugador con foto y video.
- Avatar visible en la cancha.
- Compartir invitación por WhatsApp.

## Qué se agregó en la V4

1. **Fecha y hora del partido** (al crear y editable después).
2. **Nombre/ubicación de la cancha**.
3. **Cuenta regresiva** en vivo hasta el partido (días/horas/min/seg).
4. **Notificaciones del navegador** (botón "🔔 Activar notificaciones").
5. **Recordatorio 24 horas antes**, automático.
6. **Recordatorio 1 hora antes**, automático.
7. **Aviso cuando el partido se crea o se modifica** (fecha, cancha, nombre, cupos).
8. **Aviso cuando un jugador cambia a "Voy"**.
9. **Aviso cuando faltan jugadores** (botón de admin "📣 Avisar jugadores faltantes", y
   se incluye automáticamente en los recordatorios de 24h/1h si aún faltan cupos).
10. **Web Push real** (VAPID) vía Service Worker: llegan aunque la pestaña esté cerrada.
11. **Sistema de suscripción de dispositivos** por partido (cada celular/PC se suscribe aparte).
12. Sigue siendo **responsive**: celular, tablet y PC.
13. **SQLite en local**, arquitectura lista para **PostgreSQL en producción** (cambia solo una
    variable de entorno).
14. **Fotos y video** siguen funcionando; el almacenamiento es una capa intercambiable:
    disco local (dev) o S3-compatible (producción).

---

## 1. Instalación local (SQLite, modo prueba)

Requisitos: Node.js 18+ (recomendado 20+).

```bash
cd futbol7-v4
npm install
cp .env.example .env
npm run vapid        # genera las claves VAPID e imprime dos líneas
```

Copia las dos líneas que imprime `npm run vapid` (`VAPID_PUBLIC_KEY` y `VAPID_PRIVATE_KEY`) dentro
de tu archivo `.env`, reemplazando las que están vacías. Sin esas claves el servidor funciona
igual, pero las notificaciones push quedan desactivadas (el resto de la app funciona normal).

```bash
npm start
```

Abre `http://localhost:3000`. Con `DATABASE_URL` vacío en `.env`, se usa SQLite y crea
automáticamente `futbol7.db` en la carpeta del proyecto (con WAL activado).

Para desarrollo con recarga automática:

```bash
npm run dev
```

### Notas sobre notificaciones en local

- El navegador requiere **HTTPS o `localhost`** para Service Workers y Web Push — `localhost`
  funciona sin certificado, así que no necesitas nada especial para probarlo en tu máquina.
- Al tocar "🔔 Activar notificaciones" el navegador pedirá permiso; acéptalo y se suscribirá
  ese dispositivo a las notificaciones de ese partido específico.
- Puedes probar el flujo completo: crea un partido con fecha 2 minutos en el futuro, activa
  notificaciones y espera — no hay recordatorio de "2 minutos antes" (solo 24h y 1h), pero sí
  verás inmediatamente la notificación de "Partido actualizado" si editas el partido, o "X va a
  jugar" si cambias el estado de un jugador a Voy desde otra pestaña/dispositivo.

---

## 2. Arquitectura

```
futbol7-v4/
├── server.js              # rutas HTTP + Socket.IO + arranque
├── lib/
│   ├── db.js               # elige sqlite o postgres según DATABASE_URL
│   ├── db-sqlite.js         # adaptador SQLite (better-sqlite3)
│   ├── db-postgres.js       # adaptador PostgreSQL (pg) — misma interfaz
│   ├── storage.js           # fotos/video: disco local o S3-compatible
│   ├── push.js              # envío de Web Push (VAPID)
│   └── scheduler.js         # recordatorios 24h / 1h
├── scripts/
│   └── generate-vapid.js    # genera claves VAPID
├── public/
│   ├── index.html            # UI
│   ├── app.js                 # lógica del cliente (sockets, push, countdown)
│   └── sw.js                  # Service Worker (recibe Web Push)
├── .env.example
└── package.json
```

`lib/db-sqlite.js` y `lib/db-postgres.js` exponen **exactamente las mismas funciones async**
(`createGame`, `listPlayers`, `updatePlayer`, `listPushSubscriptions`, etc.). `lib/db.js` elige
uno u otro con una sola condición (`DATABASE_URL` empieza con `postgres`), así que el resto del
código (rutas, push, scheduler) no sabe ni le importa qué motor está corriendo debajo.

---

## 3. Base de datos en producción (PostgreSQL)

1. Crea una base Postgres (Railway, Render, Supabase, Neon, RDS, o tu propio contenedor).
2. En tu `.env` de producción define:
   ```bash
   DATABASE_URL=postgres://usuario:password@host:5432/futbol7
   ```
3. Listo — al iniciar, `server.js` llama a `db.init()`, que crea las tablas si no existen
   (no hace falta correr migraciones a mano). No definas `DB_PATH` en ese entorno.
4. Si tu proveedor de Postgres no requiere SSL (por ejemplo un contenedor local), agrega
   `PGSSL=false`; por defecto el adaptador asume SSL con `rejectUnauthorized:false`, que es lo
   que piden la mayoría de los proveedores gestionados (Render, Railway, Supabase, Neon).

No necesitas tocar ninguna consulta SQL de la app para migrar: es cambiar una variable de entorno.

---

## 4. Fotos y video en producción (almacenamiento)

En local, `STORAGE_DRIVER=local` (por defecto) guarda los archivos en `uploads/` en disco. Esto
**no sirve en producción** en plataformas con sistema de archivos efímero (Render, Railway, Fly,
Heroku): los archivos se perderían en cada redeploy o reinicio.

Para producción, usa almacenamiento tipo S3 (funciona igual con AWS S3, Cloudflare R2, Backblaze
B2, MinIO auto-hospedado, etc.):

```bash
npm install @aws-sdk/client-s3
```

Y en tu `.env` de producción:

```bash
STORAGE_DRIVER=s3
S3_BUCKET=mi-bucket
S3_REGION=auto                       # "auto" funciona en R2; en AWS usa ej. us-east-1
S3_ENDPOINT=https://<cuenta>.r2.cloudflarestorage.com   # omite esta línea si usas AWS S3 real
S3_PUBLIC_URL_BASE=https://cdn.midominio.com            # dominio público / CDN delante del bucket
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

`lib/storage.js` solo importa el SDK de AWS cuando `STORAGE_DRIVER=s3`, así que si te quedas en
modo local no necesitas instalar esa dependencia extra.

---

## 5. Notificaciones push en producción

1. Genera un par de claves VAPID **una sola vez** (no las regeneres después, o los dispositivos
   ya suscritos dejarán de recibir avisos):
   ```bash
   npm run vapid
   ```
2. Copia `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` y `VAPID_SUBJECT` (un `mailto:` real) a las
   variables de entorno de tu hosting.
3. El sitio debe servirse por **HTTPS** en producción (requisito del navegador para Service
   Workers/Push, salvo `localhost`). La mayoría de plataformas (Render, Railway, Vercel, Fly)
   dan HTTPS automático.
4. El recordatorio automático de 24h/1h corre dentro del propio proceso de Node
   (`lib/scheduler.js`, revisa cada `REMINDER_CHECK_INTERVAL_MS`, por defecto 60s). Para una
   escala mayor (muchos partidos, alta disponibilidad con varias instancias corriendo a la vez),
   te recomendamos moverlo a un cron job real o una cola (por ejemplo `node-cron` con un solo
   worker dedicado, o BullMQ + Redis) para evitar que dos instancias envíen el mismo recordatorio
   dos veces. Para el uso típico de organizar partidos amateur, el scheduler en proceso es
   suficiente.

### Qué dispara cada notificación

| Evento | Cuándo se envía |
|---|---|
| Partido creado | No se notifica al creador (obviamente ya lo sabe); los que se unen después ven los datos en pantalla. |
| Partido modificado (fecha, cancha, nombre, cupos) | Al instante, a todos los dispositivos suscritos a ese partido. Si cambia la fecha, se reinician los recordatorios de 24h/1h. |
| Un jugador pasa a "Voy" | Al instante, a todos los suscritos del partido. |
| Faltan jugadores | Manual, con el botón de administrador "📣 Avisar jugadores faltantes"; además se incluye automáticamente el conteo de cupos faltantes dentro de los recordatorios de 24h y 1h si aún no se completan. |
| Recordatorio 24h / 1h antes | Automático, una sola vez cada uno por partido (se controla con `reminder_24h_sent` / `reminder_1h_sent` en la base de datos). |

> Nota de diseño: para evitar spam, el aviso de "faltan jugadores" es manual (lo dispara el
> administrador cuando quiera) en vez de automático en cada cambio de estado — así no se satura
> a todos con una notificación cada vez que alguien cancela.

---

## 6. Despliegue (ejemplo genérico: Render / Railway / Fly / VPS)

1. Sube el proyecto a un repositorio Git.
2. Crea el servicio web apuntando a `npm start` (con `npm install` como build command).
3. Variables de entorno mínimas en producción:
   ```
   PORT=3000
   DATABASE_URL=postgres://...
   VAPID_PUBLIC_KEY=...
   VAPID_PRIVATE_KEY=...
   VAPID_SUBJECT=mailto:tucorreo@dominio.com
   STORAGE_DRIVER=s3
   S3_BUCKET=...
   S3_REGION=...
   S3_PUBLIC_URL_BASE=...
   AWS_ACCESS_KEY_ID=...
   AWS_SECRET_ACCESS_KEY=...
   ```
4. Si usas S3, agrega `@aws-sdk/client-s3` a las dependencias instaladas (`npm install
   @aws-sdk/client-s3` antes de desplegar, o agrégalo directamente a `package.json`).
5. Despliega. Al iniciar verás en los logs algo como:
   ```
   ⚽ Fútbol 7 V4 activo en :3000 (DB: postgres, storage: s3)
   [scheduler] recordatorios 24h/1h activos (revisión cada 60s)
   ```

---

## 7. Endpoints de la API (nuevos en V4, además de los existentes)

- `PATCH /api/games/:code` — editar partido (requiere `pin`): `name`, `matchDate`, `courtName`,
  `courtLocation`, `cupos`.
- `POST /api/games/:code/notify-missing` — envía el aviso de jugadores faltantes (requiere `pin`).
- `GET /api/push/vapid-public-key` — clave pública VAPID para suscribirse desde el navegador.
- `POST /api/games/:code/push/subscribe` — guarda la suscripción push de un dispositivo.
- `POST /api/games/:code/push/unsubscribe` — elimina una suscripción push.

Todos los endpoints existentes (`POST /api/games`, `GET /api/games/:code`, `POST
/api/games/:code/join`, `PATCH/DELETE /api/games/:code/players/:id`, `POST
/api/games/:code/reset`, `POST /api/upload`) se mantienen, extendidos con los nuevos campos
donde corresponde (fecha, cancha, cupos).

---

## 8. Probado

Se verificó localmente con SQLite: crear partido con fecha/cancha/cupos, unirse, marcar "Voy",
editar partido (con y sin PIN correcto), disparar aviso de jugadores faltantes, eliminar jugador,
y el `scheduler` corriendo sin errores. El proyecto arranca limpio con `npm install && npm start`.
