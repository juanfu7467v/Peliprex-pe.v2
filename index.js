// index.js — PeliPREX API v3 (con respaldo GitHub persistente)
// Autor: José (PeliPREX Developer)

import express from "express";
import cors from "cors";
import fs from "fs";
import fetch from "node-fetch";
import path from "path";

const app = express();
app.use(cors());

// 🔑 Variables de entorno
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO;
const TMDB_API_KEY = "392ee84e8d4ef03605cc1faa6c40b2a8";
const YOUTUBE_API_KEY = "AIzaSyDoT2sEt2y9a-H55keel8E6xdo3CMIHiG4";

// 📂 Archivos locales
const PELIS_FILE = path.join(process.cwd(), "peliculas.json");
const USERS_FILE = path.join(process.cwd(), "users_data.json");

// ------------------- FUNCIONES DE ARCHIVOS -------------------
function ensureUsersFile() {
  if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify({ users: {} }, null, 2));
  }
}

function readUsersData() {
  ensureUsersFile();
  return JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
}

function writeUsersData(data) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
  backupToGitHub();
}

function getOrCreateUser(email) {
  if (!email) return null;
  const data = readUsersData();
  if (!data.users[email]) {
    data.users[email] = {
      email,
      tipoPlan: "creditos",
      credits: 5,
      favorites: [],
      history: [],
      resume: {},
      stats: {
        vistasTotales: 0,
        favoritasTotales: 0,
      },
    };
    writeUsersData(data);
  }
  return data.users[email];
}

function saveUser(email, userObj) {
  const data = readUsersData();
  data.users[email] = userObj;
  writeUsersData(data);
}

// ------------------- RESTAURAR DESDE GITHUB -------------------
async function restoreFromGitHub() {
  if (!GITHUB_TOKEN || !GITHUB_REPO) {
    console.warn("⚠️ No hay credenciales de GitHub. No se restaurará respaldo.");
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
      ensureUsersFile();
      await backupToGitHub();
    }
  } catch (err) {
    console.error("❌ Error restaurando desde GitHub:", err.message);
  }
}

// ------------------- RESPALDO AUTOMÁTICO GITHUB -------------------
async function backupToGitHub() {
  if (!GITHUB_TOKEN || !GITHUB_REPO) {
    console.warn("⚠️ No hay credenciales de GitHub, se omite respaldo.");
    return;
  }

  const content = fs.readFileSync(USERS_FILE, "utf8");
  const base64Content = Buffer.from(content).toString("base64");

  try {
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

// ------------------- CONTROL DE INACTIVIDAD -------------------
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

// ------------------- ENDPOINTS PRINCIPALES -------------------
app.get("/", (req, res) => {
  res.json({
    mensaje: "🎥 PeliPREX API funcionando correctamente",
    ejemplo: "/peliculas o /user/get?email=tuemail@gmail.com",
  });
});

// ------------------- ENDPOINTS DE USUARIOS -------------------
app.get("/user/get", (req, res) => {
  const email = (req.query.email || "").toLowerCase();
  res.json(getOrCreateUser(email));
});

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

app.get("/user/clear_history", (req, res) => {
  const email = (req.query.email || "").toLowerCase();
  const user = getOrCreateUser(email);
  user.history = [];
  saveUser(email, user);
  res.json({ ok: true, message: "Historial eliminado." });
});

app.get("/user/remove_favorite", (req, res) => {
  const email = (req.query.email || "").toLowerCase();
  const { pelicula_url } = req.query;
  const user = getOrCreateUser(email);
  user.favorites = user.favorites.filter(f => f.pelicula_url !== pelicula_url);
  saveUser(email, user);
  res.json({ ok: true, message: "Favorito eliminado." });
});

// ------------------- INICIAR SERVIDOR -------------------
const PORT = process.env.PORT || 8080;
restoreFromGitHub().then(() => {
  app.listen(PORT, () =>
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`)
  );
});
