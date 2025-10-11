// index.js — API completa con respaldo TMDb+YouTube + endpoints de usuario (GET)
import express from "express";
import cors from "cors";
import fs from "fs";
import fetch from "node-fetch";
import path from "path";

const app = express();
app.use(cors());

// 🔑 Claves de API
const TMDB_API_KEY = "392ee84e8d4ef03605cc1faa6c40b2a8"; // Tu API key de TMDb
const YOUTUBE_API_KEY = "AIzaSyDoT2sEt2y9a-H55keel8E6xdo3CMIHiG4"; // Tu API key de YouTube

// Rutas de archivos
const PELIS_FILE = path.join(process.cwd(), "peliculas.json");
const USERS_FILE = path.join(process.cwd(), "users_data.json");

// Cargar las películas desde el JSON
let peliculas = [];
try {
  peliculas = JSON.parse(fs.readFileSync(PELIS_FILE, "utf8"));
  console.log(`✅ Cargadas ${peliculas.length} películas desde peliculas.json`);
} catch (err) {
  console.error("❌ Error cargando peliculas.json:", err.message);
  peliculas = [];
}

// --- Utils para usuarios (persistencia local en users_data.json)
function ensureUsersFile() {
  if (!fs.existsSync(USERS_FILE)) {
    const init = { users: {} };
    fs.writeFileSync(USERS_FILE, JSON.stringify(init, null, 2), "utf8");
  }
}
function readUsersData() {
  ensureUsersFile();
  try {
    const raw = fs.readFileSync(USERS_FILE, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    console.error("Error leyendo users_data.json:", err);
    return { users: {} };
  }
}
function writeUsersData(data) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2), "utf8");
}
function getOrCreateUser(email) {
  if (!email) return null;
  const data = readUsersData();
  if (!data.users[email]) {
    // estructura por defecto
    data.users[email] = {
      email,
      tipoPlan: "creditos", // por defecto
      credits: 0,
      favorites: [],
      history: [], // { titulo, pelicula_url, imagen_url, fecha }
      resume: {} // pelicula_url -> { positionSeconds, updatedAt }
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

// --- Control de inactividad (apagar proceso tras 1 minuto sin peticiones)
let ultimaPeticion = Date.now();
const TIEMPO_INACTIVIDAD = 60 * 1000; // 1 minuto
function revisarInactividad() {
  const ahora = Date.now();
  const inactivo = ahora - ultimaPeticion;
  if (inactivo >= TIEMPO_INACTIVIDAD) {
    console.log("🕒 Sin tráfico por 1 minuto. Cerrando servidor para ahorrar recursos...");
    process.exit(0); // Apaga el proceso
  }
}
setInterval(revisarInactividad, 30 * 1000); // Revisa cada 30 segundos

// Middleware que actualiza la última petición
app.use((req, res, next) => {
  ultimaPeticion = Date.now();
  next();
});

// -------------------- RUTAS EXISTENTES --------------------

// 🏠 Ruta principal
app.get("/", (req, res) => {
  res.json({
    mensaje: "🎬 API de Películas funcionando correctamente",
    total: peliculas.length,
    ejemplo: "/peliculas o /peliculas/El%20Padrino",
  });
});

// 📄 Todas las películas
app.get("/peliculas", (req, res) => {
  res.json(peliculas);
});

// 🔍 Buscar película por título (con respaldo)
app.get("/peliculas/:titulo", async (req, res) => {
  const tituloRaw = decodeURIComponent(req.params.titulo || "");
  const titulo = tituloRaw.toLowerCase();
  const resultado = peliculas.filter((p) =>
    (p.titulo || "").toLowerCase().includes(titulo)
  );

  if (resultado.length > 0) {
    return res.json({ fuente: "local", resultados: resultado });
  }

  // Si no existe en tu JSON, buscar en la API de respaldo
  console.log(`🔎 No se encontró "${tituloRaw}" en el JSON. Buscando respaldo...`);
  try {
    const respaldo = await buscarPeliculaRespaldo(tituloRaw);
    if (respaldo) {
      return res.json({ fuente: "respaldo", resultados: [respaldo] });
    } else {
      return res.status(404).json({ error: "Película no encontrada en respaldo." });
    }
  } catch (error) {
    console.error("❌ Error al buscar respaldo:", error);
    return res.status(500).json({ error: "Error al consultar respaldo externo." });
  }
});

// 🔎 Búsqueda avanzada (por año, género, idioma, etc.)
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

// -------------------- RUTAS DE USUARIO (GET) --------------------
// Todas usan "email" como ID único (obtenido por Auth en la app).

// Obtener objeto usuario completo
// GET /user/get?email=correo@ejemplo.com
app.get("/user/get", (req, res) => {
  const email = (req.query.email || "").toLowerCase();
  if (!email) return res.status(400).json({ error: "Falta parámetro email" });
  const user = getOrCreateUser(email);
  res.json(user);
});

// Establecer o actualizar plan del usuario
// GET /user/setplan?email=...&tipoPlan=creditos|ilimitado&credits=100
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

// Agregar favorito
// GET /user/add_favorite?email=...&titulo=...&imagen_url=...&pelicula_url=...
app.get("/user/add_favorite", (req, res) => {
  const email = (req.query.email || "").toLowerCase();
  const { titulo, imagen_url, pelicula_url } = req.query;
  if (!email || !titulo || !pelicula_url) return res.status(400).json({ error: "Faltan parámetros" });

  const user = getOrCreateUser(email);
  // evitar duplicados por pelicula_url
  const exists = user.favorites.find(f => f.pelicula_url === pelicula_url);
  if (!exists) {
    user.favorites.unshift({
      titulo,
      imagen_url: imagen_url || "",
      pelicula_url,
      addedAt: new Date().toISOString()
    });
    saveUser(email, user);
  }
  res.json({ ok: true, favorites: user.favorites });
});

// Quitar favorito
// GET /user/remove_favorite?email=...&pelicula_url=...
app.get("/user/remove_favorite", (req, res) => {
  const email = (req.query.email || "").toLowerCase();
  const pelicula_url = req.query.pelicula_url;
  if (!email || !pelicula_url) return res.status(400).json({ error: "Faltan parámetros" });

  const user = getOrCreateUser(email);
  user.favorites = user.favorites.filter(f => f.pelicula_url !== pelicula_url);
  saveUser(email, user);
  res.json({ ok: true, favorites: user.favorites });
});

// Obtener favoritos
// GET /user/favorites?email=...
app.get("/user/favorites", (req, res) => {
  const email = (req.query.email || "").toLowerCase();
  if (!email) return res.status(400).json({ error: "Falta parámetro email" });
  const user = getOrCreateUser(email);
  res.json({ total: user.favorites.length, favorites: user.favorites });
});

// Agregar a historial (cuando user reproduce una película)
// GET /user/add_history?email=...&titulo=...&pelicula_url=...&imagen_url=...
app.get("/user/add_history", (req, res) => {
  const email = (req.query.email || "").toLowerCase();
  const { titulo, pelicula_url, imagen_url } = req.query;
  if (!email || !titulo || !pelicula_url) return res.status(400).json({ error: "Faltan parámetros" });

  const user = getOrCreateUser(email);
  // Añadir al inicio (más reciente)
  user.history.unshift({
    titulo,
    pelicula_url,
    imagen_url: imagen_url || "",
    fecha: new Date().toISOString()
  });
  // Limitar historial a, por ejemplo, 200 items
  if (user.history.length > 200) user.history = user.history.slice(0, 200);
  saveUser(email, user);
  res.json({ ok: true, total: user.history.length, history: user.history });
});

// Obtener historial
// GET /user/history?email=...
app.get("/user/history", (req, res) => {
  const email = (req.query.email || "").toLowerCase();
  if (!email) return res.status(400).json({ error: "Falta parámetro email" });
  const user = getOrCreateUser(email);
  res.json({ total: user.history.length, history: user.history });
});

// Establecer posición de reanudación (resume)
// GET /user/resume_set?email=...&pelicula_url=...&position=123.5
app.get("/user/resume_set", (req, res) => {
  const email = (req.query.email || "").toLowerCase();
  const pelicula_url = req.query.pelicula_url;
  const position = parseFloat(req.query.position || "0");
  if (!email || !pelicula_url) return res.status(400).json({ error: "Faltan parámetros" });

  const user = getOrCreateUser(email);
  user.resume[pelicula_url] = {
    positionSeconds: position,
    updatedAt: new Date().toISOString()
  };
  saveUser(email, user);
  res.json({ ok: true, resume: user.resume[pelicula_url] });
});

// Obtener posición de reanudación
// GET /user/resume_get?email=...&pelicula_url=...
app.get("/user/resume_get", (req, res) => {
  const email = (req.query.email || "").toLowerCase();
  const pelicula_url = req.query.pelicula_url;
  if (!email || !pelicula_url) return res.status(400).json({ error: "Faltan parámetros" });

  const user = getOrCreateUser(email);
  const v = user.resume[pelicula_url] || null;
  res.json({ resume: v });
});

// Limpiar historial
// GET /user/clear_history?email=...
app.get("/user/clear_history", (req, res) => {
  const email = (req.query.email || "").toLowerCase();
  if (!email) return res.status(400).json({ error: "Falta parámetro email" });
  const user = getOrCreateUser(email);
  user.history = [];
  saveUser(email, user);
  res.json({ ok: true });
});

// Limpiar favoritos
// GET /user/clear_favorites?email=...
app.get("/user/clear_favorites", (req, res) => {
  const email = (req.query.email || "").toLowerCase();
  if (!email) return res.status(400).json({ error: "Falta parámetro email" });
  const user = getOrCreateUser(email);
  user.favorites = [];
  saveUser(email, user);
  res.json({ ok: true });
});

// -------------------- BACKUP: TMDb + YouTube --------------------
async function buscarPeliculaRespaldo(titulo) {
  // Buscar película en TMDb
  const url = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&language=es-ES&query=${encodeURIComponent(
    titulo
  )}`;
  const resp = await fetch(url);
  const data = await resp.json();

  if (!data.results || data.results.length === 0) {
    console.log("❌ No se encontró en TMDb.");
    return null;
  }

  const pelicula = data.results[0];
  const detallesUrl = `https://api.themoviedb.org/3/movie/${pelicula.id}?api_key=${TMDB_API_KEY}&language=es-ES`;
  const detallesResp = await fetch(detallesUrl);
  const detalles = await detallesResp.json();

  // Buscar película completa en YouTube
  const youtubeUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(
    pelicula.title + " película completa"
  )}&key=${YOUTUBE_API_KEY}&type=video&maxResults=1`;
  const youtubeResp = await fetch(youtubeUrl);
  const youtubeData = await youtubeResp.json();
  const youtubeId =
    youtubeData.items && youtubeData.items.length > 0
      ? youtubeData.items[0].id.videoId
      : null;

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

// 🌍 Iniciar servidor
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`✅ Servidor corriendo en http://localhost:${PORT}`);
});
