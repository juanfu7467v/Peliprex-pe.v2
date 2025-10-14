// index.js — API completa de Películas con respaldo TMDb + YouTube + sistema de usuarios + nuevos endpoints MaguisTV style
// ¡MEJORADO con Respaldo en GitHub para Historial y Favoritos!

import express from "express";
import cors from "cors";
import fs from "fs";
import fetch from "node-fetch";
import path from "path";

const app = express();
app.use(cors());

// ------------------- GITHUB CONFIGURACIÓN DE RESPALDO -------------------
// ¡ASEGÚRATE de configurar las variables de entorno GITHUB_TOKEN y GITHUB_REPO!
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO; // Formato: 'usuario/nombre-del-repositorio'
const BACKUP_FILE_NAME = "users_data.json";

// 🔑 Claves de API (Obtenidas de Variables de Entorno/Secrets)
// Asegúrate de configurar TMDB_API_KEY y YOUTUBE_API_KEY en tus secretos/variables de entorno.
const TMDB_API_KEY = process.env.TMDB_API_KEY;
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

if (!TMDB_API_KEY) console.error("❌ ERROR: La variable de entorno TMDB_API_KEY no está configurada.");
if (!YOUTUBE_API_KEY) console.error("❌ ERROR: La variable de entorno YOUTUBE_API_KEY no está configurada.");


// 📂 Archivos locales (Mantenidos)
const PELIS_FILE = path.join(process.cwd(), "peliculas.json");
const USERS_FILE = path.join(process.cwd(), BACKUP_FILE_NAME);

// ------------------- DATOS DE APOYO DE RESPALDO -------------------

// Mapeo de géneros para TMDb (simplificado en español)
const TMDB_GENRES = {
  accion: 28,
  aventuras: 12,
  animacion: 16,
  comedia: 35,
  crimen: 80,
  documental: 99,
  drama: 18,
  familia: 10751,
  fantasia: 14,
  historia: 36,
  terror: 27,
  musica: 10402,
  misterio: 9648,
  romance: 10749,
  ciencia_ficcion: 878,
  thriller: 53,
  guerra: 10752,
  western: 37
};

// ------------------- FUNCIONES AUXILIARES -------------------

/** Limpia la URL de la película eliminando la duplicidad '/prepreview' para corregir a '/preview'. */
function cleanPeliculaUrl(url) {
  if (!url) return url;
  // Reemplaza '/prepreview' con '/preview' para corregir el error en la URL de Google Drive (o similar).
  // El $1 asegura que se mantenga cualquier parámetro de consulta (?...) o hash (#...).
  return url.replace(/\/prepreview([?#]|$)/, '/preview$1');
}

/** Formatea un resultado de TMDb al formato de película local. */
async function formatTmdbResult(pelicula) {
  if (!TMDB_API_KEY || !YOUTUBE_API_KEY) return null;

  try {
    // 1. Obtener detalles para los géneros
    const detallesUrl = `https://api.themoviedb.org/3/movie/${pelicula.id}?api_key=${TMDB_API_KEY}&language=es-ES`;
    const detallesResp = await fetch(detallesUrl);
    const detalles = await detallesResp.json();

    // 2. Buscar URL de película completa en YouTube
    const youtubeQuery = pelicula.title + " película completa español latino";
    const youtubeUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(youtubeQuery)}&key=${YOUTUBE_API_KEY}&type=video&maxResults=1`;
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
      generos: detalles.genres?.map(g => g.name).join(", ") || "",
      imagen_url: pelicula.poster_path
        ? `https://image.tmdb.org/t/p/w500${pelicula.poster_path}`
        : "",
      pelicula_url: youtubeId ? `https://www.youtube.com/watch?v=${youtubeId}` : null,
      respaldo: true
    };
  } catch (err) {
    console.error("❌ Error al obtener detalles o YouTube en formato de respaldo:", err.message);
    return null;
  }
}

/** Formatea MÚLTIPLES resultados de TMDb al formato local, SIN buscar detalles o YouTube (para evitar demoras). */
function formatTmdbSimpleResult(result, allGenres) {
  const genreNames = (result.genre_ids || [])
    .map(id => allGenres.find(g => g.id === id)?.name)
    .filter(Boolean)
    .join(", ");

  return {
    titulo: result.title,
    descripcion: result.overview || "",
    fecha_lanzamiento: result.release_date || "",
    idioma_original: result.original_language || "",
    puntuacion: result.vote_average || 0,
    popularidad: result.popularity || 0,
    generos: genreNames || "No disponible (Respaldo)",
    imagen_url: result.poster_path
      ? `https://image.tmdb.org/t/p/w500${result.poster_path}`
      : "",
    pelicula_url: null, // No se busca URL de YouTube para búsquedas avanzadas
    respaldo: true
  };
}


// ------------------- FUNCIONES DE GITHUB -------------------
// ... (Funciones getFileSha, saveUsersDataToGitHub, loadUsersDataFromGitHub sin cambios) ...

/** Obtiene el SHA de la última versión del archivo en GitHub, necesario para actualizar. */
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
    // Codificar el contenido en base64 para la API de GitHub
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
        sha: sha, // Se requiere el SHA para actualizar o se crea si es null
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
        'Accept': 'application/vnd.github.v3.raw', // Obtener el contenido crudo (raw)
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
// ... (Funciones de usuarios sin cambios) ...
function ensureUsersFile() {
  if (!fs.existsSync(USERS_FILE)) {
    console.log(`ℹ️ Creando archivo local: ${BACKUP_FILE_NAME}`);
    const initialData = JSON.stringify({ users: {} }, null, 2);
    fs.writeFileSync(USERS_FILE, initialData);
    // Respaldo inicial a GitHub al crear el archivo
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
  
  // Realizar el respaldo a GitHub de forma asíncrona
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


// ------------------- CONTROL DE INACTIVIDAD -------------------
let ultimaPeticion = Date.now();
const TIEMPO_INACTIVIDAD = 60 * 1000;

setInterval(async () => {
  if (Date.now() - ultimaPeticion >= TIEMPO_INACTIVIDAD) {
    console.log("🕒 Sin tráfico por 1 minuto. Iniciando cierre y respaldo final...");
    
    try {
      // 1. Leer el estado final desde el archivo local
      const data = readUsersData();
      const content = JSON.stringify(data, null, 2);
      
      // 2. Realizar el respaldo final a GitHub y ESPERAR su finalización
      const saved = await saveUsersDataToGitHub(content);
      
      console.log(`✅ Respaldo final ${saved ? 'exitoso' : 'fallido'}. Cerrando servidor.`);
    } catch (e) {
      console.error("❌ Error durante el cierre y respaldo final:", e.message);
    }
    
    // 3. Detener el proceso
    process.exit(0);
  }
}, 30 * 1000);

app.use((req, res, next) => {
  ultimaPeticion = Date.now();
  next();
});

// ------------------- RUTAS PRINCIPALES -------------------
app.get("/", (req, res) => {
  res.json({
    mensaje: "🎬 API de Películas funcionando correctamente",
    total: peliculas.length,
    ejemplo: "/peliculas o /peliculas/El%20Padrino"
  });
});

app.get("/peliculas", (req, res) => res.json(peliculas));

// RUTA MODIFICADA: Búsqueda por título con respaldo
app.get("/peliculas/:titulo", async (req, res) => {
  const tituloRaw = decodeURIComponent(req.params.titulo || "");
  const titulo = tituloRaw.toLowerCase();
  
  // 1. Búsqueda Local
  const resultado = peliculas.filter(p =>
    (p.titulo || "").toLowerCase().includes(titulo)
  );

  if (resultado.length > 0)
    return res.json({ fuente: "local", resultados: resultado });

  // 2. Búsqueda de Respaldo
  console.log(`🔎 No se encontró "${tituloRaw}" en el JSON. Buscando respaldo...`);
  try {
    const respaldo = await buscarPeliculaRespaldo(tituloRaw);
    if (respaldo) return res.json({ fuente: "respaldo", resultados: [respaldo] });
    else return res.json({ fuente: "local_y_respaldo", resultados: [] }); // Devolver resultados vacíos si no hay nada
  } catch (error) {
    console.error("❌ Error al buscar respaldo:", error);
    // Devolver resultados vacíos si hay un error en el respaldo
    res.json({ fuente: "error_respaldo", resultados: [] }); 
  }
});

// 🔎 RUTA MODIFICADA: Búsqueda avanzada con respaldo
app.get("/buscar", async (req, res) => { // Ahora es async
  const { año, genero, idioma, desde, hasta, q } = req.query;
  let resultados = peliculas;

  // 1. Búsqueda Local
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

  // 2. Fallback a Respaldo TMDb
  console.log("🔎 Búsqueda local sin resultados. Usando respaldo TMDb...");
  try {
    const backupResults = await buscarPeliculasRespaldoGenerico(req.query);
    return res.json({ 
      fuente: "respaldo", 
      total: backupResults.length, 
      resultados: backupResults 
    });
  } catch (error) {
    console.error("❌ Error al buscar respaldo en /buscar:", error.message);
    // Si falla el respaldo, devolvemos resultados vacíos para cumplir con "siempre debe de haber resultados"
    return res.json({ fuente: "error_respaldo", total: 0, resultados: [] });
  }
});

// ------------------- RUTAS DE USUARIOS -------------------
// ... (Rutas de usuarios sin cambios) ...
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
  const { titulo, imagen_url, pelicula_url: raw_pelicula_url } = req.query; // Capturar la URL cruda
  const pelicula_url = cleanPeliculaUrl(raw_pelicula_url); // Limpiar la URL
  
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

// **NUEVAS RUTAS DE ELIMINACIÓN DE FAVORITOS (Añadido)**

// ELIMINAR TODOS LOS FAVORITOS
app.get("/user/favorites/clear", (req, res) => {
  const email = (req.query.email || "").toLowerCase();
  if (!email) return res.status(400).json({ error: "Falta email" });
  
  const user = getOrCreateUser(email);
  if (!user) return res.status(404).json({ error: "Usuario no encontrado" });
  
  user.favorites = []; // Vaciar el array de favoritos
  saveUser(email, user);
  
  res.json({ ok: true, message: "Lista de favoritos eliminada." });
});

// ELIMINAR UNA PELÍCULA DE FAVORITOS
app.get("/user/favorites/remove", (req, res) => {
  const email = (req.query.email || "").toLowerCase();
  const raw_pelicula_url = req.query.pelicula_url;
  const pelicula_url = cleanPeliculaUrl(raw_pelicula_url);
  
  if (!email || !pelicula_url) 
    return res.status(400).json({ error: "Faltan email o pelicula_url" });
  
  const user = getOrCreateUser(email);
  if (!user) return res.status(404).json({ error: "Usuario no encontrado" });
  
  const initialLength = user.favorites.length;
  // Filtrar favoritos para excluir la película con esa URL
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
  const { titulo, pelicula_url: raw_pelicula_url, imagen_url } = req.query; // Capturar la URL cruda
  const pelicula_url = cleanPeliculaUrl(raw_pelicula_url); // Limpiar la URL
  
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

// **NUEVAS RUTAS DE ELIMINACIÓN DE HISTORIAL (Añadido)**

// ELIMINAR TODO EL HISTORIAL
app.get("/user/history/clear", (req, res) => {
  const email = (req.query.email || "").toLowerCase();
  if (!email) return res.status(400).json({ error: "Falta email" });
  
  const user = getOrCreateUser(email);
  if (!user) return res.status(404).json({ error: "Usuario no encontrado" });
  
  user.history = []; // Vaciar el array del historial
  saveUser(email, user);
  
  res.json({ ok: true, message: "Historial de películas eliminado." });
});

// ELIMINAR UNA PELÍCULA DEL HISTORIAL
app.get("/user/history/remove", (req, res) => {
  const email = (req.query.email || "").toLowerCase();
  const raw_pelicula_url = req.query.pelicula_url;
  const pelicula_url = cleanPeliculaUrl(raw_pelicula_url);
  
  if (!email || !pelicula_url) 
    return res.status(400).json({ error: "Faltan email o pelicula_url" });
  
  const user = getOrCreateUser(email);
  if (!user) return res.status(404).json({ error: "Usuario no encontrado" });
  
  const initialLength = user.history.length;
  // Filtrar el historial para excluir la película con esa URL
  user.history = user.history.filter(h => h.pelicula_url !== pelicula_url);
  
  if (user.history.length < initialLength) {
    saveUser(email, user);
    return res.json({ ok: true, message: "Película eliminada del historial." });
  }
  res.status(404).json({ ok: false, message: "Película no encontrada en el historial." });
});


// ------------------- NUEVOS ENDPOINTS -------------------
// ... (Rutas de refresh y perfil sin cambios, usan buscarPeliculaRespaldo) ...

// 🔁 Refrescar historial (uno o todos)
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

// 🔁 Refrescar favoritos (uno o todos)
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
    ultimaActividad:
      user.history[0]?.fecha || user.favorites[0]?.addedAt || "Sin actividad",
  };
  res.json({ perfil });
});

// 🧾 Actividad combinada
app.get("/user/activity", (req, res) => {
  const email = (req.query.email || "").toLowerCase();
  const user = getOrCreateUser(email);
  if (!user) return res.status(400).json({ error: "Usuario no encontrado" });

  const historial = user.history.map(h => ({
    tipo: "historial",
    titulo: h.titulo,
    fecha: h.fecha
  }));
  const favoritos = user.favorites.map(f => ({
    tipo: "favorito",
    titulo: f.titulo,
    fecha: f.addedAt
  }));
  const actividad = [...historial, ...favoritos].sort(
    (a, b) => new Date(b.fecha) - new Date(a.fecha)
  );

  res.json({ total: actividad.length, actividad });
});


// ------------------- RESPALDO TMDb + YouTube -------------------

/** Busca UNA película por título exacto en TMDb y la URL en YouTube. (Usado por /peliculas/:titulo y refresh) */
async function buscarPeliculaRespaldo(titulo) {
  if (!TMDB_API_KEY || !YOUTUBE_API_KEY) {
      console.error("❌ No se puede usar el respaldo: Faltan claves de API.");
      return null;
  }
  
  try {
    const url = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&language=es-ES&query=${encodeURIComponent(titulo)}`;
    const resp = await fetch(url);
    const data = await resp.json();
    if (!data.results || data.results.length === 0) return null;

    const pelicula = data.results[0];
    
    // Usamos el helper para obtener todos los detalles y el link de YouTube
    return await formatTmdbResult(pelicula);

  } catch (err) {
    console.error("❌ Error TMDb o YouTube:", err.message);
    return null;
  }
}

/** Busca MÚLTIPLES películas por criterios avanzados en TMDb. (Usado por /buscar) */
async function buscarPeliculasRespaldoGenerico(params) {
  if (!TMDB_API_KEY) {
      console.error("❌ No se puede usar el respaldo: Falta TMDB_API_KEY.");
      return [];
  }
  
  let url = '';
  let finalResults = [];
  
  try {
    const genreResp = await fetch(`https://api.themoviedb.org/3/genre/movie/list?api_key=${TMDB_API_KEY}&language=es-ES`);
    const genreData = await genreResp.json();
    const allGenres = genreData.genres || [];

    if (params.q) {
      // 1. Búsqueda por consulta de texto (título o descripción)
      const query = encodeURIComponent(params.q);
      url = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&language=es-ES&query=${query}&page=1`;
    } else if (params.genero || params.año || (params.desde && params.hasta)) {
      // 2. Búsqueda por descubrimiento (filtros avanzados)
      let discoverParams = '';
      
      if (params.genero) {
        // Encontrar ID del género
        const generoKey = String(params.genero).toLowerCase().replace(/\s/g, '_');
        const genreId = TMDB_GENRES[generoKey];
        if (genreId) {
          discoverParams += `&with_genres=${genreId}`;
        } else {
           console.log(`⚠️ Género ${params.genero} no encontrado en el mapa TMDB_GENRES.`);
        }
      }

      if (params.año) {
        discoverParams += `&primary_release_year=${params.año}`;
      } else if (params.desde && params.hasta) {
        discoverParams += `&primary_release_date.gte=${params.desde}-01-01&primary_release_date.lte=${params.hasta}-12-31`;
      }
      
      if (params.idioma) {
          // Nota: TMDb usa códigos ISO 639-1 (por ejemplo, 'es', 'en')
          // Asumimos que el usuario pasa un código de idioma válido o un nombre común
          const langCode = String(params.idioma).toLowerCase().slice(0, 2); 
          discoverParams += `&with_original_language=${langCode}`; 
      }

      url = `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_API_KEY}&language=es-ES&sort_by=popularity.desc&page=1${discoverParams}`;
    } else {
        // Si no hay parámetros de búsqueda válidos, busca populares como fallback final
        url = `https://api.themoviedb.org/3/movie/popular?api_key=${TMDB_API_KEY}&language=es-ES&page=1`;
    }

    const resp = await fetch(url);
    const data = await resp.json();
    
    if (data.results && data.results.length > 0) {
      // Mapear los resultados de TMDb al formato local simplificado
      finalResults = data.results.map(r => formatTmdbSimpleResult(r, allGenres));
    }

    return finalResults;

  } catch (err) {
    console.error("❌ Error en búsqueda avanzada de TMDb:", err.message);
    return [];
  }
}


// ------------------- INICIAR SERVIDOR -------------------
async function startServer() {
  // 1. Intentar cargar los datos de usuario desde GitHub
  await loadUsersDataFromGitHub();
  
  // 2. Iniciar el servidor
  const PORT = process.env.PORT || 8080;
  app.listen(PORT, () => console.log(`✅ Servidor corriendo en http://localhost:${PORT}`));
}

startServer();
