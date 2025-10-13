// index.js — PeliPREX API v4.1 (catálogo local + respaldo opcional GitHub)
// Autor: José (PeliPREX Developer)

import express from "express";
import cors from "cors";
import fs from "fs";
import fetch from "node-fetch";
import path from "path";

const app = express();
app.use(cors());

// 🔑 Claves de API y variables opcionales
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO;

// 📂 Archivos locales
const PELIS_FILE = path.join(process.cwd(), "peliculas.json");
const USERS_FILE = path.join(process.cwd(), "users_data.json");

// ---------------- FUNCIONES DE ARCHIVOS ----------------
function ensureFile(file, defaultData) {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(defaultData, null, 2));
    console.log(`📁 Archivo creado: ${file}`);
  }
}

function readJSON(file, fallback) {
  try {
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, JSON.stringify(fallback, null, 2));
      return fallback;
    }
    const data = fs.readFileSync(file, "utf8");
    return JSON.parse(data);
  } catch (err) {
    console.error(`❌ Error leyendo ${file}:`, err.message);
    return fallback;
  }
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ---------------- RESTAURAR DESDE GITHUB ----------------
async function restoreFromGitHub() {
  if (!GITHUB_TOKEN || !GITHUB_REPO) {
    console.warn("⚠️ No hay credenciales de GitHub. Se omite restauración.");
    return;
  }

  const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/users_data.json`;
  try {
    const res = await fetch(apiUrl, {
      headers: { Authorization: `token ${GITHUB_TOKEN}` },
    });
    if (res.status === 200) {
      const data = await res.json();
      const content = Buffer.from(data.content, "base64").toString("utf8");
      fs.writeFileSync(USERS_FILE, content);
      console.log("✅ Respaldo restaurado correctamente desde GitHub.");
    } else {
      console.log("📂 No hay respaldo previo en GitHub (nuevo archivo).");
      ensureFile(USERS_FILE, { users: {} });
      await backupToGitHub();
    }
  } catch (err) {
    console.error("❌ Error restaurando desde GitHub:", err.message);
  }
}

// ---------------- RESPALDO AUTOMÁTICO ----------------
async function backupToGitHub() {
  if (!GITHUB_TOKEN || !GITHUB_REPO) return;
  try {
    const content = fs.readFileSync(USERS_FILE, "utf8");
    const base64Content = Buffer.from(content).toString("base64");
    const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/users_data.json`;

    const existing = await fetch(apiUrl, {
      headers: { Authorization: `token ${GITHUB_TOKEN}` },
    });
    const existingData = await existing.json();

    const body = {
      message: `Respaldo automático ${new Date().toISOString()}`,
      content: base64Content,
      sha: existingData.sha || undefined,
    };

    await fetch(apiUrl, {
      method: "PUT",
      headers: {
        Authorization: `token ${GITHUB_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    console.log("✅ Respaldo guardado correctamente en GitHub");
  } catch (error) {
    console.error("❌ Error al subir respaldo a GitHub:", error.message);
  }
}

// ---------------- FUNCIONES DE USUARIOS ----------------
function getOrCreateUser(email) {
  if (!email) return null;
  const data = readJSON(USERS_FILE, { users: {} });
  if (!data.users[email]) {
    data.users[email] = {
      email,
      tipoPlan: "creditos",
      credits: 5,
      favorites: [],
      history: [],
      resume: {},
      ajustes: { modoOscuro: false, idioma: "es", notificaciones: true },
      stats: { vistasTotales: 0, favoritasTotales: 0 },
    };
    writeJSON(USERS_FILE, data);
  }
  return data.users[email];
}

function saveUser(email, userObj) {
  const data = readJSON(USERS_FILE, { users: {} });
  data.users[email] = userObj;
  writeJSON(USERS_FILE, data);
  backupToGitHub();
}

// ---------------- CONTROL DE INACTIVIDAD ----------------
let ultimaPeticion = Date.now();
const TIEMPO_INACTIVIDAD = 60 * 1000;

setInterval(() => {
  if (Date.now() - ultimaPeticion >= TIEMPO_INACTIVIDAD) {
    console.log("🕒 Sin tráfico. Cerrando servidor...");
    process.exit(0);
  }
}, 30 * 1000);

app.use((req, res, next) => {
  ultimaPeticion = Date.now();
  next();
});

// ---------------- ENDPOINTS PRINCIPALES ----------------
app.get("/", (req, res) => {
  res.json({
    mensaje: "🎬 PeliPREX API funcionando correctamente",
    ejemplo: "/peliculas, /peliculas/search?q=batman o /user/get?email=ejemplo@gmail.com",
  });
});

// 🔹 Cargar todas las películas
app.get("/peliculas", (req, res) => {
  try {
    ensureFile(PELIS_FILE, { peliculas: [] });
    const data = readJSON(PELIS_FILE, { peliculas: [] });
    res.json(data.peliculas);
  } catch (error) {
    console.error("❌ Error cargando películas:", error.message);
    res.status(500).json({ error: "No se pudo cargar el catálogo de películas." });
  }
});

// 🔹 Buscar películas por nombre parcial
app.get("/peliculas/search", (req, res) => {
  const q = (req.query.q || "").toLowerCase();
  if (!q) return res.json([]);
  const data = readJSON(PELIS_FILE, { peliculas: [] });
  const resultados = data.peliculas.filter(p =>
    (p.titulo || "").toLowerCase().includes(q)
  );
  res.json(resultados);
});

// ---------------- AJUSTES DE USUARIO ----------------
app.get("/user/get", (req, res) => {
  const email = (req.query.email || "").toLowerCase();
  res.json(getOrCreateUser(email));
});

app.get("/user/get_settings", (req, res) => {
  const email = (req.query.email || "").toLowerCase();
  const user = getOrCreateUser(email);
  res.json(user.ajustes);
});

app.get("/user/update_settings", (req, res) => {
  const email = (req.query.email || "").toLowerCase();
  const user = getOrCreateUser(email);
  const { modoOscuro, idioma, notificaciones } = req.query;

  if (modoOscuro !== undefined) user.ajustes.modoOscuro = modoOscuro === "true";
  if (idioma) user.ajustes.idioma = idioma;
  if (notificaciones !== undefined)
    user.ajustes.notificaciones = notificaciones === "true";

  saveUser(email, user);
  res.json({ ok: true, ajustes: user.ajustes });
});

// ---------------- FAVORITOS E HISTORIAL ----------------
app.get("/user/add_favorite", (req, res) => {
  const email = (req.query.email || "").toLowerCase();
  const { titulo, imagen_url, pelicula_url } = req.query;
  if (!email || !titulo || !pelicula_url)
    return res.status(400).json({ error: "Faltan parámetros" });

  const user = getOrCreateUser(email);
  if (!user.favorites.some(f => f.pelicula_url === pelicula_url)) {
    user.favorites.unshift({
      titulo,
      imagen_url,
      pelicula_url,
      addedAt: new Date().toISOString(),
    });
    user.stats.favoritasTotales++;
    saveUser(email, user);
  }
  res.json({ ok: true, favorites: user.favorites });
});

app.get("/user/add_history", (req, res) => {
  const email = (req.query.email || "").toLowerCase();
  const { titulo, pelicula_url, imagen_url } = req.query;
  if (!email || !titulo || !pelicula_url)
    return res.status(400).json({ error: "Faltan parámetros" });

  const user = getOrCreateUser(email);
  user.history.unshift({
    titulo,
    pelicula_url,
    imagen_url,
    fecha: new Date().toISOString(),
  });
  user.stats.vistasTotales++;
  if (user.history.length > 200) user.history = user.history.slice(0, 200);
  saveUser(email, user);
  res.json({ ok: true, total: user.history.length });
});

// ---------------- INICIAR SERVIDOR ----------------
const PORT = process.env.PORT || 8080;
restoreFromGitHub().then(() => {
  ensureFile(PELIS_FILE, { peliculas: [] });
  ensureFile(USERS_FILE, { users: {} });
  app.listen(PORT, () => console.log(`🚀 Servidor PeliPREX en puerto ${PORT}`));
});
