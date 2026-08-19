const POS = {
  POR: ["🧤", "Arquero"], DFC: ["🛡️", "Defensa central"], LD: ["🛡️", "Lateral derecho"], LI: ["🛡️", "Lateral izquierdo"],
  MC: ["⚙️", "Mediocentro"], MD: ["⚙️", "Medio derecho"], MI: ["⚙️", "Medio izquierdo"],
  ED: ["⚡", "Extremo derecho"], EI: ["⚡", "Extremo izquierdo"], DC: ["⚡", "Delantero"],
};
const coords = { POR: [8, 50], LI: [23, 22], DFC: [25, 50], LD: [23, 78], MI: [43, 24], MC: [45, 50], MD: [43, 76], EI: [65, 25], DC: [70, 50], ED: [65, 75] };

let code = "", players = [], game = {}, editId = null, chosen = null, countdownTimer = null;
const socket = io();
const $ = (x) => document.querySelector(x);

async function api(path, opt = {}) {
  const r = await fetch(path, { headers: { "Content-Type": "application/json" }, ...opt });
  let x = null; try { x = await r.json(); } catch {}
  if (!r.ok) throw Error(x?.error || "Error");
  return x;
}

// datetime-local -> ISO absoluto (respeta la zona horaria del navegador)
function localInputToISO(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
// ISO -> valor válido para <input type="datetime-local">
function isoToLocalInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function openGame(c, name) {
  code = c;
  $("#landing").classList.add("hidden");
  $("#app").classList.remove("hidden");
  $("#room").textContent = c;
  $("#title").textContent = name;
  socket.emit("joinGame", c);
  refreshNotifButton();
}

// ---------- Crear / Unirse ----------
$("#create").onclick = async () => {
  try {
    const matchDate = localInputToISO($("#matchDate").value);
    const x = await api("/api/games", {
      method: "POST",
      body: JSON.stringify({
        name: $("#gameName").value,
        pin: $("#adminPin").value,
        matchDate,
        courtName: $("#courtName").value,
        courtLocation: $("#courtLocation").value,
        cupos: Number($("#cupos").value) || 14,
      }),
    });
    localStorage.setItem("f7code", x.code);
    localStorage.setItem("f7admin", x.adminPin);
    openGame(x.code, x.gameName);
  } catch (e) { alert(e.message); }
};
$("#join").onclick = async () => {
  try {
    const c = $("#joinCode").value.trim().toUpperCase();

    if (!c) {
      alert("Ingresa el código del partido.");
      return;
    }

    const g = await api("/api/games/" + c);

    openGame(c, g.name);
  } catch (e) {
    alert(e.message || "No se pudo encontrar el partido.");
  }
};
$("#add").onclick = async () => {
  const n = $("#addName").value.trim(); if (!n) return;
  try { await api("/api/games/" + code + "/join", { method: "POST", body: JSON.stringify({ name: n }) }); $("#addName").value = ""; }
  catch (e) { alert(e.message); }
};
$("#homeBtn").onclick = () => { location.href = location.pathname; };

// ---------- Compartir ----------
function inviteText() {
  let t = `⚽ Partido de Fútbol 7\n${$("#title").textContent}\nCódigo: ${code}`;
  if (game.matchDate) t += `\nCuándo: ${new Date(game.matchDate).toLocaleString("es-CL")}`;
  if (game.courtName) t += `\nCancha: ${game.courtName}`;
  if (game.courtLocation) t += ` (${game.courtLocation})`;
  t += `\nEntra en: ${location.origin}/?partido=${code}`;
  return t;
}
$("#copy").onclick = async () => { await navigator.clipboard.writeText(inviteText()); alert("Invitación copiada"); };
$("#wa").onclick = () => { location.href = "https://wa.me/?text=" + encodeURIComponent(inviteText()); };

// ---------- Admin ----------
$("#admin").onclick = () => {
  $("#editName").value = game.name || "";
  $("#editDate").value = isoToLocalInput(game.matchDate);
  $("#editCourt").value = game.courtName || "";
  $("#editLocation").value = game.courtLocation || "";
  $("#editCupos").value = game.cupos || 14;
  $("#adminModal").classList.remove("hidden");
};
$("#ac").onclick = () => $("#adminModal").classList.add("hidden");
$("#ar").onclick = async () => {
  try {
    await api("/api/games/" + code + "/reset", { method: "POST", body: JSON.stringify({ pin: $("#pinCheck").value }) });
    $("#adminModal").classList.add("hidden"); $("#pinCheck").value = "";
  } catch (e) { alert(e.message); }
};
$("#saveEdit").onclick = async () => {
  try {
    await api("/api/games/" + code, {
      method: "PATCH",
      body: JSON.stringify({
        pin: $("#pinCheck").value,
        name: $("#editName").value,
        matchDate: localInputToISO($("#editDate").value),
        courtName: $("#editCourt").value,
        courtLocation: $("#editLocation").value,
        cupos: Number($("#editCupos").value) || 14,
      }),
    });
    $("#adminModal").classList.add("hidden"); $("#pinCheck").value = "";
  } catch (e) { alert(e.message); }
};
$("#notifyMissing").onclick = async () => {
  try {
    const r = await api("/api/games/" + code + "/notify-missing", { method: "POST", body: JSON.stringify({ pin: $("#pinCheck").value }) });
    if (!r.pushEnabled) alert("Aviso registrado, pero el servidor aún no tiene configuradas las claves VAPID (ver README) así que nadie recibirá push todavía.");
    else alert(r.faltan > 0 ? `Aviso enviado: faltan ${r.faltan} jugadores.` : "Aviso enviado: ¡cupos completos!");
  } catch (e) { alert(e.message); }
};
$("#deleteGame").onclick = async () => {
  const pin = $("#pinCheck").value.trim();

  if (!pin) {
    alert("Ingresa el PIN de administrador.");
    return;
  }

  if (!confirm("¿Seguro que quieres borrar este partido? Esta acción no se puede deshacer.")) {
    return;
  }

  try {
    await api("/api/games/" + code, {
      method: "DELETE",
      body: JSON.stringify({ pin })
    });

    alert("Partido borrado correctamente.");
    localStorage.removeItem("f7code");
    location.href = location.pathname;
  } catch (e) {
    alert(e.message);
  }
};
// ---------- Posición ----------
function edit(id) {
  const p = players.find((x) => x.id === id); editId = id; chosen = p.position;
  $("#mt").textContent = "Posición de " + p.name;
  $("#posgrid").innerHTML = Object.entries(POS).map(([k, v]) => `<button class="pos ${chosen === k ? "active" : ""}" data-p="${k}">${v[0]} ${v[1]}</button>`).join("");
  document.querySelectorAll(".pos").forEach((b) => b.onclick = () => { chosen = b.dataset.p; document.querySelectorAll(".pos").forEach((x) => x.classList.remove("active")); b.classList.add("active"); });
  $("#modal").classList.remove("hidden");
}
$("#mc").onclick = () => $("#modal").classList.add("hidden");
$("#ms").onclick = async () => { await api(`/api/games/${code}/players/${editId}`, { method: "PATCH", body: JSON.stringify({ position: chosen }) }); $("#modal").classList.add("hidden"); };

function media(id) { const p = players.find((x) => x.id === id); if (!p.media) { alert("Este jugador no tiene video."); return; } window.open(p.media, "_blank"); }
async function status(id, s) { await api(`/api/games/${code}/players/${id}`, { method: "PATCH", body: JSON.stringify({ status: s }) }); }
async function del(id) { if (confirm("¿Eliminar jugador?")) await fetch(`/api/games/${code}/players/${id}`, { method: "DELETE" }); }

// ---------- Render ----------
function render() {
  const vs = players.filter((x) => x.status === "voy"), pe = players.filter((x) => x.status === "pendiente"), ca = players.filter((x) => x.status === "cancelado");
  $("#v").textContent = vs.length; $("#p").textContent = pe.length; $("#c").textContent = ca.length;

  const cupos = game.cupos || 14;
  const pct = Math.min(100, Math.round((vs.length / cupos) * 100));
  $("#cuposBar").style.width = pct + "%";
  $("#cuposLabel").textContent = vs.length >= cupos ? `Cupos completos (${vs.length}/${cupos})` : `Van ${vs.length} de ${cupos} cupos · faltan ${cupos - vs.length}`;

  $("#list").innerHTML = players.length ? players.map((x) => `<div class="row"><div><div class="name">${esc(x.name)}</div><div class="meta"><span class="pill ${x.status}">${x.status === "voy" ? "✓ Voy" : x.status === "cancelado" ? "✕ Cancelado" : "⏳ Pendiente"}</span><span class="pill">${x.position ? POS[x.position][0] + " " + POS[x.position][1] : "Sin posición"}</span></div></div><div class="actions"><button onclick="status(${x.id},'voy')">✓</button><button onclick="status(${x.id},'pendiente')">?</button><button onclick="status(${x.id},'cancelado')">✕</button><button onclick="edit(${x.id})">⚙</button><button onclick="profile(${x.id})">👤</button><button onclick="media(${x.id})">🎥</button><button onclick="del(${x.id})">🗑</button></div></div>`).join("") : `<div class="muted">No hay jugadores todavía.</div>`;

  $("#pitch").querySelectorAll(".player").forEach((x) => x.remove());
  players.filter((x) => x.position && x.status !== "cancelado").forEach((x) => {
    const c = coords[x.position], e = document.createElement("div");
    e.className = "player"; e.style.left = c[0] + "%"; e.style.top = c[1] + "%"; e.onclick = () => edit(x.id);
    e.innerHTML = `<div class="ball">${x.avatar ? `<img src="${x.avatar}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">` : POS[x.position][0]}</div><small>${esc(x.name)}</small>`;
    $("#pitch").appendChild(e);
  });
}

function renderMeta() {
  $("#title").textContent = game.name || "";
  const bits = [];
  if (game.courtName) bits.push(`📍 ${esc(game.courtName)}`);
  if (game.courtLocation) bits.push(esc(game.courtLocation));
  $("#metaCourt").innerHTML = bits.join(" · ");
  $("#metaWhen").textContent = game.matchDate ? "🗓️ " + new Date(game.matchDate).toLocaleString("es-CL", { dateStyle: "full", timeStyle: "short" }) : "Sin fecha definida";
  startCountdown();
}

function startCountdown() {
  clearInterval(countdownTimer);
  if (!game.matchDate) { $("#countdown").classList.add("hidden"); $("#countdownDone").classList.add("hidden"); return; }
  const tick = () => {
    const diff = new Date(game.matchDate).getTime() - Date.now();
    if (diff <= 0) { $("#countdown").classList.add("hidden"); $("#countdownDone").classList.remove("hidden"); clearInterval(countdownTimer); return; }
    $("#countdown").classList.remove("hidden"); $("#countdownDone").classList.add("hidden");
    const s = Math.floor(diff / 1000);
    $("#cd-d").textContent = Math.floor(s / 86400);
    $("#cd-h").textContent = String(Math.floor((s % 86400) / 3600)).padStart(2, "0");
    $("#cd-m").textContent = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
    $("#cd-s").textContent = String(s % 60).padStart(2, "0");
  };
  tick();
  countdownTimer = setInterval(tick, 1000);
}

// ---------- Perfil ----------
let profileId = null;
function profile(id) {
  profileId = id; const p = players.find((x) => x.id === id);
  $("#profileName").value = p.name; $("#photo").value = ""; $("#video").value = "";
  $("#mediaPreview").innerHTML = p.avatar ? `<img src="${p.avatar}" style="max-width:100%;max-height:180px;border-radius:12px;margin-top:8px">` : "";
  $("#profileModal").classList.remove("hidden");
}
$("#pc").onclick = () => $("#profileModal").classList.add("hidden");
async function fileData(f) { return new Promise((res, rej) => { if (!f) return res(null); const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); }); }
$("#ps").onclick = async () => {
  try {
    const p = players.find((x) => x.id === profileId); let avatar = p.avatar || null, media = p.media || null;
    const ph = $("#photo").files[0], vi = $("#video").files[0];
    if (ph) { const d = await fileData(ph); avatar = (await api("/api/upload", { method: "POST", body: JSON.stringify({ name: ph.name, data: d }) })).url; }
    if (vi) { const d = await fileData(vi); media = (await api("/api/upload", { method: "POST", body: JSON.stringify({ name: vi.name, data: d }) })).url; }
    await api(`/api/games/${code}/players/${profileId}`, { method: "PATCH", body: JSON.stringify({ name: $("#profileName").value, avatar, media }) });
    $("#profileModal").classList.add("hidden");
  } catch (e) { alert(e.message); }
};

// ---------- Tiempo real ----------
(async () => {
  const c = new URLSearchParams(location.search).get("partido");

  if (c) {
    try {
      const code = c.trim().toUpperCase();
      const x = await api("/api/games/" + code);
      openGame(code, x.name);
    } catch {
      alert("El partido no existe o ya fue eliminado.");
    }
  }
})();
// ================= Notificaciones =================
// Notificaciones del navegador + Web Push real (VAPID) vía Service Worker,
// para que lleguen aunque la pestaña esté cerrada.
let swRegistration = null;
let vapidPublicKey = "";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function setupPush() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
  try {
    swRegistration = await navigator.serviceWorker.register("/sw.js");
    const info = await api("/api/push/vapid-public-key");
    vapidPublicKey = info.publicKey || "";
  } catch (e) { console.warn("No se pudo preparar el service worker:", e); }
}

async function refreshNotifButton() {
  const btn = $("#notifBtn"), status = $("#notifStatus");
  if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    btn.disabled = true; status.textContent = "Tu navegador no soporta notificaciones push."; return;
  }
  if (Notification.permission === "denied") { status.textContent = "Notificaciones bloqueadas por el navegador."; btn.textContent = "🔕 Bloqueadas"; return; }
  let subscribed = false;
  if (swRegistration) { const sub = await swRegistration.pushManager.getSubscription(); subscribed = !!sub; }
  btn.textContent = subscribed ? "🔔 Notificaciones activas" : "🔔 Activar notificaciones";
  status.textContent = subscribed ? "Recibirás avisos aunque cierres esta pestaña." : "Actívalas para no perderte novedades del partido.";
}

$("#notifBtn").onclick = async () => {
  try {
    if (!swRegistration) await setupPush();
    if (!vapidPublicKey) { alert("El servidor todavía no tiene configuradas las claves VAPID (ver README: npm run vapid)."); return; }
    const perm = await Notification.requestPermission();
    if (perm !== "granted") { refreshNotifButton(); return; }
    let sub = await swRegistration.pushManager.getSubscription();
    if (!sub) {
      sub = await swRegistration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) });
    }
    await api(`/api/games/${code}/push/subscribe`, { method: "POST", body: JSON.stringify({ subscription: sub }) });
    refreshNotifButton();
  } catch (e) { alert("No se pudieron activar las notificaciones: " + e.message); }
};

setupPush().then(refreshNotifButton);
