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

// ------------------- FUNCIONES AUXILIARES -------------------

/** Limpia la URL de la película eliminando la duplicidad '/prepreview' para corregir a '/preview'. */
function cleanPeliculaUrl(url) {
  if (!url) return url;
  // Reemplaza '/prepreview' con '/preview' para corregir el error en la URL de Google Drive (o similar).
  // El $1 asegura que se mantenga cualquier parámetro de consulta (?...) o hash (#...).
  return url.replace(/\/prepreview([?#]|$)/, '/preview$1');
}


// ------------------- FUNCIONES DE GITHUB -------------------

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
    else return res.status(404).json({ error: "Película no encontrada en respaldo." });
  } catch (error) {
    console.error("❌ Error al buscar respaldo:", error);
    res.status(500).json({ error: "Error al consultar respaldo externo." });
  }
});

// 🔎 Búsqueda avanzada
app.get("/buscar", async (req, res) => {
  const { año, genero, idioma, desde, hasta, q } = req.query;
  let resultados = peliculas;
  const queryOptions = { año, genero, idioma, desde, hasta };
  
  // 1. Búsqueda local (Existente)
  if (q) {
    const ql = q.toLowerCase();
    resultados = resultados.filter(p =>
      (p.titulo || "").toLowerCase().includes(ql) ||
      (p.descripcion || "").toLowerCase().includes(ql)
    );
  }

  // Filtrado avanzado local (Existente)
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

  // 2. Respaldo TMDb si no hay resultados locales (NUEVA FUNCIONALIDAD)
  console.log("🔎 No se encontraron resultados locales. Buscando respaldo en TMDb...");
  
  try {
    // Se usa 'q' para búsqueda por nombre/descripción, o 'queryOptions' para búsqueda avanzada.
    const resultadosRespaldo = await searchTMDB(q, queryOptions);
    
    if (resultadosRespaldo.length > 0) {
      return res.json({ 
        fuente: "respaldo", 
        total: resultadosRespaldo.length, 
        resultados: resultadosRespaldo 
      });
    }

    // Si no hay resultados, devolver total: 0.
    return res.status(200).json({ fuente: "local", total: 0, resultados: [] });
    
  } catch (error) {
    console.error("❌ Error al buscar en el respaldo TMDb:", error);
    res.status(500).json({ error: "Error al consultar respaldo externo." });
  }
});

// **NUEVO ENDPOINT** - Obtener detalles de la película (tipo MaguisTV) por ID de TMDb
app.get("/peliculas/details/:tmdb_id", async (req, res) => {
  const tmdb_id = req.params.tmdb_id;
  if (!tmdb_id) return res.status(400).json({ error: "Falta el parámetro tmdb_id" });

  try {
    // Usamos una lógica similar a buscarPeliculaRespaldo para obtener los detalles completos y la URL de YouTube.
    // El segundo parámetro (título) es un placeholder ya que la función puede obtenerlo con el ID.
    const resultado = await buscarDetallesYTrailerTMDb(tmdb_id); 
    
    if (resultado) {
      // El resultado ya está en el formato completo con la URL de YouTube (pelicula_url)
      return res.json({ fuente: "respaldo", resultados: [resultado] });
    }
    
    return res.status(404).json({ error: "Detalles de película no encontrados en respaldo." });
    
  } catch (error) {
    console.error("❌ Error al buscar detalles por ID en respaldo:", error);
    res.status(500).json({ error: "Error al consultar respaldo externo para detalles." });
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

/**
 * Función auxiliar para obtener detalles de TMDb y el tráiler de YouTube.
 * Esta se usa internamente por `buscarPeliculaRespaldo` y el nuevo endpoint `/peliculas/details/:tmdb_id`.
 */
async function buscarDetallesYTrailerTMDb(tmdb_id) {
  if (!TMDB_API_KEY || !YOUTUBE_API_KEY) {
    console.error("❌ No se puede usar el respaldo: Faltan claves de API.");
    return null;
  }
  
  try {
    // 1. Obtener detalles extendidos
    const detallesUrl = `https://api.themoviedb.org/3/movie/${tmdb_id}?api_key=${TMDB_API_KEY}&language=es-ES`;
    const detallesResp = await fetch(detallesUrl);
    const detalles = await detallesResp.json();

    if (!detalles || detalles.success === false) return null;
    
    // 2. Buscar tráiler/película completa en YouTube
    const youtubeQuery = detalles.title + " película completa español latino";
    const youtubeUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(youtubeQuery)}&key=${YOUTUBE_API_KEY}&type=video&maxResults=1`;
    const youtubeResp = await fetch(youtubeUrl);
    const youtubeData = await youtubeResp.json();
    const youtubeId = youtubeData.items?.[0]?.id?.videoId || null;

    return {
      titulo: detalles.title,
      descripcion: detalles.overview || "",
      fecha_lanzamiento: detalles.release_date || "",
      idioma_original: detalles.original_language || "",
      puntuacion: detalles.vote_average || 0,
      popularidad: detalles.popularity || 0,
      generos: detalles.genres?.map(g => g.name).join(", ") || "",
      imagen_url: detalles.poster_path
        ? `https://image.tmdb.org/t/p/w500${detalles.poster_path}`
        : "",
      pelicula_url: youtubeId ? `https://www.youtube.com/watch?v=${youtubeId}` : null, 
      tmdb_id: detalles.id, // Se añade el ID de TMDb
      respaldo: true
    };
  } catch (err) {
    console.error(`❌ Error TMDb o YouTube al obtener detalles para ID ${tmdb_id}:`, err.message);
    return null;
  }
}

/**
 * Búsqueda de una sola película por título en TMDb (Mantiene la función original).
 */
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
    
    // Se reutiliza la nueva función auxiliar
    return await buscarDetallesYTrailerTMDb(pelicula.id);

  } catch (err) {
    console.error("❌ Error TMDb o YouTube:", err.message);
    return null;
  }
}

/**
 * **NUEVA FUNCIÓN** - Realiza búsquedas generales o avanzadas en TMDb.
 */
async function searchTMDB(query, options = {}) {
    if (!TMDB_API_KEY) {
      console.error("❌ No se puede usar el respaldo: Falta TMDB_API_KEY.");
      return [];
    }

    let apiUrl = "";
    // Mapeo básico de géneros (solo se necesita para búsqueda avanzada de TMDb)
    const tmdbGenreMap = {
        accion: 28, aventuras: 12, animacion: 16, comedia: 35, crimen: 80,
        documental: 99, drama: 18, familia: 10751, fantasia: 14, historia: 36,
        terror: 27, musica: 10402, misterio: 9648, romance: 10749, cienciaficcion: 878,
        tv: 10770, thriller: 53, guerra: 10752, western: 37
    };
    
    const { año, genero, idioma, desde, hasta } = options;
    const genreId = genero ? tmdbGenreMap[genero.toLowerCase()] : null;

    if (query) {
      // Búsqueda por palabra clave (título o descripción) - Usa /search/movie
      apiUrl = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&language=es-ES&query=${encodeURIComponent(query)}`;
    } else {
      // Búsqueda avanzada/descubrimiento - Usa /discover/movie
      apiUrl = `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_API_KEY}&language=es-ES&sort_by=popularity.desc&include_adult=false&include_video=false&page=1`;
      
      if (año) {
          apiUrl += `&primary_release_year=${año}`;
      } else if (desde && hasta) {
          // Busca en el rango de fechas de lanzamiento
          apiUrl += `&primary_release_date.gte=${desde}-01-01&primary_release_date.lte=${hasta}-12-31`;
      }

      if (genreId) {
          apiUrl += `&with_genres=${genreId}`;
      }
      
      if (idioma) {
          // TMDB usa códigos ISO 639-1 (ej: es, en, fr)
          apiUrl += `&with_original_language=${idioma.toLowerCase().split('-')[0]}`;
      }
      
      // Filtros adicionales para obtener mejores resultados
      apiUrl += `&vote_count.gte=10`; 
    }
    
    if (!apiUrl) return [];

    try {
      const resp = await fetch(apiUrl);
      const data = await resp.json();
      
      if (!data.results || data.results.length === 0) return [];

      // Formatear resultados
      const formattedResults = data.results.filter(p => p.poster_path).map(p => ({
        titulo: p.title,
        descripcion: p.overview || "",
        año: p.release_date ? p.release_date.substring(0, 4) : null,
        idioma_original: p.original_language || "",
        puntuacion: p.vote_average || 0,
        popularidad: p.popularity || 0,
        // En búsqueda avanzada, solo se devuelven IDs.
        generos: p.genre_ids.join(", ") || "", 
        imagen_url: p.poster_path
          ? `https://image.tmdb.org/t/p/w500${p.poster_path}`
          : "",
        tmdb_id: p.id,
        // No se obtiene la URL de YouTube en esta búsqueda masiva para optimizar el rendimiento.
        pelicula_url: null, 
        respaldo: true
      }));
      
      // Devolver hasta 20 resultados
      return formattedResults.slice(0, 20); 

    } catch (err) {
      console.error("❌ Error en la búsqueda general de TMDb:", err.message);
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
