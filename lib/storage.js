// Abstracción de almacenamiento de fotos/videos.
// - STORAGE_DRIVER=local (por defecto): guarda en disco, en /uploads. Ideal para pruebas locales.
// - STORAGE_DRIVER=s3: sube a un bucket compatible con S3 (AWS S3, Cloudflare R2, MinIO, etc.),
//   apto para producción donde el disco del servidor no es persistente (Render, Railway, Fly, etc.).
//   Requiere instalar la dependencia opcional: npm install @aws-sdk/client-s3
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DRIVER = (process.env.STORAGE_DRIVER || "local").toLowerCase();
const localDir = path.join(__dirname, "..", "uploads");
if (DRIVER === "local") fs.mkdirSync(localDir, { recursive: true });

const DATA_URL_RE = /^data:(image\/(png|jpeg|webp)|video\/(mp4|webm|quicktime));base64,(.+)$/;

function parseDataUrl(data) {
  const m = String(data).match(DATA_URL_RE);
  if (!m) return null;
  const mime = m[1];
  const ext = m[2] || ({ mp4: "mp4", webm: "webm", quicktime: "mov" }[m[3]] || "bin");
  const type = mime.startsWith("image/") ? "image" : "video";
  return { mime, ext, type, buffer: Buffer.from(m[4], "base64") };
}

function saveLocal(buffer, ext) {
  const file = crypto.randomBytes(12).toString("hex") + "." + ext;
  fs.writeFileSync(path.join(localDir, file), buffer);
  return "/uploads/" + file;
}

let s3Client = null;
function getS3() {
  if (s3Client) return s3Client;
  let S3Client;
  try {
    ({ S3Client } = require("@aws-sdk/client-s3"));
  } catch (e) {
    throw new Error(
      "STORAGE_DRIVER=s3 requiere la dependencia @aws-sdk/client-s3. Instálala con: npm install @aws-sdk/client-s3"
    );
  }
  s3Client = new S3Client({
    region: process.env.S3_REGION || "auto",
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: !!process.env.S3_ENDPOINT,
    credentials: process.env.AWS_ACCESS_KEY_ID
      ? { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY }
      : undefined,
  });
  return s3Client;
}

async function saveS3(buffer, ext, mime) {
  const { PutObjectCommand } = require("@aws-sdk/client-s3");
  if (!process.env.S3_BUCKET) throw new Error("Falta S3_BUCKET en las variables de entorno");
  const key = "uploads/" + crypto.randomBytes(12).toString("hex") + "." + ext;
  const client = getS3();
  await client.send(new PutObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: mime,
    ACL: process.env.S3_ACL || "public-read",
  }));
  const base = process.env.S3_PUBLIC_URL_BASE;
  if (base) return base.replace(/\/$/, "") + "/" + key;
  return `https://${process.env.S3_BUCKET}.s3.${process.env.S3_REGION || "us-east-1"}.amazonaws.com/${key}`;
}

async function save(dataUrl, maxBytes = 12 * 1024 * 1024) {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) throw Object.assign(new Error("Formato no permitido"), { status: 400 });
  if (parsed.buffer.length > maxBytes) throw Object.assign(new Error("Archivo demasiado grande"), { status: 400 });
  const url = DRIVER === "s3" ? await saveS3(parsed.buffer, parsed.ext, parsed.mime) : saveLocal(parsed.buffer, parsed.ext);
  return { url, type: parsed.type };
}

module.exports = { save, driver: DRIVER, localDir };
