import express from "express";
import cors from "cors";
import fs from "fs";
import fetch from "node-fetch";
import path from "path";
import { Worker, isMainThread, parentPort, workerData } from "worker_threads";

const app = express();
app.use(cors());
app.use(express.json()); // ← necesario para leer body en POST

// ===================================================================
// ⚙️  CONFIGURACIÓN GENERAL
// ===================================================================
const GITHUB_TOKEN          = process.env.GITHUB_TOKEN;
const GITHUB_REPO           = process.env.GITHUB_REPO;
const BACKUP_FILE_NAME      = "users_data.json";
const PELIS_FILE            = path.join(process.cwd(), "peliculas.json");
const USERS_FILE            = path.join(process.cwd(), BACKUP_FILE_NAME);
const MS_IN_24_HOURS        = 24 * 60 * 60 * 1000;
const IS_COMPLETE_THRESHOLD = 90;   // % para considerar vista completa
const MAX_HISTORY           = 200;  // máx registros de historial
const MAX_SEARCHES          = 100;  // máx búsquedas guardadas

// ─── Variables de entorno Firestore (disponibles pero no se instancia SDK) ───
// Las variables FIREBASE_* están en process.env y se exportan vía /api/firebase-config
// El SDK de Firebase se usa sólo en el cliente (HTML); aquí sólo las exponemos.

// ===================================================================
// 🔑  SISTEMA DE API KEYS (identidad de usuario)
// ===================================================================
/**
 * Cada API Key mapea a un email de usuario.
 * Se almacena dentro del propio users_data.json para persistencia.
 *   users_data.json → { users: {...}, apiKeys: { "KEY": "email" } }
 */
function readApiKeys() {
  const data = readUsersData();
  return data.apiKeys || {};
}
function resolveEmailFromApiKey(apiKey) {
  if (!apiKey) return null;
  const keys = readApiKeys();
  return keys[apiKey] || null;
}

// ===================================================================
// 🛡️  MIDDLEWARE DE AUTENTICACIÓN
// ===================================================================
/**
 * Valida x-api-key en el header.
 * Añade req.userEmail y req.apiKey a la request.
 * Si no es válida → 401.
 */
function authMiddleware(req, res, next) {
  const apiKey = req.headers["x-api-key"] || req.body?.apiKey || null;
  if (!apiKey) {
    return res.status(401).json({ error: "No autorizado. Incluye x-api-key en el header." });
  }
  const email = resolveEmailFromApiKey(apiKey);
  if (!email) {
    return res.status(403).json({ error: "API Key inválida o no registrada." });
  }
  req.userEmail = email;
  req.apiKey    = apiKey;
  next();
}

// ===================================================================
// 🧵  PROCESAMIENTO EN SEGUNDO PLANO (cola asíncrona)
// ===================================================================
const backgroundQueue = [];
let processingQueue = false;

async function processQueue() {
  if (processingQueue || backgroundQueue.length === 0) return;
  processingQueue = true;
  while (backgroundQueue.length > 0) {
    const task = backgroundQueue.shift();
    try { await task(); } catch (e) { console.error("❌ Error en tarea background:", e.message); }
  }
  processingQueue = false;
}

function enqueueBackground(fn) {
  backgroundQueue.push(fn);
  setImmediate(processQueue); // no bloquea
}

// ===================================================================
// 🔧  UTILIDADES
// ===================================================================
function cleanPeliculaUrl(url) {
  if (!url) return url;
  return url.replace(/\/prepreview([?#]|$)/, "/preview$1");
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// ===================================================================
// 📂  GITHUB BACKUP
// ===================================================================
async function getFileSha(filePath) {
  if (!GITHUB_TOKEN || !GITHUB_REPO) return null;
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${filePath}`;
  try {
    const resp = await fetch(url, {
      headers: { Authorization: `token ${GITHUB_TOKEN}`, Accept: "application/vnd.github.v3+json" },
    });
    if (resp.status === 404) return null;
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.sha;
  } catch { return null; }
}

async function saveUsersDataToGitHub(content) {
  if (!GITHUB_TOKEN || !GITHUB_REPO) return false;
  try {
    const sha = await getFileSha(BACKUP_FILE_NAME);
    const contentBase64 = Buffer.from(content).toString("base64");
    const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${BACKUP_FILE_NAME}`;
    const body = { message: `Backup ${new Date().toISOString()}`, content: contentBase64 };
    if (sha) body.sha = sha;
    const resp = await fetch(url, {
      method: "PUT",
      headers: { Authorization: `token ${GITHUB_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return resp.ok;
  } catch { return false; }
}

async function loadUsersDataFromGitHub() {
  if (!GITHUB_TOKEN || !GITHUB_REPO) return false;
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${BACKUP_FILE_NAME}`;
  try {
    const resp = await fetch(url, {
      headers: { Authorization: `token ${GITHUB_TOKEN}`, Accept: "application/vnd.github.v3.raw" },
    });
    if (resp.status === 404) return false;
    if (!resp.ok) return false;
    const content = await resp.text();
    fs.writeFileSync(USERS_FILE, content, "utf8");
    console.log("✅ Datos restaurados desde GitHub.");
    return true;
  } catch { return false; }
}

// ===================================================================
// 📦  GESTIÓN DE USUARIOS (local + GitHub)
// ===================================================================
function ensureUsersFile() {
  if (!fs.existsSync(USERS_FILE)) {
    const initialData = JSON.stringify({ users: {}, apiKeys: {} }, null, 2);
    fs.writeFileSync(USERS_FILE, initialData);
    enqueueBackground(() => saveUsersDataToGitHub(initialData));
  }
}

function readUsersData() {
  ensureUsersFile();
  return JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
}

function writeUsersData(data) {
  const content = JSON.stringify(data, null, 2);
  fs.writeFileSync(USERS_FILE, content);
  // Backup en segundo plano
  enqueueBackground(() => saveUsersDataToGitHub(content));
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
      searches: [],
      resume: {},
      preferences: { genres: [], languages: [] },
      lastActivityTimestamp: new Date().toISOString(),
    };
    writeUsersData(data);
  }
  const u = data.users[email];
  // Migrar campos faltantes en usuarios antiguos
  if (!u.resume)       u.resume = {};
  if (!u.searches)     u.searches = [];
  if (!u.preferences)  u.preferences = { genres: [], languages: [] };
  if (!u.lastActivityTimestamp) u.lastActivityTimestamp = new Date().toISOString();
  return u;
}

function saveUser(email, userObj) {
  const data = readUsersData();
  data.users[email] = userObj;
  writeUsersData(data);
}

// ===================================================================
// 🧠  MOTOR DE RECOMENDACIONES
// ===================================================================
/**
 * Calcula géneros y keywords preferidas a partir del historial y búsquedas.
 * Devuelve un objeto { topGenres, topKeywords }
 */
function analyzePreferences(user, allMovies) {
  const genreCount = {};
  const keywordCount = {};

  // Ponderar historial (peso 3)
  for (const h of user.history) {
    const movie = allMovies.find(m => m.pelicula_url === h.pelicula_url || m.titulo === h.titulo);
    if (movie && movie.generos) {
      const genres = movie.generos.toLowerCase().split(/[,|\/]/).map(g => g.trim());
      genres.forEach(g => { if (g) genreCount[g] = (genreCount[g] || 0) + 3; });
    }
  }

  // Ponderar favoritos (peso 5)
  for (const f of user.favorites) {
    const movie = allMovies.find(m => m.pelicula_url === f.pelicula_url || m.titulo === f.titulo);
    if (movie && movie.generos) {
      const genres = movie.generos.toLowerCase().split(/[,|\/]/).map(g => g.trim());
      genres.forEach(g => { if (g) genreCount[g] = (genreCount[g] || 0) + 5; });
    }
  }

  // Ponderar búsquedas (peso 1)
  for (const s of user.searches) {
    const q = (s.query || "").toLowerCase().split(" ");
    q.forEach(kw => { if (kw.length > 2) keywordCount[kw] = (keywordCount[kw] || 0) + 1; });
  }

  // Actualizar preferencias en el usuario
  const topGenres = Object.entries(genreCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(e => e[0]);
  const topKeywords = Object.entries(keywordCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(e => e[0]);

  return { topGenres, topKeywords, genreCount };
}

/**
 * Genera recomendaciones personalizadas para un usuario.
 */
function generateRecommendations(user, allMovies, limit = 30) {
  if (!allMovies || allMovies.length === 0) return [];

  const watchedUrls = new Set([
    ...user.history.map(h => h.pelicula_url),
    ...user.favorites.map(f => f.pelicula_url),
  ]);

  const { topGenres, topKeywords, genreCount } = analyzePreferences(user, allMovies);

  // Score a cada película
  const scored = allMovies
    .filter(m => !watchedUrls.has(m.pelicula_url)) // no vistas aún
    .map(movie => {
      let score = 0;
      const movieGenres = (movie.generos || "").toLowerCase().split(/[,|\/]/).map(g => g.trim());
      const movieTitle  = (movie.titulo || "").toLowerCase();
      const movieDesc   = (movie.descripcion || "").toLowerCase();

      // Coincidencia de géneros
      movieGenres.forEach(g => {
        if (genreCount[g]) score += genreCount[g];
      });

      // Coincidencia de keywords
      topKeywords.forEach(kw => {
        if (movieTitle.includes(kw) || movieDesc.includes(kw)) score += 2;
      });

      // Pequeño factor aleatorio para variedad
      score += Math.random() * 0.5;

      return { movie, score };
    })
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map(s => s.movie);
}

/**
 * Películas similares a una dada (por géneros y descripción).
 */
function getSimilarMovies(targetMovie, allMovies, limit = 20) {
  if (!targetMovie) return [];
  const targetGenres = new Set(
    (targetMovie.generos || "").toLowerCase().split(/[,|\/]/).map(g => g.trim()).filter(Boolean)
  );
  const targetWords = new Set(
    (targetMovie.descripcion || "").toLowerCase().split(/\W+/).filter(w => w.length > 3)
  );

  return allMovies
    .filter(m => m.pelicula_url !== targetMovie.pelicula_url)
    .map(movie => {
      let score = 0;
      const movieGenres = (movie.generos || "").toLowerCase().split(/[,|\/]/).map(g => g.trim());
      movieGenres.forEach(g => { if (targetGenres.has(g)) score += 3; });

      const movieWords = (movie.descripcion || "").toLowerCase().split(/\W+/);
      movieWords.forEach(w => { if (targetWords.has(w)) score += 0.5; });

      return { movie, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => s.movie);
}

/**
 * Tendencias: películas más vistas globalmente (basado en historial de todos).
 */
function getTrendingMovies(allUsers, allMovies, limit = 30) {
  const viewCount = {};
  for (const email in allUsers) {
    const user = allUsers[email];
    (user.history || []).forEach(h => {
      viewCount[h.pelicula_url] = (viewCount[h.pelicula_url] || 0) + 1;
    });
  }
  return allMovies
    .map(m => ({ movie: m, views: viewCount[m.pelicula_url] || 0 }))
    .sort((a, b) => b.views - a.views || Math.random() - 0.5)
    .slice(0, limit)
    .map(s => s.movie);
}

// ===================================================================
// 🎬  CARGA DE PELÍCULAS
// ===================================================================
let peliculas = [];
try {
  peliculas = JSON.parse(fs.readFileSync(PELIS_FILE, "utf8"));
  console.log(`✅ Cargadas ${peliculas.length} películas locales.`);
} catch (err) {
  console.error("❌ Error cargando peliculas.json:", err.message);
}

// ===================================================================
// 🌐  FUENTE EXTERNA (peliprex.fly.dev)
// ===================================================================
async function fetchExternalPeliculas() {
  try {
    const resp = await fetch("https://peliprex.fly.dev/catalog");
    if (!resp.ok) return [];
    const data = await resp.json();
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}

async function fetchExternalSearch(params = {}) {
  try {
    const url = new URL("https://peliprex.fly.dev/search");
    if (params.q)        url.searchParams.append("q",        params.q);
    if (params.genre)    url.searchParams.append("genre",    params.genre);
    if (params.year)     url.searchParams.append("year",     params.year);
    if (params.desde)    url.searchParams.append("desde",    params.desde);
    if (params.hasta)    url.searchParams.append("hasta",    params.hasta);
    if (params.language) url.searchParams.append("language", params.language);
    const resp = await fetch(url.toString());
    if (!resp.ok) return [];
    const data = await resp.json();
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}

function combinarResultados(externos, locales) {
  const urlsExternas = new Set(externos.map(p => p.pelicula_url));
  const localesUnicos = locales.filter(p => !urlsExternas.has(p.pelicula_url));
  return [...externos, ...localesUnicos];
}

// ===================================================================
// ⏱️  CONTROL DE INACTIVIDAD + TAREA LIMPIEZA 24H
// ===================================================================
let ultimaPeticion = Date.now();

app.use((req, res, next) => {
  ultimaPeticion = Date.now();
  next();
});

setInterval(async () => {
  if (Date.now() - ultimaPeticion >= 60_000) {
    console.log("🕒 Sin tráfico. Guardando y cerrando...");
    const data = readUsersData();
    await saveUsersDataToGitHub(JSON.stringify(data, null, 2));
    process.exit(0);
  }
}, 30_000);

setInterval(() => {
  const data = readUsersData();
  let modified = false;
  const now = Date.now();
  for (const email in data.users) {
    const user = data.users[email];
    const prevH = user.history.length;
    user.history = user.history.filter(h => now - new Date(h.fecha).getTime() < MS_IN_24_HOURS);
    const newResume = {};
    for (const url in user.resume) {
      if (now - new Date(user.resume[url].lastHeartbeat).getTime() < MS_IN_24_HOURS)
        newResume[url] = user.resume[url];
    }
    user.resume = newResume;
    if (user.history.length !== prevH || Object.keys(newResume).length !== Object.keys(user.resume).length)
      modified = true;
  }
  if (modified) writeUsersData(data);
}, MS_IN_24_HOURS);

// ===================================================================
// 🏠  RUTAS PÚBLICAS (sin autenticación)
// ===================================================================

// Raíz informativa
app.get("/", (req, res) => {
  res.json({
    mensaje: "🎬 PeliPREX API v2 - Sistema inteligente de películas",
    version: "2.0",
    auth: "Se requiere x-api-key en el header para endpoints de usuario y recomendaciones",
    endpoints_publicos: ["/peliculas", "/peliculas/:titulo", "/buscar", "/peliculas/categoria/:genero", "/api/config", "/api/analyze", "/api/firebase-config"],
    endpoints_privados: ["/user/*", "/recommendations", "/history", "/favorites", "/continue_watching", "/trending", "/similar", "/user/preferences"],
    nota: "Los endpoints privados requieren POST + header x-api-key"
  });
});

// ── Configuración del frontend ──────────────────────────────────────
app.get("/api/config", (req, res) => {
  res.json({
    peliprexBaseUrl: process.env.PELIPREX_BASE_URL || "",
    geminiApiKey:    process.env.GEMINI_API_KEY    || "",
  });
});

// ── Configuración Firebase (para el cliente) ──────────────────────
app.get("/api/firebase-config", (req, res) => {
  res.json({
    apiKey:            process.env.FIREBASE_API_KEY             || "",
    authDomain:        process.env.FIREBASE_AUTH_DOMAIN         || "",
    projectId:         process.env.FIREBASE_PROJECT_ID         || "",
    storageBucket:     process.env.FIREBASE_STORAGE_BUCKET      || "",
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || "",
    appId:             process.env.FIREBASE_APP_ID              || "",
  });
});

// ── Análisis con Gemini (proxy) ────────────────────────────────────
app.post("/api/analyze", async (req, res) => {
  const { movieTitle, movieDescription } = req.body;
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
  if (!GEMINI_API_KEY) return res.status(500).json({ error: "GEMINI_API_KEY no configurada." });
  try {
    const geminiUrl = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
    const prompt = `Eres un crítico de cine experto. Analiza la siguiente película y proporciona un análisis detallado.
Título: ${movieTitle}
Descripción: ${movieDescription}
Por favor incluye: Sinopsis, Trama, Aspectos Destacados, Dirección, Música, Actuaciones y Veredicto.`;
    const response = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });
    const data = await response.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===================================================================
// 🎬  CATÁLOGO (GET – compatibilidad con frontend existente)
// ===================================================================
app.get("/peliculas", async (req, res) => {
  try {
    const [externas, locales] = await Promise.all([fetchExternalPeliculas(), Promise.resolve(peliculas)]);
    res.json(combinarResultados(externas, locales));
  } catch { res.json(peliculas); }
});

app.get("/peliculas/:titulo", (req, res) => {
  const titulo = decodeURIComponent(req.params.titulo || "").toLowerCase();
  const resultados = peliculas.filter(p => (p.titulo || "").toLowerCase().includes(titulo));
  if (resultados.length > 0) return res.json({ fuente: "local", resultados });
  return res.json({ fuente: "local", total: 0, resultados: [], error: "No encontrada." });
});

app.get("/peliculas/categoria/:genero", async (req, res) => {
  const generoRaw = decodeURIComponent(req.params.genero || "");
  const generoBuscado = generoRaw.toLowerCase();
  try {
    const [externos, locales] = await Promise.all([
      fetchExternalSearch({ genre: generoBuscado }),
      Promise.resolve(peliculas.filter(p => (p.generos || "").toLowerCase().includes(generoBuscado))),
    ]);
    if (externos.length > 0) {
      const combinados = combinarResultados(externos, locales);
      return res.json({ fuente: "combinada", total: combinados.length, resultados: shuffleArray(combinados) });
    }
    if (locales.length > 0)
      return res.json({ fuente: "local", total: locales.length, resultados: shuffleArray(locales) });
    return res.json({ fuente: "local", total: 0, resultados: [], error: "Categoría no encontrada." });
  } catch {
    const locales = peliculas.filter(p => (p.generos || "").toLowerCase().includes(generoBuscado));
    return res.json({ fuente: "local", total: locales.length, resultados: shuffleArray(locales) });
  }
});

app.get("/buscar", async (req, res) => {
  const { año, genero, idioma, desde, hasta, q } = req.query;
  const paramsExternos = {};
  if (q)      paramsExternos.q        = q;
  if (genero) paramsExternos.genre    = genero;
  if (año)    paramsExternos.year     = año;
  if (desde)  paramsExternos.desde   = desde;
  if (hasta)  paramsExternos.hasta   = hasta;
  if (idioma) paramsExternos.language = idioma;

  const filtroLocal = p => {
    let cumple = true;
    if (q)      cumple = cumple && ((p.titulo||"").toLowerCase().includes(q.toLowerCase()) || (p.descripcion||"").toLowerCase().includes(q.toLowerCase()));
    if (año)    cumple = cumple && String(p.año) === String(año);
    if (genero) cumple = cumple && (p.generos||"").toLowerCase().includes(genero.toLowerCase());
    if (idioma) cumple = cumple && (p.idioma_original||"").toLowerCase() === idioma.toLowerCase();
    if (desde && hasta) cumple = cumple && parseInt(p.año) >= parseInt(desde) && parseInt(p.año) <= parseInt(hasta);
    return cumple;
  };

  try {
    const [externos, locales] = await Promise.all([
      Object.keys(paramsExternos).length > 0 ? fetchExternalSearch(paramsExternos) : Promise.resolve([]),
      Promise.resolve(peliculas.filter(filtroLocal)),
    ]);
    if (externos.length > 0) {
      const combinados = combinarResultados(externos, locales);
      return res.json({ fuente: "combinada", total: combinados.length, resultados: combinados });
    }
    if (locales.length > 0)
      return res.json({ fuente: "local", total: locales.length, resultados: locales });
    return res.json({ fuente: "local", total: 0, resultados: [], error: "Sin resultados." });
  } catch {
    const locales = peliculas.filter(filtroLocal);
    return res.json({ fuente: "local", total: locales.length, resultados: locales });
  }
});

// ===================================================================
// 👤  RUTAS DE USUARIO (todas POST + authMiddleware)
// ===================================================================

// ── GET de usuario ──────────────────────────────────────────────────
app.post("/user/get", authMiddleware, (req, res) => {
  res.json(getOrCreateUser(req.userEmail));
});

// ── Cambiar plan ────────────────────────────────────────────────────
app.post("/user/setplan", authMiddleware, (req, res) => {
  const { tipoPlan, credits } = req.body;
  if (!tipoPlan) return res.status(400).json({ error: "Falta tipoPlan" });
  const user = getOrCreateUser(req.userEmail);
  user.tipoPlan = tipoPlan;
  if (typeof credits === "number") user.credits = credits;
  saveUser(req.userEmail, user);
  res.json({ ok: true, user });
});

// ===================================================================
// ⭐  FAVORITOS  (POST)
// ===================================================================
app.post("/user/add_favorite", authMiddleware, (req, res) => {
  const { titulo, imagen_url, pelicula_url: raw } = req.body;
  const pelicula_url = cleanPeliculaUrl(raw);
  if (!titulo || !pelicula_url) return res.status(400).json({ error: "Faltan parámetros." });

  const user = getOrCreateUser(req.userEmail);
  if (!user.favorites.some(f => f.pelicula_url === pelicula_url)) {
    user.favorites.unshift({ titulo, imagen_url, pelicula_url, addedAt: new Date().toISOString() });
    enqueueBackground(() => { saveUser(req.userEmail, user); });
  }
  res.json({ ok: true, favorites: user.favorites });
});

app.post("/user/favorites", authMiddleware, (req, res) => {
  const user = getOrCreateUser(req.userEmail);
  res.json({ total: user.favorites.length, favorites: user.favorites });
});

// Alias GET para compatibilidad HTML (sin auth, con email en query)
app.get("/user/favorites", (req, res) => {
  const email = (req.query.email || "").toLowerCase();
  if (!email) return res.status(400).json({ error: "Falta email" });
  const user = getOrCreateUser(email);
  res.json({ total: user.favorites.length, favorites: user.favorites });
});

app.post("/user/favorites/clear", authMiddleware, (req, res) => {
  const user = getOrCreateUser(req.userEmail);
  user.favorites = [];
  enqueueBackground(() => saveUser(req.userEmail, user));
  res.json({ ok: true, message: "Favoritos eliminados." });
});

app.post("/user/favorites/remove", authMiddleware, (req, res) => {
  const pelicula_url = cleanPeliculaUrl(req.body?.pelicula_url);
  if (!pelicula_url) return res.status(400).json({ error: "Falta pelicula_url." });
  const user = getOrCreateUser(req.userEmail);
  const before = user.favorites.length;
  user.favorites = user.favorites.filter(f => f.pelicula_url !== pelicula_url);
  if (user.favorites.length < before) {
    enqueueBackground(() => saveUser(req.userEmail, user));
    return res.json({ ok: true });
  }
  res.status(404).json({ ok: false, message: "No encontrada en favoritos." });
});

app.post("/user/favorites/refresh", authMiddleware, (req, res) => {
  const user = getOrCreateUser(req.userEmail);
  res.json({ ok: true, refreshed: user.favorites });
});

// ── Alias GET para compatibilidad HTML ──────────────────────────────
app.get("/user/add_favorite",      (req, res) => legacyGetWrapper("add_favorite",      req, res));
app.get("/user/favorites/clear",   (req, res) => legacyGetWrapper("favorites/clear",   req, res));
app.get("/user/favorites/remove",  (req, res) => legacyGetWrapper("favorites/remove",  req, res));
app.get("/user/favorites/refresh", (req, res) => legacyGetWrapper("favorites/refresh", req, res));

// ===================================================================
// 📋  HISTORIAL  (POST)
// ===================================================================
app.post("/user/add_history", authMiddleware, (req, res) => {
  const { titulo, pelicula_url: raw, imagen_url } = req.body;
  const pelicula_url = cleanPeliculaUrl(raw);
  if (!titulo || !pelicula_url) return res.status(400).json({ error: "Faltan parámetros." });

  const user = getOrCreateUser(req.userEmail);
  user.history.unshift({ titulo, pelicula_url, imagen_url, fecha: new Date().toISOString() });
  if (user.history.length > MAX_HISTORY) user.history = user.history.slice(0, MAX_HISTORY);

  // Actualizar preferencias en segundo plano
  enqueueBackground(() => {
    updateUserPreferences(req.userEmail);
    saveUser(req.userEmail, user);
  });

  res.json({ ok: true, total: user.history.length });
});

app.post("/user/history", authMiddleware, (req, res) => {
  const user = getOrCreateUser(req.userEmail);
  res.json({ total: user.history.length, history: user.history });
});

// Alias GET compatibilidad
app.get("/user/history", (req, res) => {
  const email = (req.query.email || "").toLowerCase();
  if (!email) return res.status(400).json({ error: "Falta email" });
  const user = getOrCreateUser(email);
  res.json({ total: user.history.length, history: user.history });
});

app.post("/user/history/clear", authMiddleware, (req, res) => {
  const user = getOrCreateUser(req.userEmail);
  user.history = [];
  enqueueBackground(() => saveUser(req.userEmail, user));
  res.json({ ok: true, message: "Historial eliminado." });
});

app.post("/user/history/remove", authMiddleware, (req, res) => {
  const pelicula_url = cleanPeliculaUrl(req.body?.pelicula_url);
  if (!pelicula_url) return res.status(400).json({ error: "Falta pelicula_url." });
  const user = getOrCreateUser(req.userEmail);
  const before = user.history.length;
  user.history = user.history.filter(h => h.pelicula_url !== pelicula_url);
  if (user.history.length < before) {
    enqueueBackground(() => saveUser(req.userEmail, user));
    return res.json({ ok: true });
  }
  res.status(404).json({ ok: false, message: "No encontrada en historial." });
});

app.post("/user/history/refresh", authMiddleware, (req, res) => {
  const user = getOrCreateUser(req.userEmail);
  res.json({ ok: true, refreshed: user.history });
});

// ── Alias GET compatibilidad ─────────────────────────────────────────
app.get("/user/add_history",       (req, res) => legacyGetWrapper("add_history",       req, res));
app.get("/user/history/clear",     (req, res) => legacyGetWrapper("history/clear",     req, res));
app.get("/user/history/remove",    (req, res) => legacyGetWrapper("history/remove",    req, res));
app.get("/user/history/refresh",   (req, res) => legacyGetWrapper("history/refresh",   req, res));

// ===================================================================
// 💓  HEARTBEAT  (POST + GET para compatibilidad)
// ===================================================================
function handleHeartbeat(email, raw_pelicula_url, currentTime, totalDuration, titulo, res) {
  const pelicula_url = cleanPeliculaUrl(raw_pelicula_url);
  if (!email || !pelicula_url || isNaN(currentTime) || isNaN(totalDuration) || !titulo)
    return res.status(400).json({ error: "Faltan parámetros (email, pelicula_url, currentTime, totalDuration, titulo)." });

  const user = getOrCreateUser(email);
  user.lastActivityTimestamp = new Date().toISOString();

  const percentage = (currentTime / totalDuration) * 100;
  const isComplete  = percentage >= IS_COMPLETE_THRESHOLD;

  user.resume[pelicula_url] = {
    titulo, pelicula_url, currentTime, totalDuration,
    percentage: Math.round(percentage),
    isComplete,
    lastHeartbeat: new Date().toISOString(),
  };

  enqueueBackground(() => saveUser(email, user));
  res.json({ ok: true, message: "Latido registrado.", progress: user.resume[pelicula_url] });
}

app.post("/user/heartbeat", authMiddleware, (req, res) => {
  const { pelicula_url, currentTime, totalDuration, titulo } = req.body;
  handleHeartbeat(req.userEmail, pelicula_url, parseInt(currentTime), parseInt(totalDuration), titulo, res);
});

app.get("/user/heartbeat", (req, res) => {
  const email = (req.query.email || "").toLowerCase();
  handleHeartbeat(
    email,
    req.query.pelicula_url,
    parseInt(req.query.currentTime),
    parseInt(req.query.totalDuration),
    req.query.titulo,
    res
  );
});

// ===================================================================
// 💳  CONSUMO DE CRÉDITOS  (POST + GET)
// ===================================================================
function handleConsumeCredit(email, raw_pelicula_url, res) {
  const pelicula_url = cleanPeliculaUrl(raw_pelicula_url);
  if (!email || !pelicula_url) return res.status(400).json({ error: "Faltan parámetros." });

  const user = getOrCreateUser(email);
  if (user.tipoPlan !== "creditos")
    return res.json({ ok: true, consumed: false, message: `Plan '${user.tipoPlan}': sin consumo.` });

  const entry = user.resume[pelicula_url];
  if (!entry) return res.status(404).json({ ok: false, consumed: false, message: "Sin resumen de reproducción." });
  if (!entry.isComplete) return res.json({ ok: false, consumed: false, progress: entry.percentage, message: "Vista incompleta (<90%)." });
  if (entry.creditConsumed) return res.json({ ok: false, consumed: false, message: "Crédito ya consumido." });
  if (user.credits <= 0) return res.json({ ok: false, consumed: false, message: "Créditos insuficientes." });

  user.credits--;
  entry.creditConsumed = true;
  enqueueBackground(() => saveUser(email, user));
  res.json({ ok: true, consumed: true, remaining_credits: user.credits });
}

app.post("/user/consume_credit", authMiddleware, (req, res) => {
  handleConsumeCredit(req.userEmail, req.body?.pelicula_url, res);
});

app.get("/user/consume_credit", (req, res) => {
  handleConsumeCredit(
    (req.query.email || "").toLowerCase(),
    req.query.pelicula_url,
    res
  );
});

// ===================================================================
// 📊  PERFIL + ACTIVIDAD  (POST + GET)
// ===================================================================
app.post("/user/profile", authMiddleware, (req, res) => {
  buildProfileResponse(req.userEmail, res);
});
app.get("/user/profile", (req, res) => {
  const email = (req.query.email || "").toLowerCase();
  if (!email) return res.status(400).json({ error: "Falta email" });
  buildProfileResponse(email, res);
});

function buildProfileResponse(email, res) {
  const user = getOrCreateUser(email);
  if (!user) return res.status(400).json({ error: "Usuario no encontrado." });
  res.json({
    perfil: {
      email: user.email,
      tipoPlan: user.tipoPlan,
      credits: user.credits,
      totalFavoritos: user.favorites.length,
      totalHistorial: user.history.length,
      totalBusquedas: (user.searches || []).length,
      preferences: user.preferences || {},
      ultimaActividad: user.history[0]?.fecha || user.favorites[0]?.addedAt || "Sin actividad",
      ultimaActividadHeartbeat: user.lastActivityTimestamp || "Sin latidos",
    }
  });
}

app.post("/user/activity", authMiddleware, (req, res) => {
  buildActivityResponse(req.userEmail, res);
});
app.get("/user/activity", (req, res) => {
  const email = (req.query.email || "").toLowerCase();
  if (!email) return res.status(400).json({ error: "Falta email" });
  buildActivityResponse(email, res);
});

function buildActivityResponse(email, res) {
  const user = getOrCreateUser(email);
  if (!user) return res.status(400).json({ error: "Usuario no encontrado." });

  const historial  = user.history.map(h  => ({ tipo: "historial",            titulo: h.titulo,    fecha: h.fecha }));
  const favoritos  = user.favorites.map(f => ({ tipo: "favorito",             titulo: f.titulo,    fecha: f.addedAt }));
  const busquedas  = (user.searches || []).map(s => ({ tipo: "busqueda",      titulo: s.query,     fecha: s.fecha }));
  const resumen    = Object.values(user.resume).map(r => ({
    tipo: "reproduccion_resumen", titulo: r.titulo, fecha: r.lastHeartbeat,
    progreso: `${Math.round((r.currentTime / r.totalDuration) * 100)}%`, vistaCompleta: r.isComplete,
  }));

  const actividad = [...historial, ...favoritos, ...busquedas, ...resumen]
    .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

  res.json({ total: actividad.length, actividad });
}

// ===================================================================
// 🔍  GUARDAR BÚSQUEDAS DEL USUARIO (POST + GET)
// ===================================================================
app.post("/user/save_search", authMiddleware, (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: "Falta query." });
  saveSearchInternal(req.userEmail, query);
  res.json({ ok: true });
});

app.get("/user/save_search", (req, res) => {
  const email = (req.query.email || "").toLowerCase();
  const query  = req.query.q || req.query.query || "";
  if (!email || !query) return res.status(400).json({ error: "Falta email o query." });
  saveSearchInternal(email, query);
  res.json({ ok: true });
});

function saveSearchInternal(email, query) {
  enqueueBackground(() => {
    const user = getOrCreateUser(email);
    if (!user.searches) user.searches = [];
    user.searches.unshift({ query, fecha: new Date().toISOString() });
    if (user.searches.length > MAX_SEARCHES) user.searches = user.searches.slice(0, MAX_SEARCHES);
    updateUserPreferences(email);
    saveUser(email, user);
  });
}

// ===================================================================
// 🎯  PREFERENCIAS  (POST + GET)
// ===================================================================
app.post("/user/preferences", authMiddleware, (req, res) => {
  const user = getOrCreateUser(req.userEmail);
  const { genres, languages } = req.body;
  if (!user.preferences) user.preferences = { genres: [], languages: [] };
  if (Array.isArray(genres))    user.preferences.genres    = genres;
  if (Array.isArray(languages)) user.preferences.languages = languages;
  enqueueBackground(() => saveUser(req.userEmail, user));
  res.json({ ok: true, preferences: user.preferences });
});

app.get("/user/preferences", authMiddleware, (req, res) => {
  const user = getOrCreateUser(req.userEmail);
  res.json({ preferences: user.preferences || { genres: [], languages: [] } });
});

function updateUserPreferences(email) {
  const user = getOrCreateUser(email);
  if (!user) return;
  const { topGenres } = analyzePreferences(user, peliculas);
  if (!user.preferences) user.preferences = { genres: [], languages: [] };
  user.preferences.genres = topGenres;
  // Guardar en data pero sin disparar otro background para evitar recursión
  const data = readUsersData();
  data.users[email] = user;
  const content = JSON.stringify(data, null, 2);
  fs.writeFileSync(USERS_FILE, content);
}

// ===================================================================
// 🤖  RECOMENDACIONES  (POST + GET mixto)
// ===================================================================

/**
 * POST /recommendations
 * Recomendaciones personalizadas basadas en historial, favoritos y búsquedas.
 */
app.post("/recommendations", authMiddleware, async (req, res) => {
  try {
    const user = getOrCreateUser(req.userEmail);
    const [externas] = await Promise.all([fetchExternalPeliculas()]);
    const allMovies  = combinarResultados(externas, peliculas);
    const recs       = generateRecommendations(user, allMovies, 30);

    // Secciones tipo Netflix
    const { topGenres } = analyzePreferences(user, allMovies);
    const porGenero = {};
    topGenres.forEach(g => {
      porGenero[g] = allMovies
        .filter(m => (m.generos || "").toLowerCase().includes(g) && !recs.some(r => r.pelicula_url === m.pelicula_url))
        .slice(0, 10);
    });

    res.json({
      ok: true,
      userEmail: req.userEmail,
      secciones: {
        recomendado_para_ti: recs,
        por_genero: porGenero,
        basado_en_historial: generarBasadoEnHistorial(user, allMovies),
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function generarBasadoEnHistorial(user, allMovies) {
  const result = [];
  const vistas = user.history.slice(0, 5); // últimas 5 vistas
  for (const h of vistas) {
    const movie  = allMovies.find(m => m.pelicula_url === h.pelicula_url || m.titulo === h.titulo);
    if (!movie) continue;
    const similar = getSimilarMovies(movie, allMovies, 5);
    if (similar.length > 0) {
      result.push({ porque_viste: h.titulo, sugerencias: similar });
    }
  }
  return result;
}

/**
 * POST /similar
 * Películas similares a una dada.
 * Body: { pelicula_url } o { titulo }
 */
app.post("/similar", async (req, res) => {
  const { pelicula_url, titulo } = req.body || {};
  try {
    const [externas] = await Promise.all([fetchExternalPeliculas()]);
    const allMovies  = combinarResultados(externas, peliculas);
    const target     = allMovies.find(m =>
      (pelicula_url && m.pelicula_url === pelicula_url) ||
      (titulo && (m.titulo || "").toLowerCase() === titulo.toLowerCase())
    );
    if (!target) return res.status(404).json({ error: "Película no encontrada." });
    const similares = getSimilarMovies(target, allMovies, 20);
    res.json({ ok: true, referencia: target.titulo, total: similares.length, resultados: similares });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /similar para compatibilidad
app.get("/similar", async (req, res) => {
  const pelicula_url = req.query.pelicula_url;
  const titulo       = req.query.titulo;
  try {
    const [externas] = await Promise.all([fetchExternalPeliculas()]);
    const allMovies  = combinarResultados(externas, peliculas);
    const target     = allMovies.find(m =>
      (pelicula_url && m.pelicula_url === pelicula_url) ||
      (titulo && (m.titulo || "").toLowerCase() === (titulo || "").toLowerCase())
    );
    if (!target) return res.status(404).json({ error: "Película no encontrada." });
    const similares = getSimilarMovies(target, allMovies, 20);
    res.json({ ok: true, referencia: target.titulo, total: similares.length, resultados: similares });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /trending
 * Películas más vistas globalmente.
 */
app.post("/trending", async (req, res) => {
  try {
    const [externas] = await Promise.all([fetchExternalPeliculas()]);
    const allMovies  = combinarResultados(externas, peliculas);
    const data       = readUsersData();
    const trending   = getTrendingMovies(data.users || {}, allMovies, 30);
    res.json({ ok: true, total: trending.length, resultados: trending });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/trending", async (req, res) => {
  try {
    const [externas] = await Promise.all([fetchExternalPeliculas()]);
    const allMovies  = combinarResultados(externas, peliculas);
    const data       = readUsersData();
    const trending   = getTrendingMovies(data.users || {}, allMovies, 30);
    res.json({ ok: true, total: trending.length, resultados: trending });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /continue_watching
 * Lista de películas en progreso del usuario.
 */
app.post("/continue_watching", authMiddleware, (req, res) => {
  buildContinueWatching(req.userEmail, res);
});
app.get("/continue_watching", authMiddleware, (req, res) => {
  buildContinueWatching(req.userEmail, res);
});
// GET con email en query (sin auth) para compatibilidad frontend
app.get("/continue_watching_public", (req, res) => {
  const email = (req.query.email || "").toLowerCase();
  if (!email) return res.status(400).json({ error: "Falta email." });
  buildContinueWatching(email, res);
});

function buildContinueWatching(email, res) {
  const user = getOrCreateUser(email);
  const inProgress = Object.values(user.resume || {})
    .filter(r => !r.isComplete && r.percentage > 5)
    .sort((a, b) => new Date(b.lastHeartbeat) - new Date(a.lastHeartbeat));
  res.json({ ok: true, total: inProgress.length, resultados: inProgress });
}

/**
 * POST /history  (alias amigable)
 */
app.post("/history", authMiddleware, (req, res) => {
  const user = getOrCreateUser(req.userEmail);
  res.json({ total: user.history.length, history: user.history });
});

/**
 * POST /favorites  (alias amigable)
 */
app.post("/favorites", authMiddleware, (req, res) => {
  const user = getOrCreateUser(req.userEmail);
  res.json({ total: user.favorites.length, favorites: user.favorites });
});

// ===================================================================
// 🔧  HELPER: compatibilidad GET → lógica interna
// ===================================================================
function legacyGetWrapper(action, req, res) {
  const email        = (req.query.email || "").toLowerCase();
  const pelicula_url = cleanPeliculaUrl(req.query.pelicula_url);
  const titulo       = req.query.titulo || "";
  const imagen_url   = req.query.imagen_url || "";

  if (!email) return res.status(400).json({ error: "Falta email." });
  const user = getOrCreateUser(email);

  switch (action) {
    case "add_favorite": {
      if (!titulo || !pelicula_url) return res.status(400).json({ error: "Faltan parámetros." });
      if (!user.favorites.some(f => f.pelicula_url === pelicula_url)) {
        user.favorites.unshift({ titulo, imagen_url, pelicula_url, addedAt: new Date().toISOString() });
        enqueueBackground(() => saveUser(email, user));
      }
      return res.json({ ok: true, favorites: user.favorites });
    }
    case "favorites/clear": {
      user.favorites = [];
      enqueueBackground(() => saveUser(email, user));
      return res.json({ ok: true });
    }
    case "favorites/remove": {
      if (!pelicula_url) return res.status(400).json({ error: "Falta pelicula_url." });
      user.favorites = user.favorites.filter(f => f.pelicula_url !== pelicula_url);
      enqueueBackground(() => saveUser(email, user));
      return res.json({ ok: true });
    }
    case "favorites/refresh": {
      return res.json({ ok: true, refreshed: user.favorites });
    }
    case "add_history": {
      if (!titulo || !pelicula_url) return res.status(400).json({ error: "Faltan parámetros." });
      user.history.unshift({ titulo, pelicula_url, imagen_url, fecha: new Date().toISOString() });
      if (user.history.length > MAX_HISTORY) user.history = user.history.slice(0, MAX_HISTORY);
      enqueueBackground(() => {
        updateUserPreferences(email);
        saveUser(email, user);
      });
      return res.json({ ok: true, total: user.history.length });
    }
    case "history/clear": {
      user.history = [];
      enqueueBackground(() => saveUser(email, user));
      return res.json({ ok: true });
    }
    case "history/remove": {
      if (!pelicula_url) return res.status(400).json({ error: "Falta pelicula_url." });
      user.history = user.history.filter(h => h.pelicula_url !== pelicula_url);
      enqueueBackground(() => saveUser(email, user));
      return res.json({ ok: true });
    }
    case "history/refresh": {
      return res.json({ ok: true, refreshed: user.history });
    }
    default:
      return res.status(404).json({ error: "Acción desconocida." });
  }
}

// ── Rutas GET legacy para compatibilidad total ──────────────────────
app.get("/user/get",       (req, res) => { const e = (req.query.email||"").toLowerCase(); if(!e) return res.status(400).json({error:"Falta email"}); res.json(getOrCreateUser(e)); });
app.get("/user/setplan",   (req, res) => {
  const email = (req.query.email||"").toLowerCase();
  const tipoPlan = req.query.tipoPlan;
  const credits  = req.query.credits ? parseInt(req.query.credits) : undefined;
  if (!email||!tipoPlan) return res.status(400).json({error:"Falta email o tipoPlan"});
  const user = getOrCreateUser(email);
  user.tipoPlan = tipoPlan;
  if (typeof credits==="number") user.credits=credits;
  saveUser(email,user);
  res.json({ok:true,user});
});

// ===================================================================
// 🚀  INICIO DEL SERVIDOR
// ===================================================================
async function startServer() {
  await loadUsersDataFromGitHub();
  const PORT = process.env.PORT || 8080;
  app.listen(PORT, () => {
    console.log(`✅ PeliPREX API v2 corriendo en http://localhost:${PORT}`);
    console.log(`🔑 Sistema de API Keys activo (solo validación)`);
    console.log(`🤖 Motor de recomendaciones listo`);
    console.log(`🧵 Cola de procesamiento background activa`);
  });
}

startServer();
