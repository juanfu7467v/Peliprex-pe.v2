// index.js — API completa de Películas con respaldo TMDb + PeliPREX + Embeds + YouTube (último) + sistema de usuarios
// ¡MEJORADO con Respaldo en GitHub para Historial y Favoritos, PeliPREX como respaldo principal y sistema multi-fuente!

import express from "express";
import cors from "cors";
import fs from "fs";
import fetch from "node-fetch";
import path from "path";

const app = express();
app.use(cors());

// ------------------- GITHUB CONFIGURACIÓN DE RESPALDO -------------------
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO;
const BACKUP_FILE_NAME = "users_data.json";

// 🔑 Claves de API
const TMDB_API_KEY = process.env.TMDB_API_KEY;
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

if (!TMDB_API_KEY) console.error("❌ ERROR: La variable de entorno TMDB_API_KEY no está configurada.");
if (!YOUTUBE_API_KEY) console.warn("⚠️ AVISO: YOUTUBE_API_KEY no está configurada. YouTube no estará disponible como último respaldo.");

// 📂 Archivos locales
const PELIS_FILE = path.join(process.cwd(), "peliculas.json");
const USERS_FILE = path.join(process.cwd(), BACKUP_FILE_NAME);

// ------------------- FUNCIONES AUXILIARES -------------------

/** Limpia la URL de la película eliminando la duplicidad '/prepreview' para corregir a '/preview'. */
function cleanPeliculaUrl(url) {
  if (!url) return url;
  return url.replace(/\/prepreview([?#]|$)/, '/preview$1');
}

/** Devuelve un array con elementos aleatorios y desordenados. */
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

/**
 * 🆕 Genera un array de URLs de reproductores embed usando el ID de TMDb.
 * Proporciona múltiples fuentes espejo para mayor disponibilidad.
 * @param {number|string} tmdbId - El ID de la película en TMDb.
 * @returns {string[]} Array de URLs de embed ordenadas por prioridad.
 */
function generarFuentesEmbed(tmdbId) {
  return [
    `https://multiembed.mov/?video_id=${tmdbId}&tmdb=1`,
    `https://embed.smashystream.com/playere.php?tmdb=${tmdbId}`,
    `https://www.2embed.cc/embed/${tmdbId}`,
    `https://nontons.com/embed/movie/${tmdbId}`,
  ];
}

// Mapeo de las categorías del usuario a los IDs de Género de TMDb.
const TMDB_GENRE_MAP = {
    "accion": 28,
    "aventura": 12,
    "animacion": 16,
    "comedia": 35,
    "crimen": 80,
    "documental": 99,
    "drama": 18,
    "familia": 10751,
    "fantasia": 14,
    "historia": 36,
    "terror": 27,
    "musica": 10402,
    "misterio": 9648,
    "romance": 10749,
    "ciencia ficcion": 878,
    "thriller (suspenso)": 53,
    "guerra": 10752,
    "western (vaqueros)": 37,
    "deportes": 99,
    "biografia": 18,
    "musical": 10402,
    "politica": 18,
    "cine independiente": 18,
    "superheroes": 28,
    "cine clasico": null,
    "aventura epica": 12,
    "cine romantico juvenil": 10749,
    "ficcion postapocaliptica": 878,
    "peliculas religiosas / fe": 18,
    "cine historico": 36,
    "comedia romantica": "35,10749",
    "terror psicologico": "27,53",
    "accion militar / belica": 10752,
    "ciencia ficcion futurista": 878,
    "cine experimental / arte": 99
};


// ------------------- FUNCIONES DE GITHUB -------------------

/** Obtiene el SHA de la última versión del archivo en GitHub. */
async function getFileSha(filePath) {
  if (!GITHUB_TOKEN || !GITHUB_REPO) return null;
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${filePath}`;
  try {
    const resp = await fetch(url, {
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
      },
    });
    if (resp.status === 404) return null;
    if (!resp.ok) {
      console.error(`❌ Error al obtener SHA de GitHub (Status ${resp.status}): ${await resp.text()}`);
      return null;
    }
    const data = await resp.json();
    return data.sha;
  } catch (error) {
    console.error("❌ Excepción al obtener SHA de GitHub:", error.message);
    return null;
  }
}

/** Guarda los datos de usuario en GitHub. */
async function saveUsersDataToGitHub(content) {
  if (!GITHUB_TOKEN || !GITHUB_REPO) {
    console.log("⚠️ GitHub no configurado (Faltan GITHUB_TOKEN o GITHUB_REPO). Solo guardado local.");
    return false;
  }
  console.log(`💾 Iniciando respaldo de ${BACKUP_FILE_NAME} en GitHub...`);
  try {
    const sha = await getFileSha(BACKUP_FILE_NAME);
    const contentBase64 = Buffer.from(content).toString('base64');
    const commitMessage = `Automated backup: Update ${BACKUP_FILE_NAME} at ${new Date().toISOString()}`;
    const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${BACKUP_FILE_NAME}`;
    const resp = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: commitMessage,
        content: contentBase64,
        sha: sha,
      }),
    });
    if (!resp.ok) {
      console.error(`❌ Error al guardar en GitHub (Status: ${resp.status}): ${await resp.text()}`);
      return false;
    }
    console.log("✅ Datos de usuario respaldados en GitHub con éxito.");
    return true;
  } catch (error) {
    console.error("❌ Excepción al guardar en GitHub:", error.message);
    return false;
  }
}

/** Carga los datos de usuario desde GitHub al iniciar el servidor. */
async function loadUsersDataFromGitHub() {
  if (!GITHUB_TOKEN || !GITHUB_REPO) return false;
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${BACKUP_FILE_NAME}`;
  console.log(`📡 Intentando cargar ${BACKUP_FILE_NAME} desde GitHub...`);
  try {
    const resp = await fetch(url, {
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3.raw',
      },
    });
    if (resp.status === 404) {
      console.log(`ℹ️ Archivo no encontrado en GitHub. Se creará un nuevo archivo local si es necesario.`);
      return false;
    }
    if (!resp.ok) {
      console.error(`❌ Error al cargar de GitHub (Status: ${resp.status}): ${await resp.text()}`);
      return false;
    }
    const content = await resp.text();
    fs.writeFileSync(USERS_FILE, content, 'utf8');
    console.log(`✅ Datos de usuario cargados y restaurados localmente desde GitHub.`);
    return true;
  } catch (error) {
    console.error("❌ Excepción al cargar de GitHub:", error.message);
    return false;
  }
}


// ------------------- CARGAR PELÍCULAS -------------------
let peliculas = [];
try {
  peliculas = JSON.parse(fs.readFileSync(PELIS_FILE, "utf8"));
  console.log(`✅ Cargadas ${peliculas.length} películas desde peliculas.json`);
} catch (err) {
  console.error("❌ Error cargando peliculas.json:", err.message);
  peliculas = [];
}

// ------------------- FUNCIONES DE USUARIOS -------------------
function ensureUsersFile() {
  if (!fs.existsSync(USERS_FILE)) {
    console.log(`ℹ️ Creando archivo local: ${BACKUP_FILE_NAME}`);
    const initialData = JSON.stringify({ users: {} }, null, 2);
    fs.writeFileSync(USERS_FILE, initialData);
    saveUsersDataToGitHub(initialData);
  }
}
function readUsersData() {
  ensureUsersFile();
  return JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
}
function writeUsersData(data) {
  const content = JSON.stringify(data, null, 2);
  fs.writeFileSync(USERS_FILE, content);
  saveUsersDataToGitHub(content);
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
      resume: {},
      lastActivityTimestamp: new Date().toISOString()
    };
    writeUsersData(data);
  }
  if (!data.users[email].resume) data.users[email].resume = {};
  if (!data.users[email].lastActivityTimestamp) data.users[email].lastActivityTimestamp = new Date().toISOString();
  return data.users[email];
}
function saveUser(email, userObj) {
  const data = readUsersData();
  data.users[email] = userObj;
  writeUsersData(data);
}

// ------------------- CONTROL DE INACTIVIDAD DEL SERVIDOR -------------------
let ultimaPeticion = Date.now();
const TIEMPO_INACTIVIDAD = 60 * 1000;

setInterval(async () => {
  if (Date.now() - ultimaPeticion >= TIEMPO_INACTIVIDAD) {
    console.log("🕒 Sin tráfico por 1 minuto. Iniciando cierre y respaldo final...");
    try {
      const data = readUsersData();
      const content = JSON.stringify(data, null, 2);
      const saved = await saveUsersDataToGitHub(content);
      console.log(`✅ Respaldo final ${saved ? 'exitoso' : 'fallido'}. Cerrando servidor.`);
    } catch (e) {
      console.error("❌ Error durante el cierre y respaldo final:", e.message);
    }
    process.exit(0);
  }
}, 30 * 1000);

app.use((req, res, next) => {
  ultimaPeticion = Date.now();
  next();
});


// ------------------- TAREA PROGRAMADA: ELIMINACIÓN DE ACTIVIDAD CADA 24 HRS -------------------
const MS_IN_24_HOURS = 24 * 60 * 60 * 1000;

setInterval(() => {
    console.log("🧹 Iniciando chequeo de limpieza de actividad de 24 horas...");
    const data = readUsersData();
    let usersModified = false;
    const now = Date.now();

    for (const email in data.users) {
        const user = data.users[email];
        let userActivityModified = false;

        const historyLengthBefore = user.history.length;
        user.history = user.history.filter(h => {
            const historyDate = new Date(h.fecha).getTime();
            return now - historyDate < MS_IN_24_HOURS;
        });
        if (user.history.length !== historyLengthBefore) {
            console.log(`   [${email}] Historial: Eliminados ${historyLengthBefore - user.history.length} elementos por antigüedad (>24h).`);
            userActivityModified = true;
        }

        const resumeKeysBefore = Object.keys(user.resume).length;
        const newResume = {};
        for (const url in user.resume) {
            const resumeEntry = user.resume[url];
            const lastHeartbeatDate = new Date(resumeEntry.lastHeartbeat).getTime();
            if (now - lastHeartbeatDate < MS_IN_24_HOURS) {
                newResume[url] = resumeEntry;
            }
        }
        user.resume = newResume;
        const resumeKeysAfter = Object.keys(user.resume).length;
        if (resumeKeysAfter !== resumeKeysBefore) {
            console.log(`   [${email}] Resumen: Eliminados ${resumeKeysBefore - resumeKeysAfter} elementos por inactividad (>24h).`);
            userActivityModified = true;
        }

        if (userActivityModified) usersModified = true;
    }

    if (usersModified) {
        writeUsersData(data);
        console.log("✅ Limpieza de actividad completada y datos guardados.");
    } else {
        console.log("ℹ️ No se encontraron actividades para limpiar.");
    }

}, MS_IN_24_HOURS);


// ------------------- RUTAS PRINCIPALES -------------------
app.get("/", (req, res) => {
  res.json({
    mensaje: "🎬 API de Películas funcionando correctamente",
    total: peliculas.length,
    ejemplo: "/peliculas o /peliculas/El%20Padrino"
  });
});

app.get("/peliculas", (req, res) => res.json(peliculas));

app.get("/peliculas/:titulo", async (req, res) => {
  const tituloRaw = decodeURIComponent(req.params.titulo || "");
  const titulo = tituloRaw.toLowerCase();
  const resultado = peliculas.filter(p =>
    (p.titulo || "").toLowerCase().includes(titulo)
  );

  if (resultado.length > 0)
    return res.json({ fuente: "local", resultados: resultado });

  console.log(`🔎 No se encontró "${tituloRaw}" en el JSON. Buscando respaldo...`);
  try {
    const respaldo = await buscarPeliculaRespaldo(tituloRaw);
    if (respaldo) return res.json({ fuente: "respaldo", resultados: [respaldo] });
    return res.json({
        fuente: "local/respaldo",
        total: 0,
        resultados: [],
        error: "Película no encontrada en local ni en respaldo."
    });
  } catch (error) {
    console.error("❌ Error al buscar respaldo:", error);
    res.status(500).json({ error: "Error al consultar respaldo externo." });
  }
});

// 🔎 Búsqueda avanzada
app.get("/buscar", async (req, res) => {
  const { año, genero, idioma, desde, hasta, q } = req.query;
  let resultados = peliculas;

  // --- 1. BÚSQUEDA LOCAL ---
  if (q) {
    const ql = q.toLowerCase();
    resultados = resultados.filter(p =>
      (p.titulo || "").toLowerCase().includes(ql) ||
      (p.descripcion || "").toLowerCase().includes(ql)
    );
  }
  if (año) resultados = resultados.filter(p => String(p.año) === String(año));
  if (genero)
    resultados = resultados.filter(p =>
      (p.generos || "").toLowerCase().includes(String(genero).toLowerCase())
    );
  if (idioma)
    resultados = resultados.filter(
      p => (p.idioma_original || "").toLowerCase() === String(idioma).toLowerCase()
    );
  if (desde && hasta)
    resultados = resultados.filter(
      p =>
        parseInt(p.año) >= parseInt(desde) &&
        parseInt(p.año) <= parseInt(hasta)
    );

  if (resultados.length > 0) {
    return res.json({ fuente: "local", total: resultados.length, resultados });
  }

  // --- 2. BÚSQUEDA DE RESPALDO (TMDb) ---
  console.log("🔎 No se encontraron resultados en el JSON local. Buscando respaldo avanzado...");
  const generoBuscado = String(genero || "").toLowerCase();
  const tmdb_genre_id = TMDB_GENRE_MAP[generoBuscado] || null;
  const release_date_gte = desde ? `${desde}-01-01` : null;
  const release_date_lte = hasta ? `${hasta}-12-31` : null;

  try {
    const respaldoResults = await searchTMDb({
      query: q,
      genre_id: tmdb_genre_id,
      primary_release_year: año,
      release_date_gte: release_date_gte,
      release_date_lte: release_date_lte,
    });
    if (respaldoResults.length > 0) {
        return res.json({ fuente: "respaldo", total: respaldoResults.length, resultados: respaldoResults });
    }
  } catch (error) {
    console.error("❌ Error al buscar respaldo avanzado:", error);
  }

  res.json({ fuente: "local/respaldo", total: 0, resultados: [], error: "No se encontraron películas con los criterios de búsqueda, ni localmente ni en el respaldo." });
});

// 🆕 Búsqueda por Categoría (Género)
app.get("/peliculas/categoria/:genero", async (req, res) => {
    const generoRaw = decodeURIComponent(req.params.genero || "");
    const generoBuscado = generoRaw.toLowerCase();

    let resultados = peliculas.filter(p =>
        (p.generos || "").toLowerCase().includes(generoBuscado)
    );

    if (resultados.length > 0) {
        return res.json({
            fuente: "local",
            total: resultados.length,
            resultados: shuffleArray(resultados)
        });
    }

    console.log(`🔎 No se encontró la categoría "${generoRaw}" en el JSON. Buscando respaldo...`);
    const tmdb_genre_id = TMDB_GENRE_MAP[generoBuscado];

    if (!tmdb_genre_id) {
        return res.json({
            fuente: "respaldo",
            total: 0,
            resultados: [],
            error: "Categoría no válida o no mapeada para el respaldo."
        });
    }

    try {
        const respaldoResults = await searchTMDb({
            genre_id: tmdb_genre_id,
            sort_by: 'vote_count.desc'
        });
        if (respaldoResults.length > 0) {
            return res.json({
                fuente: "respaldo",
                total: respaldoResults.length,
                resultados: shuffleArray(respaldoResults)
            });
        }
        return res.json({
            fuente: "respaldo",
            total: 0,
            resultados: [],
            error: "No se encontraron películas en la categoría de respaldo."
        });
    } catch (error) {
        console.error("❌ Error al buscar categoría en respaldo:", error);
        res.status(500).json({ error: "Error al consultar respaldo externo para la categoría." });
    }
});


// ------------------- RUTAS DE USUARIOS -------------------
app.get("/user/get", (req, res) => {
  const email = (req.query.email || "").toLowerCase();
  if (!email) return res.status(400).json({ error: "Falta parámetro email" });
  res.json(getOrCreateUser(email));
});

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
  const { titulo, imagen_url, pelicula_url: raw_pelicula_url } = req.query;
  const pelicula_url = cleanPeliculaUrl(raw_pelicula_url);
  if (!email || !titulo || !pelicula_url)
    return res.status(400).json({ error: "Faltan parámetros" });
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

app.get("/user/favorites/clear", (req, res) => {
  const email = (req.query.email || "").toLowerCase();
  if (!email) return res.status(400).json({ error: "Falta email" });
  const user = getOrCreateUser(email);
  if (!user) return res.status(404).json({ error: "Usuario no encontrado" });
  user.favorites = [];
  saveUser(email, user);
  res.json({ ok: true, message: "Lista de favoritos eliminada." });
});

app.get("/user/favorites/remove", (req, res) => {
  const email = (req.query.email || "").toLowerCase();
  const raw_pelicula_url = req.query.pelicula_url;
  const pelicula_url = cleanPeliculaUrl(raw_pelicula_url);
  if (!email || !pelicula_url)
    return res.status(400).json({ error: "Faltan email o pelicula_url" });
  const user = getOrCreateUser(email);
  if (!user) return res.status(404).json({ error: "Usuario no encontrado" });
  const initialLength = user.favorites.length;
  user.favorites = user.favorites.filter(f => f.pelicula_url !== pelicula_url);
  if (user.favorites.length < initialLength) {
    saveUser(email, user);
    return res.json({ ok: true, message: "Película eliminada de favoritos." });
  }
  res.status(404).json({ ok: false, message: "Película no encontrada en favoritos." });
});

// Historial
app.get("/user/add_history", (req, res) => {
  const email = (req.query.email || "").toLowerCase();
  const { titulo, pelicula_url: raw_pelicula_url, imagen_url } = req.query;
  const pelicula_url = cleanPeliculaUrl(raw_pelicula_url);
  if (!email || !titulo || !pelicula_url)
    return res.status(400).json({ error: "Faltan parámetros" });
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

app.get("/user/history/clear", (req, res) => {
  const email = (req.query.email || "").toLowerCase();
  if (!email) return res.status(400).json({ error: "Falta email" });
  const user = getOrCreateUser(email);
  if (!user) return res.status(404).json({ error: "Usuario no encontrado" });
  user.history = [];
  saveUser(email, user);
  res.json({ ok: true, message: "Historial de películas eliminado." });
});

app.get("/user/history/remove", (req, res) => {
  const email = (req.query.email || "").toLowerCase();
  const raw_pelicula_url = req.query.pelicula_url;
  const pelicula_url = cleanPeliculaUrl(raw_pelicula_url);
  if (!email || !pelicula_url)
    return res.status(400).json({ error: "Faltan email o pelicula_url" });
  const user = getOrCreateUser(email);
  if (!user) return res.status(404).json({ error: "Usuario no encontrado" });
  const initialLength = user.history.length;
  user.history = user.history.filter(h => h.pelicula_url !== pelicula_url);
  if (user.history.length < initialLength) {
    saveUser(email, user);
    return res.json({ ok: true, message: "Película eliminada del historial." });
  }
  res.status(404).json({ ok: false, message: "Película no encontrada en el historial." });
});


// ------------------- NUEVOS ENDPOINTS -------------------

// 🔁 Refrescar historial
app.get("/user/history/refresh", async (req, res) => {
  const email = (req.query.email || "").toLowerCase();
  const titulo = req.query.titulo || null;
  const user = getOrCreateUser(email);
  if (!user) return res.status(400).json({ error: "Usuario no encontrado" });
  const toRefresh = titulo
    ? user.history.filter(h => h.titulo === titulo)
    : user.history;
  const refreshed = [];
  for (const h of toRefresh) {
    const nueva = await buscarPeliculaRespaldo(h.titulo);
    if (nueva) refreshed.push(nueva);
  }
  if (!titulo) user.history = refreshed;
  saveUser(email, user);
  res.json({ ok: true, refreshed });
});

// 🔁 Refrescar favoritos
app.get("/user/favorites/refresh", async (req, res) => {
  const email = (req.query.email || "").toLowerCase();
  const titulo = req.query.titulo || null;
  const user = getOrCreateUser(email);
  if (!user) return res.status(400).json({ error: "Usuario no encontrado" });
  const toRefresh = titulo
    ? user.favorites.filter(f => f.titulo === titulo)
    : user.favorites;
  const refreshed = [];
  for (const f of toRefresh) {
    const nueva = await buscarPeliculaRespaldo(f.titulo);
    if (nueva) refreshed.push(nueva);
  }
  if (!titulo) user.favorites = refreshed;
  saveUser(email, user);
  res.json({ ok: true, refreshed });
});

// 📊 Perfil con estadísticas
app.get("/user/profile", (req, res) => {
  const email = (req.query.email || "").toLowerCase();
  const user = getOrCreateUser(email);
  if (!user) return res.status(400).json({ error: "Usuario no encontrado" });
  const perfil = {
    email: user.email,
    tipoPlan: user.tipoPlan,
    credits: user.credits,
    totalFavoritos: user.favorites.length,
    totalHistorial: user.history.length,
    ultimaActividad: user.history[0]?.fecha || user.favorites[0]?.addedAt || "Sin actividad",
    ultimaActividadHeartbeat: user.lastActivityTimestamp || "Sin latidos",
  };
  res.json({ perfil });
});

// 🧾 Actividad combinada
app.get("/user/activity", (req, res) => {
  const email = (req.query.email || "").toLowerCase();
  const user = getOrCreateUser(email);
  if (!user) return res.status(400).json({ error: "Usuario no encontrado" });
  const historial = user.history.map(h => ({ tipo: "historial", titulo: h.titulo, fecha: h.fecha }));
  const favoritos = user.favorites.map(f => ({ tipo: "favorito", titulo: f.titulo, fecha: f.addedAt }));
  const resumen = Object.values(user.resume).map(r => ({
    tipo: "reproduccion_resumen",
    titulo: r.titulo,
    fecha: r.lastHeartbeat,
    progreso: `${Math.round((r.currentTime / r.totalDuration) * 100)}%`,
    vistaCompleta: r.isComplete,
  }));
  const actividad = [...historial, ...favoritos, ...resumen].sort(
    (a, b) => new Date(b.fecha) - new Date(a.fecha)
  );
  res.json({ total: actividad.length, actividad });
});


// ------------------- ENDPOINTS DE SEGUIMIENTO DE STREAMING (LATIDOS) -------------------

app.get("/user/heartbeat", (req, res) => {
    const email = (req.query.email || "").toLowerCase();
    const raw_pelicula_url = req.query.pelicula_url;
    const currentTime = parseInt(req.query.currentTime);
    const totalDuration = parseInt(req.query.totalDuration);
    const titulo = req.query.titulo;
    const pelicula_url = cleanPeliculaUrl(raw_pelicula_url);

    if (!email || !pelicula_url || isNaN(currentTime) || isNaN(totalDuration) || !titulo) {
        return res.status(400).json({ error: "Faltan parámetros válidos (email, pelicula_url, currentTime, totalDuration, titulo)." });
    }

    const user = getOrCreateUser(email);
    user.lastActivityTimestamp = new Date().toISOString();
    const key = pelicula_url;
    const percentage = (currentTime / totalDuration) * 100;
    const IS_COMPLETE_THRESHOLD = 90;
    const isComplete = percentage >= IS_COMPLETE_THRESHOLD;

    user.resume[key] = {
        titulo: titulo,
        pelicula_url: pelicula_url,
        currentTime: currentTime,
        totalDuration: totalDuration,
        percentage: Math.round(percentage),
        isComplete: isComplete,
        lastHeartbeat: new Date().toISOString()
    };

    saveUser(email, user);
    res.json({ ok: true, message: "Latido registrado.", progress: user.resume[key] });
});

app.get("/user/consume_credit", (req, res) => {
    const email = (req.query.email || "").toLowerCase();
    const raw_pelicula_url = req.query.pelicula_url;
    const pelicula_url = cleanPeliculaUrl(raw_pelicula_url);

    if (!email || !pelicula_url) {
        return res.status(400).json({ error: "Faltan parámetros (email, pelicula_url)." });
    }

    const user = getOrCreateUser(email);

    if (user.tipoPlan !== 'creditos') {
        return res.json({
            ok: true,
            consumed: false,
            message: `El plan del usuario es '${user.tipoPlan}', no se requiere consumo de crédito.`
        });
    }

    const resumeEntry = user.resume[pelicula_url];

    if (!resumeEntry) {
        return res.status(404).json({
            ok: false,
            consumed: false,
            message: "No se encontró el resumen de reproducción para esta película."
        });
    }

    if (!resumeEntry.isComplete) {
        return res.json({
            ok: false,
            consumed: false,
            progress: resumeEntry.percentage,
            message: "La película no ha sido vista completamente (requiere >90%)."
        });
    }

    if (user.credits <= 0) {
        return res.json({ ok: false, consumed: false, message: "Créditos insuficientes." });
    }

    user.credits -= 1;
    resumeEntry.creditConsumed = true;
    saveUser(email, user);

    res.json({
        ok: true,
        consumed: true,
        remaining_credits: user.credits,
        message: "Crédito consumido exitosamente. La película se marcó como vista completa."
    });
});


// ==================================================================================
// ------------------- SISTEMA DE RESPALDO: TMDb + PeliPREX + Embeds + YouTube -------------------
// ==================================================================================

/**
 * Busca una película por título usando la siguiente cascada de fuentes:
 *
 *  1️⃣  Fuente principal  → JSON local (manejado en la ruta /peliculas/:titulo)
 *  2️⃣  Primer respaldo   → API PeliPREX (streaming real, organizado por capítulos si hay varios)
 *  3️⃣  Segundo respaldo  → Embeds TMDb: MultiEmbed, SmashyStream, 2Embed, Nontons
 *  4️⃣  Último respaldo   → YouTube (solo si YOUTUBE_API_KEY está configurada y todo lo anterior falló)
 *
 * @param {string} titulo - Título de la película a buscar.
 * @returns {object|null} Objeto con los datos de la película o null si no se encontró.
 */
async function buscarPeliculaRespaldo(titulo) {
  if (!TMDB_API_KEY) {
    console.error("❌ No se puede usar el respaldo: Falta la clave TMDB_API_KEY.");
    return null;
  }

  try {
    // ── PASO 1: Obtener metadatos desde TMDb ──────────────────────────────────────
    const tmdbSearchUrl = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&language=es-ES&query=${encodeURIComponent(titulo)}`;
    const tmdbResp = await fetch(tmdbSearchUrl);
    const tmdbData = await tmdbResp.json();

    if (!tmdbData.results || tmdbData.results.length === 0) {
      console.log(`ℹ️ TMDb: No se encontraron resultados para "${titulo}".`);
      return null;
    }

    const pelicula = tmdbData.results[0];
    const tmdbId = pelicula.id;

    // Obtener detalles completos (géneros, etc.)
    const detallesUrl = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}&language=es-ES`;
    const detallesResp = await fetch(detallesUrl);
    const detalles = await detallesResp.json();

    // Variables de estado para la fuente de video
    let peliculaUrl = null;
    let fuenteVideo = null;
    let capitulos = null;

    // ── PASO 2: PRIMER RESPALDO → PeliPREX ───────────────────────────────────────
    try {
      console.log(`🔍 PeliPREX: Buscando "${titulo}"...`);
      const peliprixResp = await fetch(
        `https://peliprex.fly.dev/search?q=${encodeURIComponent(titulo)}`,
        { signal: AbortSignal.timeout(8000) } // Timeout de 8 segundos
      );
      const peliprixData = await peliprixResp.json();

      if (peliprixData.results && peliprixData.results.length > 0) {
        // Usar el stream_url del primer resultado como URL principal
        peliculaUrl = peliprixData.results[0].stream_url;
        fuenteVideo = "PeliPREX";

        // Si hay múltiples resultados, organizarlos como capítulos/versiones
        if (peliprixData.results.length > 1) {
          capitulos = peliprixData.results.map((r, i) => ({
            capitulo: i + 1,
            titulo: r.title || titulo,
            tamaño: r.size || null,
            stream_url: r.stream_url,
            id: r.id
          }));
        }

        console.log(`✅ PeliPREX: Encontrado "${titulo}" (${peliprixData.count} resultado(s)).`);
      } else {
        console.log(`ℹ️ PeliPREX: Sin resultados para "${titulo}".`);
      }
    } catch (peliprixErr) {
      console.warn(`⚠️ PeliPREX no disponible para "${titulo}": ${peliprixErr.message}`);
    }

    // ── PASO 3: SEGUNDO RESPALDO → Embeds MultiEmbed / SmashyStream / Mirrors ──────────
    if (!peliculaUrl) {
      const fuentesEmbed = generarFuentesEmbed(tmdbId);
      // MultiEmbed es la fuente principal del embed
      peliculaUrl = fuentesEmbed[0];
      fuenteVideo = "MultiEmbed";
      console.log(`✅ Embed MultiEmbed asignado para TMDb ID ${tmdbId} ("${pelicula.title}").`);
    }

    // ── PASO 4: ÚLTIMO RESPALDO → YouTube (solo si todo lo anterior falló) ───────
    if (!peliculaUrl && YOUTUBE_API_KEY) {
      try {
        console.log(`🔍 YouTube (último respaldo): Buscando "${titulo}"...`);
        const year = pelicula.release_date ? ` (${pelicula.release_date.substring(0, 4)})` : '';
        const youtubeQuery = `${pelicula.title}${year} película completa español latino`;
        const youtubeApiUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(youtubeQuery)}&key=${YOUTUBE_API_KEY}&type=video&maxResults=1`;
        const youtubeResp = await fetch(youtubeApiUrl);
        const youtubeData = await youtubeResp.json();
        const youtubeId = youtubeData.items?.[0]?.id?.videoId || null;

        if (youtubeId) {
          peliculaUrl = `https://www.youtube.com/watch?v=${youtubeId}`;
          fuenteVideo = "YouTube";
          console.log(`✅ YouTube (último respaldo) encontrado para "${titulo}".`);
        } else {
          console.log(`ℹ️ YouTube: Sin resultados para "${titulo}".`);
        }
      } catch (ytErr) {
        console.warn(`⚠️ Error al consultar YouTube para "${titulo}": ${ytErr.message}`);
      }
    }

    // ── RESPUESTA FINAL ───────────────────────────────────────────────────────────
    return {
      titulo: pelicula.title,
      descripcion: pelicula.overview || "",
      fecha_lanzamiento: pelicula.release_date || "",
      idioma_original: pelicula.original_language || "",
      puntuacion: pelicula.vote_average || 0,
      popularidad: pelicula.popularity || 0,
      generos: detalles.genres?.map(g => g.name).join(", ") || "",
      imagen_url: pelicula.poster_path
        ? `https://image.tmdb.org/t/p/w500${pelicula.poster_path}`
        : "",
      tmdb_id: tmdbId,
      pelicula_url: peliculaUrl,
      fuente_video: fuenteVideo,
      // Todos los mirrors embed disponibles para que el frontend pueda hacer fallback
      fuentes_espejo: generarFuentesEmbed(tmdbId),
      // Capítulos/versiones de PeliPREX (null si solo hay un resultado o si se usó otro respaldo)
      capitulos: capitulos,
      respaldo: true
    };

  } catch (err) {
    console.error(`❌ Error en buscarPeliculaRespaldo("${titulo}"):`, err.message);
    return null;
  }
}

/**
 * Búsqueda general en TMDb (para listas, búsqueda avanzada y categorías).
 * ✅ OPTIMIZADO: No realiza llamadas a YouTube. Genera URLs de embed directamente
 *    usando el ID de TMDb, eliminando el consumo de cuota de YouTube y mejorando el rendimiento.
 *
 * @param {object} params - Parámetros de búsqueda.
 * @returns {object[]} Array de películas enriquecidas con URLs de embed.
 */
async function searchTMDb(params) {
  // Solo requiere TMDB_API_KEY (YouTube ya no se usa aquí)
  if (!TMDB_API_KEY) {
    console.error("❌ searchTMDb: Falta TMDB_API_KEY.");
    return [];
  }

  const {
    query,
    genre_id,
    primary_release_year,
    release_date_gte,
    release_date_lte,
    sort_by = 'popularity.desc',
    page = 1
  } = params;

  let url = '';

  if (query) {
    // Búsqueda por texto (título / descripción)
    url = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&language=es-ES&query=${encodeURIComponent(query)}&page=${page}`;
  } else if (genre_id || primary_release_year || release_date_gte || release_date_lte) {
    // Búsqueda avanzada/Discover (género, año, rango de fechas)
    let discoverParams = `&sort_by=${sort_by}&page=${page}`;
    if (genre_id) discoverParams += `&with_genres=${genre_id}`;
    if (primary_release_year) discoverParams += `&primary_release_year=${primary_release_year}`;
    if (release_date_gte) discoverParams += `&primary_release_date.gte=${release_date_gte}`;
    if (release_date_lte) discoverParams += `&primary_release_date.lte=${release_date_lte}`;
    url = `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_API_KEY}&language=es-ES${discoverParams}`;
  } else {
    return []; // Sin criterio de búsqueda válido
  }

  try {
    const resp = await fetch(url);
    const data = await resp.json();

    if (!data.results || data.results.length === 0) return [];

    // ✅ Sin límite estricto de 10 ya que no hay cuota de YouTube que proteger
    const resultsToProcess = data.results.slice(0, 20);
    const enrichedResults = [];

    for (const pelicula of resultsToProcess) {
      if (!pelicula.title) continue;

      const tmdbId = pelicula.id;

      // ✅ URL del reproductor generada directamente desde el ID de TMDb (sin llamada a YouTube)
      enrichedResults.push({
        titulo: pelicula.title,
        descripcion: pelicula.overview || "",
        fecha_lanzamiento: pelicula.release_date || "",
        idioma_original: pelicula.original_language || "",
        puntuacion: pelicula.vote_average || 0,
        generos_ids: pelicula.genre_ids || [],
        imagen_url: pelicula.poster_path
          ? `https://image.tmdb.org/t/p/w500${pelicula.poster_path}`
          : "",
        tmdb_id: tmdbId,
        // ✅ MultiEmbed como fuente principal directa
        pelicula_url: `https://multiembed.mov/?video_id=${tmdbId}&tmdb=1`,
        fuente_video: "MultiEmbed",
        // ✅ Mirrors alternativos para fallback en el frontend
        fuentes_espejo: generarFuentesEmbed(tmdbId),
        respaldo: true
      });
    }

    // ✅ Todos los resultados tienen URL (no hay filtro por YouTube)
    return enrichedResults;

  } catch (err) {
    console.error("❌ Error en searchTMDb:", err.message);
    return [];
  }
}


// ------------------- INICIAR SERVIDOR -------------------
async function startServer() {
  await loadUsersDataFromGitHub();
  const PORT = process.env.PORT || 8080;
  app.listen(PORT, () => console.log(`✅ Servidor corriendo en http://localhost:${PORT}`));
}

startServer();
