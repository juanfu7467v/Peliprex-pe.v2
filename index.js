// index.js — API completa de Películas con respaldo TMDb + YouTube + sistema de usuarios

import express from "express";
import cors from "cors";
import fs from "fs";
import fetch from "node-fetch"; // ✅ importante: instalada en package.json
import path from "path";

const app = express();
app.use(cors());

// 🔑 Claves de API
const TMDB_API_KEY = "392ee84e8d4ef03605cc1faa6c40b2a8"; // API key de TMDb
const YOUTUBE_API_KEY = "AIzaSyDoT2sEt2y9a-H55keel8E6xdo3CMIHiG4"; // API key de YouTube

// 📂 Rutas de archivos locales
const PELIS_FILE = path.join(process.cwd(), "peliculas.json");
const USERS_FILE = path.join(process.cwd(), "users_data.json");

// Cargar las películas
let peliculas = [];
try {
  peliculas = JSON.parse(fs.readFileSync(PELIS_FILE, "utf8"));
  console.log(`✅ Cargadas ${peliculas.length} películas desde peliculas.json`);
} catch (err) {
  console.error("❌ Error cargando peliculas.json:", err.message);
  peliculas = [];
}

// ---------------- UTILIDADES DE USUARIO ----------------
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
}
function getOrCreateUser(email) {
  if (!email) return null;
  const data = readUsersData();
  if (!data.users[email]) {
    data.users[email] = {
      email,
      tipoPlan: "creditos",
      credits: 0,
      favorites: [],
      history: [],
      resume: {}
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

// ---------------- CONTROL DE INACTIVIDAD ----------------
let ultimaPeticion = Date.now();
const TIEMPO_INACTIVIDAD = 60 * 1000; // 1 minuto

setInterval(() => {
  if (Date.now() - ultimaPeticion >= TIEMPO_INACTIVIDAD) {
    console.log("🕒 Sin tráfico por 1 minuto. Cerrando servidor...");
    process.exit(0);
  }
}, 30 * 1000);

app.use((req, res, next) => {
  ultimaPeticion = Date.now();
  next();
});

// ---------------- RUTAS PRINCIPALES ----------------

// 🏠 Estado general
app.get("/", (req, res) => {
  res.json({
    mensaje: "🎬 API de Películas funcionando correctamente",
    total: peliculas.length,
    ejemplo: "/peliculas o /peliculas/El%20Padrino",
  });
});

// 📄 Listar todas
app.get("/peliculas", (req, res) => {
  res.json(peliculas);
});

// 🔍 Buscar por título (local + respaldo)
app.get("/peliculas/:titulo", async (req, res) => {
  const tituloRaw = decodeURIComponent(req.params.titulo || "");
  const titulo = tituloRaw.toLowerCase();
  const resultado = peliculas.filter((p) =>
    (p.titulo || "").toLowerCase().includes(titulo)
  );

  if (resultado.length > 0) {
    return res.json({ fuente: "local", resultados: resultado });
  }

  console.log(`🔎 No se encontró "${tituloRaw}" en el JSON. Buscando respaldo...`);
  try {
    const respaldo = await buscarPeliculaRespaldo(tituloRaw);
    if (respaldo) return res.json({ fuente: "respaldo", resultados: [respaldo] });
    else return res.status(404).json({ error: "Película no encontrada en respaldo." });
  } catch (error) {
    console.error("❌ Error al buscar respaldo:", error);
    res.status(500).json({ error: "Error al consultar respaldo externo." });
  }
});

// 🔎 Búsqueda avanzada
app.get("/buscar", (req, res) => {
  const { año, genero, idioma, desde, hasta, q } = req.query;
  let resultados = peliculas;

  if (q) {
    const ql = q.toLowerCase();
    resultados = resultados.filter(p =>
      (p.titulo || "").toLowerCase().includes(ql) ||
      (p.descripcion || "").toLowerCase().includes(ql)
    );
  }

  if (año) resultados = resultados.filter((p) => String(p.año) === String(año));
  if (genero)
    resultados = resultados.filter((p) =>
      (p.generos || "").toLowerCase().includes(String(genero).toLowerCase())
    );
  if (idioma)
    resultados = resultados.filter(
      (p) => (p.idioma_original || "").toLowerCase() === String(idioma).toLowerCase()
    );
  if (desde && hasta)
    resultados = resultados.filter(
      (p) => parseInt(p.año) >= parseInt(desde) && parseInt(p.año) <= parseInt(hasta)
    );

  res.json({
    total: resultados.length,
    resultados,
  });
});

// ---------------- RUTAS DE USUARIOS ----------------

// Obtener usuario completo
app.get("/user/get", (req, res) => {
  const email = (req.query.email || "").toLowerCase();
  if (!email) return res.status(400).json({ error: "Falta parámetro email" });
  res.json(getOrCreateUser(email));
});

// Establecer plan
app.get("/user/setplan", (req, res) => {
  const email = (req.query.email || "").toLowerCase();
  const tipoPlan = req.query.tipoPlan;
  const credits = req.query.credits ? parseInt(req.query.credits) : undefined;
  if (!email || !tipoPlan) return res.status(400).json({ error: "Falta email o tipoPlan" });

  const user = getOrCreateUser(email);
  user.tipoPlan = tipoPlan;
  if (typeof credits === "number") user.credits = credits;
  saveUser(email, user);
  res.json({ ok: true, user });
});

// Favoritos
app.get("/user/add_favorite", (req, res) => {
  const email = (req.query.email || "").toLowerCase();
  const { titulo, imagen_url, pelicula_url } = req.query;
  if (!email || !titulo || !pelicula_url) return res.status(400).json({ error: "Faltan parámetros" });

  const user = getOrCreateUser(email);
  if (!user.favorites.some(f => f.pelicula_url === pelicula_url)) {
    user.favorites.unshift({ titulo, imagen_url, pelicula_url, addedAt: new Date().toISOString() });
    saveUser(email, user);
  }
  res.json({ ok: true, favorites: user.favorites });
});

app.get("/user/favorites", (req, res) => {
  const email = (req.query.email || "").toLowerCase();
  if (!email) return res.status(400).json({ error: "Falta email" });
  const user = getOrCreateUser(email);
  res.json({ total: user.favorites.length, favorites: user.favorites });
});

// Historial
app.get("/user/add_history", (req, res) => {
  const email = (req.query.email || "").toLowerCase();
  const { titulo, pelicula_url, imagen_url } = req.query;
  if (!email || !titulo || !pelicula_url) return res.status(400).json({ error: "Faltan parámetros" });

  const user = getOrCreateUser(email);
  user.history.unshift({ titulo, pelicula_url, imagen_url, fecha: new Date().toISOString() });
  if (user.history.length > 200) user.history = user.history.slice(0, 200);
  saveUser(email, user);
  res.json({ ok: true, total: user.history.length });
});

app.get("/user/history", (req, res) => {
  const email = (req.query.email || "").toLowerCase();
  if (!email) return res.status(400).json({ error: "Falta email" });
  const user = getOrCreateUser(email);
  res.json({ total: user.history.length, history: user.history });
});

// ---------------- FUNCIONES DE RESPALDO ----------------
async function buscarPeliculaRespaldo(titulo) {
  const url = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&language=es-ES&query=${encodeURIComponent(titulo)}`;
  const resp = await fetch(url);
  const data = await resp.json();

  if (!data.results || data.results.length === 0) return null;

  const pelicula = data.results[0];
  const detallesUrl = `https://api.themoviedb.org/3/movie/${pelicula.id}?api_key=${TMDB_API_KEY}&language=es-ES`;
  const detallesResp = await fetch(detallesUrl);
  const detalles = await detallesResp.json();

  const youtubeUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(pelicula.title + " película completa")}&key=${YOUTUBE_API_KEY}&type=video&maxResults=1`;
  const youtubeResp = await fetch(youtubeUrl);
  const youtubeData = await youtubeResp.json();
  const youtubeId = youtubeData.items?.[0]?.id?.videoId || null;

  return {
    titulo: pelicula.title,
    descripcion: pelicula.overview || "",
    fecha_lanzamiento: pelicula.release_date || "",
    idioma_original: pelicula.original_language || "",
    puntuacion: pelicula.vote_average || 0,
    popularidad: pelicula.popularity || 0,
    generos: detalles.genres?.map((g) => g.name).join(", ") || "",
    imagen_url: pelicula.poster_path ? `https://image.tmdb.org/t/p/w500${pelicula.poster_path}` : "",
    pelicula_url: youtubeId ? `https://www.youtube.com/watch?v=${youtubeId}` : null,
    respaldo: true,
  };
}

// 🚀 Iniciar servidor
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`✅ Servidor corriendo en http://localhost:${PORT}`));
