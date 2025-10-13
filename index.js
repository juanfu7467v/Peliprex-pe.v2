// index.js — Peliprex API v2 con respaldo GitHub + TMDb + YouTube + Sistema de usuarios
// Autor: José (PeliPREX Developer)

import express from "express";
import cors from "cors";
import fs from "fs";
import fetch from "node-fetch";
import path from "path";

const app = express();
app.use(cors());

// 🧩 Variables de entorno para respaldo en GitHub
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO; // ej. JoseDeveloper/peliprex-data

// 🔑 Claves de API
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

    // Verificar si ya existe el archivo para obtener su SHA
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

// ------------------- CARGAR PELÍCULAS -------------------
let peliculas = [];
try {
  peliculas = JSON.parse(fs.readFileSync(PELIS_FILE, "utf8"));
  console.log(`🎬 Cargadas ${peliculas.length} películas desde peliculas.json`);
} catch (err) {
  console.error("❌ Error cargando peliculas.json:", err.message);
  peliculas = [];
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
    total: peliculas.length,
    ejemplo: "/peliculas o /user/get?email=tuemail@gmail.com",
  });
});

app.get("/peliculas", (req, res) => res.json(peliculas));

// 🔍 Buscar película local o respaldo TMDb
app.get("/peliculas/:titulo", async (req, res) => {
  const titulo = decodeURIComponent(req.params.titulo || "").toLowerCase();
  const resultado = peliculas.filter(p =>
    (p.titulo || "").toLowerCase().includes(titulo)
  );

  if (resultado.length > 0)
    return res.json({ fuente: "local", resultados: resultado });

  const respaldo = await buscarPeliculaRespaldo(titulo);
  if (respaldo) return res.json({ fuente: "respaldo", resultados: [respaldo] });

  res.status(404).json({ error: "No se encontró la película." });
});

// ------------------- ENDPOINTS DE USUARIOS -------------------
app.get("/user/get", (req, res) => {
  const email = (req.query.email || "").toLowerCase();
  res.json(getOrCreateUser(email));
});

app.get("/user/setplan", (req, res) => {
  const email = (req.query.email || "").toLowerCase();
  const tipoPlan = req.query.tipoPlan || "creditos";
  const user = getOrCreateUser(email);
  user.tipoPlan = tipoPlan;
  saveUser(email, user);
  res.json({ ok: true, user });
});

// ⭐ Favoritos
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

app.get("/user/favorites", (req, res) => {
  const email = (req.query.email || "").toLowerCase();
  const user = getOrCreateUser(email);
  res.json({ total: user.favorites.length, favorites: user.favorites });
});

// 🎞️ Historial
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

app.get("/user/history", (req, res) => {
  const email = (req.query.email || "").toLowerCase();
  const user = getOrCreateUser(email);
  res.json({ total: user.history.length, history: user.history });
});

// 📈 Perfil con estadísticas
app.get("/user/profile", (req, res) => {
  const email = (req.query.email || "").toLowerCase();
  const user = getOrCreateUser(email);
  const perfil = {
    email: user.email,
    tipoPlan: user.tipoPlan,
    credits: user.credits,
    totalFavoritos: user.favorites.length,
    totalHistorial: user.history.length,
    vistasTotales: user.stats.vistasTotales,
    favoritasTotales: user.stats.favoritasTotales,
    ultimaActividad:
      user.history[0]?.fecha || user.favorites[0]?.addedAt || "Sin actividad",
  };
  res.json({ perfil });
});

// 🔁 Refrescar datos
app.get("/user/favorites/refresh", async (req, res) => {
  const email = (req.query.email || "").toLowerCase();
  const user = getOrCreateUser(email);
  const refreshed = [];
  for (const f of user.favorites) {
    const nueva = await buscarPeliculaRespaldo(f.titulo);
    if (nueva) refreshed.push(nueva);
  }
  user.favorites = refreshed;
  saveUser(email, user);
  res.json({ ok: true, refreshed });
});

// ------------------- TMDb + YOUTUBE -------------------
async function buscarPeliculaRespaldo(titulo) {
  try {
    const tmdbUrl = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&language=es-ES&query=${encodeURIComponent(
      titulo
    )}`;
    const resp = await fetch(tmdbUrl);
    const data = await resp.json();
    if (!data.results || data.results.length === 0) return null;

    const peli = data.results[0];
    const detallesUrl = `https://api.themoviedb.org/3/movie/${peli.id}?api_key=${TMDB_API_KEY}&language=es-ES`;
    const detalles = await (await fetch(detallesUrl)).json();

    const ytUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(
      peli.title + " película completa"
    )}&key=${YOUTUBE_API_KEY}&type=video&maxResults=1`;
    const ytData = await (await fetch(ytUrl)).json();
    const youtubeId = ytData.items?.[0]?.id?.videoId || null;

    return {
      titulo: peli.title,
      descripcion: peli.overview || "",
      fecha_lanzamiento: peli.release_date || "",
      idioma_original: peli.original_language || "",
      puntuacion: peli.vote_average || 0,
      generos: detalles.genres?.map(g => g.name).join(", ") || "",
      imagen_url: peli.poster_path
        ? `https://image.tmdb.org/t/p/w500${peli.poster_path}`
        : "",
      pelicula_url: youtubeId ? `https://www.youtube.com/watch?v=${youtubeId}` : null,
      respaldo: true,
    };
  } catch (err) {
    console.error("❌ Error TMDb:", err.message);
    return null;
  }
}

// ------------------- INICIAR SERVIDOR -------------------
const PORT = process.env.PORT || 8080;
app.listen(PORT, () =>
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`)
);
