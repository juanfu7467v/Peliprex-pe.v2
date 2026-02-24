// index.js — API completa de Películas con respaldo TMDb + PeliPREX + YouTube + sistema de usuarios + nuevos endpoints MaguisTV style
// ¡MEJORADO con Respaldo en GitHub para Historial y Favoritos y NUEVAS BÚSQUEDAS DE RESPALDO!
// ✅ ACTUALIZADO: Sistema anti-duplicados en historial + Health Check automático de enlaces
// ✅ v2.0: Búsqueda paralela (Promise.all) + Integración TMDb→PeliPREX + Motor de búsqueda avanzado inteligente

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
if (!YOUTUBE_API_KEY) console.error("❌ ERROR: La variable de entorno YOUTUBE_API_KEY no está configurada.");

// 📂 Archivos locales
const PELIS_FILE = path.join(process.cwd(), "peliculas.json");
const USERS_FILE = path.join(process.cwd(), BACKUP_FILE_NAME);

// ------------------- FUNCIONES AUXILIARES (EXISTENTES - SIN CAMBIOS) -------------------

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
 * Verifica si una URL responde correctamente con una petición HEAD rápida.
 */
async function checkUrlHealth(url, timeout = 5000) {
  if (!url) return false;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    const response = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'follow'
    });
    clearTimeout(timeoutId);
    return response.ok || (response.status >= 200 && response.status < 400);
  } catch (error) {
    console.log(`⚠️ URL no disponible (${url}): ${error.message}`);
    return false;
  }
}

// Mapeo de categorías a IDs de Género de TMDb
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

// ------------------- FUNCIONES DE GITHUB (EXISTENTES - SIN CAMBIOS) -------------------

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
    console.log("⚠️ GitHub no configurado. Solo guardado local.");
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
      body: JSON.stringify({ message: commitMessage, content: contentBase64, sha }),
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
      console.log(`ℹ️ Archivo no encontrado en GitHub. Se creará nuevo archivo local.`);
      return false;
    }
    if (!resp.ok) {
      console.error(`❌ Error al cargar de GitHub (Status: ${resp.status}): ${await resp.text()}`);
      return false;
    }
    const content = await resp.text();
    fs.writeFileSync(USERS_FILE, content, 'utf8');
    console.log(`✅ Datos de usuario cargados desde GitHub.`);
    return true;
  } catch (error) {
    console.error("❌ Excepción al cargar de GitHub:", error.message);
    return false;
  }
}

// ------------------- CARGAR PELÍCULAS (EXISTENTE - SIN CAMBIOS) -------------------
let peliculas = [];
try {
  peliculas = JSON.parse(fs.readFileSync(PELIS_FILE, "utf8"));
  console.log(`✅ Cargadas ${peliculas.length} películas desde peliculas.json`);
} catch (err) {
  console.error("❌ Error cargando peliculas.json:", err.message);
  peliculas = [];
}

// ------------------- FUNCIONES DE USUARIOS (EXISTENTES - SIN CAMBIOS) -------------------
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

// ------------------- CONTROL DE INACTIVIDAD DEL SERVIDOR (EXISTENTE - SIN CAMBIOS) -------------------
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

// ------------------- TAREA PROGRAMADA: LIMPIEZA CADA 24 HRS (EXISTENTE - SIN CAMBIOS) -------------------
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
      console.log(`   [${email}] Historial: Eliminados ${historyLengthBefore - user.history.length} elementos (>24h).`);
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
      console.log(`   [${email}] Resumen: Eliminados ${resumeKeysBefore - resumeKeysAfter} elementos (>24h).`);
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


// ===================================================================
// ============ 🆕 NUEVAS FUNCIONES v2.0 — BÚSQUEDA PARALELA =========
// ===================================================================

/**
 * 🆕 MOTOR DE BÚSQUEDA AVANZADO
 * Analiza queries complejas y extrae metadatos estructurados.
 * Entiende: "las mejores películas de acción 2026", "estrenos de terror nuevos", etc.
 *
 * @param {string} q - Query de búsqueda en lenguaje natural.
 * @returns {{ keywords, year, genreId, isNew, isBest, originalQuery }}
 */
function parseAdvancedQuery(q) {
  if (!q) return { keywords: [], year: null, genreId: null, isNew: false, isBest: false, originalQuery: '' };

  // Normalizar quitando acentos para comparaciones más robustas
  const qNorm = q.toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  // 1. Detectar año (rango 1950–2029)
  const yearMatch = q.match(/\b(19[5-9]\d|20[0-2]\d)\b/);
  const year = yearMatch ? yearMatch[0] : null;

  // 2. Detectar novedades / estrenos
  const isNew = /nuevo|nueva|nuevas|nuevos|estreno|estrenos|reciente|recientes|ultimo|ultima|ultimos|ultimas|latest|new/.test(qNorm);

  // 3. Detectar "los mejores" / popularidad
  const isBest = /mejor|mejores|top|best|ranking|recomendad|populares/.test(qNorm);

  // 4. Detectar género (prioridad: frases compuestas primero)
  const generoKeywords = [
    ['ciencia ficcion',     878],
    ['terror psicologico',   27],
    ['comedia romantica',    35],
    ['accion militar',    10752],
    ['accion',              28], ['action',          28],
    ['comedia',             35], ['comedy',          35],
    ['terror',              27], ['horror',          27], ['miedo',    27],
    ['drama',               18],
    ['aventura',            12], ['adventure',       12],
    ['animacion',           16], ['animation',       16], ['anime',    16],
    ['romance',          10749], ['romantica',    10749], ['romantico', 10749],
    ['thriller',            53], ['suspenso',        53],
    ['fantasia',            14], ['fantasy',         14],
    ['familia',          10751], ['infantil',     10751], ['ninos',  10751],
    ['musical',          10402], ['musica',       10402],
    ['documental',          99], ['documentary',     99],
    ['crimen',              80], ['crime',           80], ['policial',  80],
    ['guerra',           10752], ['belica',       10752],
    ['western',             37], ['vaqueros',        37],
    ['misterio',          9648], ['mystery',       9648],
    ['superheroes',         28], ['marvel',          28],
    ['sci-fi',             878], ['scifi',          878], ['ficcion',  878],
  ];

  let detectedGenreId = null;
  for (const [keyword, id] of generoKeywords) {
    if (qNorm.includes(keyword)) {
      detectedGenreId = id;
      break;
    }
  }

  // 5. Extraer keywords significativas (sin stop words)
  const stopWords = new Set([
    'las', 'los', 'de', 'del', 'la', 'el', 'en', 'con', 'por', 'para', 'y', 'o', 'un', 'una',
    'mejores', 'mejor', 'nuevas', 'nuevos', 'nuevo', 'nueva', 'estrenos', 'estreno',
    'peliculas', 'pelicula', 'film', 'cine', 'ver', 'mirar', 'buscar',
    'quiero', 'dame', 'muestrame', 'top', 'best', 'buenas', 'mas', 'populares',
    'que', 'son', 'hay', 'cuales', 'recomiendas', 'recomienda'
  ]);

  const keywords = qNorm
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w));

  return { keywords, year, genreId: detectedGenreId, isNew, isBest, originalQuery: q };
}

/**
 * 🆕 OBTENER STREAM URL DE PELIPREX (para un título exacto de TMDb)
 * Diseñado para ser llamado en paralelo con Promise.all().
 * Timeout individual de 4s para no bloquear la respuesta global.
 *
 * @param {string} titulo - Título exacto (preferiblemente de TMDb).
 * @param {number} timeoutMs - Timeout máximo en ms (default 4000).
 * @returns {Promise<string|null>} - URL de stream o null.
 */
async function obtenerStreamUrlDePeliPREX(titulo, timeoutMs = 4000) {
  if (!titulo) return null;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const url = `https://peliprex.fly.dev/search?q=${encodeURIComponent(titulo)}`;
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data.results || data.results.length === 0) return null;

    // Prioridad: coincidencia exacta → parcial → primer resultado
    const tituloLower = titulo.toLowerCase();
    const exactMatch   = data.results.find(r => (r.title || '').toLowerCase() === tituloLower);
    const partialMatch = data.results.find(r =>
      (r.title || '').toLowerCase().includes(tituloLower) ||
      tituloLower.includes((r.title || '').toLowerCase())
    );
    const bestMatch = exactMatch || partialMatch || data.results[0];

    return bestMatch?.videoUrl || bestMatch?.stream_url || bestMatch?.url || null;
  } catch {
    return null; // Silencioso: timeout o error de red
  }
}

/**
 * 🆕 BÚSQUEDA LOCAL AVANZADA
 * Busca en peliculas.json por título, descripción, año y keywords extraídas.
 * Soporta queries complejas en lenguaje natural.
 *
 * @param {string|null} query - Query de búsqueda.
 * @param {{ año, genero, idioma, desde, hasta }} options - Filtros adicionales.
 * @returns {Array} - Array de películas coincidentes.
 */
function buscarEnLocalFiltrado(query, options = {}) {
  const { año, genero, idioma, desde, hasta } = options;
  let resultados = peliculas;

  if (query) {
    const parsed  = parseAdvancedQuery(query);
    const ql      = query.toLowerCase();
    const qlNorm  = ql.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    resultados = resultados.filter(p => {
      const titulo     = (p.titulo      || '').toLowerCase();
      const desc       = (p.descripcion || '').toLowerCase();
      const tituloNorm = titulo.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const descNorm   = desc.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

      return (
        titulo.includes(ql) ||
        desc.includes(ql)   ||
        tituloNorm.includes(qlNorm) ||
        descNorm.includes(qlNorm)   ||
        (parsed.year && String(p.año) === String(parsed.year)) ||
        parsed.keywords.some(kw => tituloNorm.includes(kw) || descNorm.includes(kw))
      );
    });

    // Si se detectó un año en la query y no hay filtro de año explícito, refinarlo
    if (parsed.year && !año) {
      const yearFiltered = resultados.filter(p => String(p.año) === String(parsed.year));
      if (yearFiltered.length > 0) resultados = yearFiltered;
    }
  }

  if (año)          resultados = resultados.filter(p => String(p.año) === String(año));
  if (genero)       resultados = resultados.filter(p => (p.generos || '').toLowerCase().includes(String(genero).toLowerCase()));
  if (idioma)       resultados = resultados.filter(p => (p.idioma_original || '').toLowerCase() === String(idioma).toLowerCase());
  if (desde && hasta) resultados = resultados.filter(p => parseInt(p.año) >= parseInt(desde) && parseInt(p.año) <= parseInt(hasta));

  return resultados;
}

/**
 * 🆕 BÚSQUEDA TMDb + ENRIQUECIMIENTO PARALELO CON PELIPREX
 *
 * Flujo:
 *  1. Consulta TMDb (search/movie o discover/movie según parámetros).
 *  2. Para CADA resultado de TMDb, busca su stream_url en PeliPREX usando el
 *     TÍTULO EXACTO de TMDb — todas las búsquedas ocurren EN PARALELO con Promise.all().
 *  3. Devuelve solo los resultados que tienen URL válida.
 *
 * ⚡ Tiempo total ≈ tiempo del request MÁS LENTO (no la suma de todos).
 *
 * @param {string|null} query - Texto de búsqueda (puede ser null para discover).
 * @param {{ year, genreId, desde, hasta, isNew, isBest, sort_by, page }} options
 * @returns {Promise<Array>} - Array de películas enriquecidas con stream_url.
 */
async function buscarTMDbConPeliPREX(query, options = {}) {
  if (!TMDB_API_KEY) return [];

  const {
    year, genreId, desde, hasta,
    isNew    = false,
    isBest   = false,
    sort_by  = 'popularity.desc',
    page     = 1
  } = options;

  const currentYear = new Date().getFullYear();
  let tmdbUrl;

  // Decidir entre búsqueda textual o discover
  if (query && !genreId && !isNew && !isBest && !desde && !hasta) {
    tmdbUrl = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&language=es-ES&query=${encodeURIComponent(query)}&page=${page}`;
    if (year) tmdbUrl += `&year=${year}`;
  } else {
    let discoverParams = `&sort_by=${isBest ? 'vote_average.desc' : sort_by}&page=${page}`;
    if (genreId)  discoverParams += `&with_genres=${genreId}`;
    if (year)     discoverParams += `&primary_release_year=${year}`;
    if (desde)    discoverParams += `&primary_release_date.gte=${desde}-01-01`;
    if (hasta)    discoverParams += `&primary_release_date.lte=${hasta}-12-31`;
    if (isNew && !year && !desde) discoverParams += `&primary_release_date.gte=${currentYear - 1}-01-01`;
    if (isBest)   discoverParams += `&vote_count.gte=50`;
    tmdbUrl = `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_API_KEY}&language=es-ES${discoverParams}`;
  }

  try {
    const tmdbResp = await fetch(tmdbUrl);
    if (!tmdbResp.ok) {
      console.error(`❌ TMDb respondió con status ${tmdbResp.status}`);
      return [];
    }
    const tmdbData = await tmdbResp.json();
    if (!tmdbData.results || tmdbData.results.length === 0) return [];

    const topResults = tmdbData.results.slice(0, 10);

    // ⚡ BÚSQUEDA EN PARALELO: todos los requests a PeliPREX al mismo tiempo
    console.log(`⚡ [PARALELO] Enriqueciendo ${topResults.length} resultados TMDb con PeliPREX simultáneamente...`);
    const t0 = Date.now();

    const enriched = await Promise.all(
      topResults.map(async (pelicula) => {
        if (!pelicula.title) return null;

        // Usar el TÍTULO EXACTO de TMDb para buscar en PeliPREX
        const streamUrl = await obtenerStreamUrlDePeliPREX(pelicula.title);
        if (!streamUrl) return null;

        return {
          titulo:           pelicula.title,
          descripcion:      pelicula.overview        || '',
          fecha_lanzamiento: pelicula.release_date   || '',
          año:              pelicula.release_date ? pelicula.release_date.substring(0, 4) : '',
          idioma_original:  pelicula.original_language || '',
          puntuacion:       pelicula.vote_average    || 0,
          popularidad:      pelicula.popularity      || 0,
          generos_ids:      pelicula.genre_ids       || [],
          imagen_url:       pelicula.poster_path
            ? `https://image.tmdb.org/t/p/w500${pelicula.poster_path}`
            : '',
          pelicula_url: streamUrl,
          fuente_url:   'peliprex',
          respaldo:     true
        };
      })
    );

    const validos = enriched.filter(r => r !== null);
    console.log(`✅ [PARALELO] TMDb+PeliPREX completado en ${Date.now() - t0}ms → ${validos.length}/${topResults.length} con URL válida`);
    return validos;

  } catch (err) {
    console.error('❌ Error en buscarTMDbConPeliPREX:', err.message);
    return [];
  }
}

/**
 * 🆕 DEDUPLICAR RESULTADOS
 * Combina dos arrays de películas eliminando duplicados por título normalizado.
 * Los resultados locales tienen prioridad sobre los remotos.
 *
 * @param {Array} locales  - Resultados de peliculas.json.
 * @param {Array} remotos  - Resultados de TMDb+PeliPREX.
 * @returns {Array} - Array combinado sin duplicados.
 */
function deduplicarResultados(locales = [], remotos = []) {
  const normTitle = t => (t || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

  const combined = [...locales];
  const titulosExistentes = new Set(locales.map(p => normTitle(p.titulo)));

  for (const pelicula of remotos) {
    const tn = normTitle(pelicula.titulo);
    if (!titulosExistentes.has(tn)) {
      combined.push(pelicula);
      titulosExistentes.add(tn);
    }
  }
  return combined;
}

/**
 * 🆕 ORQUESTADOR DE BÚSQUEDA PARALELA PRINCIPAL
 *
 * Ejecuta simultáneamente:
 *  - Búsqueda local en peliculas.json (instantánea)
 *  - Búsqueda en TMDb + enriquecimiento con PeliPREX (red)
 *
 * Garantiza respuesta máxima de 5 segundos con timeout de seguridad.
 * Combina y deduplica los resultados de ambas fuentes.
 *
 * @param {string|null} query   - Query de búsqueda.
 * @param {{ año, genero, idioma, desde, hasta }} options - Filtros.
 * @returns {Promise<Array>} - Resultados combinados y deduplicados.
 */
async function buscarParalelo(query, options = {}) {
  const { año, genero, idioma, desde, hasta } = options;

  const parsed = query
    ? parseAdvancedQuery(query)
    : { year: null, genreId: null, keywords: [], isNew: false, isBest: false };

  const searchYear    = parsed.year || año;
  const generoKey     = genero ? String(genero).toLowerCase() : null;
  const searchGenreId = parsed.genreId || (generoKey ? TMDB_GENRE_MAP[generoKey] : null);

  const TIMEOUT_MS = 4800; // Límite de seguridad < 5 s

  console.log(`⚡ [PARALELO] Búsqueda dual iniciada → "${query || genero || '(sin query)'}"`);
  const t0 = Date.now();

  // ⚡ Las dos búsquedas arrancan SIMULTÁNEAMENTE
  const searchPromise = Promise.all([
    Promise.resolve(
      buscarEnLocalFiltrado(query, { año: searchYear, genero, idioma, desde, hasta })
    ),
    buscarTMDbConPeliPREX(query, {
      year:    searchYear,
      genreId: searchGenreId,
      desde,
      hasta,
      isNew:  parsed.isNew,
      isBest: parsed.isBest
    })
  ]);

  // Timeout de seguridad global
  const timeoutPromise = new Promise(resolve =>
    setTimeout(() => {
      console.warn(`⏱️ [PARALELO] Timeout de ${TIMEOUT_MS}ms alcanzado. Devolviendo lo que haya.`);
      resolve([[], []]);
    }, TIMEOUT_MS)
  );

  const [localResults, tmdbResults] = await Promise.race([searchPromise, timeoutPromise]);

  console.log(`✅ [PARALELO] Finalizado en ${Date.now() - t0}ms → local:${localResults.length} tmdb:${tmdbResults.length}`);

  return deduplicarResultados(localResults, tmdbResults);
}

// ===================================================================
// ===================== RUTAS PRINCIPALES ===========================
// ===================================================================

app.get("/", (req, res) => {
  res.json({
    mensaje: "🎬 API de Películas funcionando correctamente",
    total: peliculas.length,
    ejemplo: "/peliculas o /peliculas/El%20Padrino",
    version: "2.0 — Búsqueda paralela activa"
  });
});

app.get("/peliculas", (req, res) => res.json(peliculas));

// ─── 🆕 MEJORADO v2.0: /peliculas/:titulo ─────────────────────────────────────
// Búsqueda paralela: local + TMDb+PeliPREX al mismo tiempo.
// Validación de URLs locales también en paralelo.
// Fallback final → buscarPeliculaRespaldo (TMDb + YouTube).
app.get("/peliculas/:titulo", async (req, res) => {
  const tituloRaw   = decodeURIComponent(req.params.titulo || "");
  const tituloLower = tituloRaw.toLowerCase();

  console.log(`🔍 [v2.0] /peliculas/:titulo → "${tituloRaw}"`);
  const t0 = Date.now();

  try {
    // ⚡ PASO 1 — PARALELO: local Y TMDb+PeliPREX al mismo tiempo
    const [localResults, tmdbResults] = await Promise.all([
      Promise.resolve(
        peliculas.filter(p => (p.titulo || '').toLowerCase().includes(tituloLower))
      ),
      buscarTMDbConPeliPREX(tituloRaw, {})
    ]);

    // ⚡ PASO 2 — Validar URLs locales EN PARALELO
    if (localResults.length > 0) {
      const localConUrl = localResults.filter(p => p.pelicula_url);
      if (localConUrl.length > 0) {
        const validaciones = await Promise.all(
          localConUrl.map(p => checkUrlHealth(p.pelicula_url, 3000))
        );
        const validLocal = localConUrl.filter((_, i) => validaciones[i]);

        if (validLocal.length > 0) {
          console.log(`✅ Encontrada en local (${Date.now() - t0}ms)`);
          return res.json({ fuente: 'local', resultados: validLocal });
        }
        console.log(`⚠️ URLs locales inaccesibles. Usando resultado TMDb+PeliPREX...`);
      }
    }

    // PASO 3 — Resultados de TMDb+PeliPREX
    if (tmdbResults.length > 0) {
      console.log(`✅ Encontrada vía TMDb+PeliPREX (${Date.now() - t0}ms)`);
      return res.json({ fuente: 'tmdb_peliprex', resultados: tmdbResults });
    }

    // PASO 4 — Fallback final: TMDb + YouTube
    console.log(`🔎 Sin resultado TMDb+PeliPREX. Probando respaldo YouTube...`);
    const respaldo = await buscarPeliculaRespaldo(tituloRaw);
    if (respaldo && respaldo.pelicula_url) {
      const isValid = await checkUrlHealth(respaldo.pelicula_url, 3000);
      if (isValid) {
        console.log(`✅ Encontrada en respaldo YouTube (${Date.now() - t0}ms)`);
        return res.json({ fuente: 'respaldo', resultados: [respaldo] });
      }
    }

    console.log(`❌ No encontrada: "${tituloRaw}" (${Date.now() - t0}ms)`);
    return res.status(404).json({
      fuente: 'ninguna', total: 0, resultados: [],
      error: 'No se encontraron enlaces disponibles para esta película en ninguna fuente.'
    });

  } catch (error) {
    console.error('❌ Error en /peliculas/:titulo:', error.message);
    res.status(500).json({ error: 'Error interno al buscar la película.' });
  }
});

// ─── 🆕 MEJORADO v2.0: /buscar ────────────────────────────────────────────────
// Motor de búsqueda avanzado: interpreta queries complejas en lenguaje natural.
// Búsqueda paralela: local + TMDb+PeliPREX simultáneamente.
// Combina y deduplica resultados de ambas fuentes.
app.get("/buscar", async (req, res) => {
  const { año, genero, idioma, desde, hasta, q } = req.query;

  console.log(`🔍 [v2.0] /buscar → q="${q || ''}" año=${año || '-'} genero=${genero || '-'}`);
  const t0 = Date.now();

  try {
    // ⚡ BÚSQUEDA PARALELA PRINCIPAL
    const resultados = await buscarParalelo(q, { año, genero, idioma, desde, hasta });

    if (resultados.length > 0) {
      const locales  = resultados.filter(r => !r.respaldo);
      const remotos  = resultados.filter(r =>  r.respaldo);
      const fuente   = locales.length > 0 && remotos.length > 0
        ? 'combinado'
        : (locales.length > 0 ? 'local' : 'remoto');

      console.log(`✅ Búsqueda completada en ${Date.now() - t0}ms → ${resultados.length} resultados [${fuente}]`);
      return res.json({ fuente, total: resultados.length, resultados });
    }

    // Fallback final: TMDb + YouTube
    if (q) {
      console.log(`🔎 Sin resultados paralelos. Probando respaldo YouTube para "${q}"...`);
      const respaldo = await buscarPeliculaRespaldo(q);
      if (respaldo && respaldo.pelicula_url) {
        return res.json({ fuente: 'respaldo', total: 1, resultados: [respaldo] });
      }
    }

    console.log(`ℹ️ Sin resultados (${Date.now() - t0}ms)`);
    res.json({
      fuente: 'ninguna', total: 0, resultados: [],
      error: 'No se encontraron películas con los criterios de búsqueda, ni localmente ni en el respaldo.'
    });

  } catch (error) {
    console.error('❌ Error en /buscar:', error.message);
    res.status(500).json({ error: 'Error interno en la búsqueda.' });
  }
});

// ─── 🆕 MEJORADO v2.0: /peliculas/categoria/:genero ──────────────────────────
// Búsqueda por categoría con paralelo: local + TMDb+PeliPREX simultáneamente.
// Combina y deduplica; fallback a buscarEnPeliPREX si ambas fuentes fallan.
app.get("/peliculas/categoria/:genero", async (req, res) => {
  const generoRaw    = decodeURIComponent(req.params.genero || "");
  const generoBuscado = generoRaw.toLowerCase();

  console.log(`🔍 [v2.0] /peliculas/categoria/:genero → "${generoRaw}"`);
  const t0 = Date.now();

  const tmdb_genre_id = TMDB_GENRE_MAP[generoBuscado] || null;

  try {
    // ⚡ PARALELO: local + TMDb+PeliPREX por género al mismo tiempo
    const [localResults, tmdbResults] = await Promise.all([
      Promise.resolve(
        peliculas.filter(p => (p.generos || '').toLowerCase().includes(generoBuscado))
      ),
      tmdb_genre_id
        ? buscarTMDbConPeliPREX(null, { genreId: tmdb_genre_id, sort_by: 'vote_count.desc' })
        : buscarTMDbConPeliPREX(generoRaw, {}) // Fallback: búsqueda por texto si no hay genre_id
    ]);

    const combined = deduplicarResultados(localResults, tmdbResults);

    if (combined.length > 0) {
      console.log(`✅ Categoría completada en ${Date.now() - t0}ms → ${combined.length} resultados`);
      return res.json({
        fuente: 'combinado',
        total: combined.length,
        resultados: shuffleArray(combined)
      });
    }

    // Fallback: buscarEnPeliPREX directo (búsqueda por nombre de género)
    console.log(`🔎 Sin resultados combinados. Probando PeliPREX directo para "${generoRaw}"...`);
    const peliprexData = await buscarEnPeliPREX(generoRaw);
    if (peliprexData) {
      console.log(`✅ Resultado encontrado en PeliPREX para categoría "${generoRaw}".`);
      return res.json({ fuente: 'peliprex', total: peliprexData.count, ...peliprexData });
    }

    return res.json({
      fuente: 'ninguna', total: 0, resultados: [],
      error: 'No se encontraron películas en esta categoría.'
    });

  } catch (error) {
    console.error('❌ Error en /peliculas/categoria:', error.message);
    res.status(500).json({ error: 'Error al buscar la categoría.' });
  }
});


// ===================================================================
// =================== RUTAS DE USUARIOS (SIN CAMBIOS) ===============
// ===================================================================

app.get("/user/get", (req, res) => {
  const email = (req.query.email || "").toLowerCase();
  if (!email) return res.status(400).json({ error: "Falta parámetro email" });
  res.json(getOrCreateUser(email));
});

app.get("/user/setplan", (req, res) => {
  const email   = (req.query.email || "").toLowerCase();
  const tipoPlan = req.query.tipoPlan;
  const credits  = req.query.credits ? parseInt(req.query.credits) : undefined;
  if (!email || !tipoPlan) return res.status(400).json({ error: "Falta email o tipoPlan" });
  const user = getOrCreateUser(email);
  user.tipoPlan = tipoPlan;
  if (typeof credits === "number") user.credits = credits;
  saveUser(email, user);
  res.json({ ok: true, user });
});

// Favoritos
app.get("/user/add_favorite", (req, res) => {
  const email       = (req.query.email || "").toLowerCase();
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
  const email        = (req.query.email || "").toLowerCase();
  const pelicula_url = cleanPeliculaUrl(req.query.pelicula_url);
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
  const email        = (req.query.email || "").toLowerCase();
  const { titulo, pelicula_url: raw_pelicula_url, imagen_url } = req.query;
  const pelicula_url = cleanPeliculaUrl(raw_pelicula_url);
  if (!email || !titulo || !pelicula_url)
    return res.status(400).json({ error: "Faltan parámetros" });
  const user = getOrCreateUser(email);
  const existingIndex = user.history.findIndex(h => h.pelicula_url === pelicula_url);
  if (existingIndex !== -1) {
    user.history.splice(existingIndex, 1);
    console.log(`🔄 Película "${titulo}" movida al inicio del historial.`);
  }
  user.history.unshift({ titulo, pelicula_url, imagen_url, fecha: new Date().toISOString() });
  if (user.history.length > 200) user.history = user.history.slice(0, 200);
  saveUser(email, user);
  res.json({
    ok: true,
    total: user.history.length,
    message: existingIndex !== -1 ? "Película movida al inicio del historial" : "Película agregada al historial"
  });
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
  const email        = (req.query.email || "").toLowerCase();
  const pelicula_url = cleanPeliculaUrl(req.query.pelicula_url);
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

// Refrescar historial
app.get("/user/history/refresh", async (req, res) => {
  const email  = (req.query.email || "").toLowerCase();
  const titulo = req.query.titulo || null;
  const user   = getOrCreateUser(email);
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

// Refrescar favoritos
app.get("/user/favorites/refresh", async (req, res) => {
  const email  = (req.query.email || "").toLowerCase();
  const titulo = req.query.titulo || null;
  const user   = getOrCreateUser(email);
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

// Perfil
app.get("/user/profile", (req, res) => {
  const email = (req.query.email || "").toLowerCase();
  const user  = getOrCreateUser(email);
  if (!user) return res.status(400).json({ error: "Usuario no encontrado" });
  res.json({
    perfil: {
      email:            user.email,
      tipoPlan:         user.tipoPlan,
      credits:          user.credits,
      totalFavoritos:   user.favorites.length,
      totalHistorial:   user.history.length,
      ultimaActividad:  user.history[0]?.fecha || user.favorites[0]?.addedAt || "Sin actividad",
      ultimaActividadHeartbeat: user.lastActivityTimestamp || "Sin latidos",
    }
  });
});

// Actividad
app.get("/user/activity", (req, res) => {
  const email = (req.query.email || "").toLowerCase();
  const user  = getOrCreateUser(email);
  if (!user) return res.status(400).json({ error: "Usuario no encontrado" });
  const historial  = user.history.map(h  => ({ tipo: "historial",            titulo: h.titulo, fecha: h.fecha }));
  const favoritos  = user.favorites.map(f => ({ tipo: "favorito",             titulo: f.titulo, fecha: f.addedAt }));
  const resumen    = Object.values(user.resume).map(r => ({
    tipo:         "reproduccion_resumen",
    titulo:       r.titulo,
    fecha:        r.lastHeartbeat,
    progreso:     `${Math.round((r.currentTime / r.totalDuration) * 100)}%`,
    vistaCompleta: r.isComplete,
  }));
  const actividad = [...historial, ...favoritos, ...resumen].sort(
    (a, b) => new Date(b.fecha) - new Date(a.fecha)
  );
  res.json({ total: actividad.length, actividad });
});

// ------------------- ENDPOINTS DE STREAMING (LATIDOS) (SIN CAMBIOS) -------------------

app.get("/user/heartbeat", (req, res) => {
  const email         = (req.query.email || "").toLowerCase();
  const pelicula_url  = cleanPeliculaUrl(req.query.pelicula_url);
  const currentTime   = parseInt(req.query.currentTime);
  const totalDuration = parseInt(req.query.totalDuration);
  const titulo        = req.query.titulo;

  if (!email || !pelicula_url || isNaN(currentTime) || isNaN(totalDuration) || !titulo) {
    return res.status(400).json({ error: "Faltan parámetros válidos." });
  }

  const user = getOrCreateUser(email);
  user.lastActivityTimestamp = new Date().toISOString();

  const percentage             = (currentTime / totalDuration) * 100;
  const IS_COMPLETE_THRESHOLD  = 90;
  const isComplete             = percentage >= IS_COMPLETE_THRESHOLD;

  user.resume[pelicula_url] = {
    titulo, pelicula_url, currentTime, totalDuration,
    percentage: Math.round(percentage),
    isComplete,
    lastHeartbeat: new Date().toISOString()
  };

  saveUser(email, user);
  res.json({ ok: true, message: "Latido registrado.", progress: user.resume[pelicula_url] });
});

app.get("/user/consume_credit", (req, res) => {
  const email        = (req.query.email || "").toLowerCase();
  const pelicula_url = cleanPeliculaUrl(req.query.pelicula_url);

  if (!email || !pelicula_url)
    return res.status(400).json({ error: "Faltan parámetros." });

  const user = getOrCreateUser(email);

  if (user.tipoPlan !== 'creditos') {
    return res.json({
      ok: true, consumed: false,
      message: `El plan '${user.tipoPlan}' no requiere consumo de crédito.`
    });
  }

  const resumeEntry = user.resume[pelicula_url];
  if (!resumeEntry)
    return res.status(404).json({ ok: false, consumed: false, message: "No se encontró resumen de reproducción." });

  if (!resumeEntry.isComplete)
    return res.json({ ok: false, consumed: false, progress: resumeEntry.percentage, message: "Película no vista completamente (requiere >90%)." });

  if (user.credits <= 0)
    return res.json({ ok: false, consumed: false, message: "Créditos insuficientes." });

  user.credits -= 1;
  resumeEntry.creditConsumed = true;
  saveUser(email, user);

  res.json({ ok: true, consumed: true, remaining_credits: user.credits, message: "Crédito consumido exitosamente." });
});


// ===================================================================
// ======= FUNCIONES DE RESPALDO (EXISTENTES - SIN CAMBIOS) =========
// ===================================================================

/**
 * Búsqueda TMDb + YouTube para un solo título (respaldo final).
 * Se usa en: /peliculas/:titulo (paso 4), /user/history/refresh, /user/favorites/refresh.
 */
async function buscarPeliculaRespaldo(titulo) {
  if (!TMDB_API_KEY || !YOUTUBE_API_KEY) {
    console.error("❌ No se puede usar el respaldo: Faltan claves de API.");
    return null;
  }
  try {
    const url  = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&language=es-ES&query=${encodeURIComponent(titulo)}`;
    const resp = await fetch(url);
    const data = await resp.json();
    if (!data.results || data.results.length === 0) return null;

    const pelicula    = data.results[0];
    const detallesUrl = `https://api.themoviedb.org/3/movie/${pelicula.id}?api_key=${TMDB_API_KEY}&language=es-ES`;
    const detallesResp = await fetch(detallesUrl);
    const detalles     = await detallesResp.json();

    const year         = pelicula.release_date ? ` (${pelicula.release_date.substring(0, 4)})` : '';
    const youtubeQuery = `${pelicula.title}${year} película completa español latino`;
    const youtubeUrl   = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(youtubeQuery)}&key=${YOUTUBE_API_KEY}&type=video&maxResults=1`;
    const youtubeResp  = await fetch(youtubeUrl);
    const youtubeData  = await youtubeResp.json();
    const youtubeId    = youtubeData.items?.[0]?.id?.videoId || null;

    return {
      titulo:            pelicula.title,
      descripcion:       pelicula.overview         || "",
      fecha_lanzamiento: pelicula.release_date      || "",
      idioma_original:   pelicula.original_language || "",
      puntuacion:        pelicula.vote_average       || 0,
      popularidad:       pelicula.popularity         || 0,
      generos:           detalles.genres?.map(g => g.name).join(", ") || "",
      imagen_url: pelicula.poster_path
        ? `https://image.tmdb.org/t/p/w500${pelicula.poster_path}`
        : "",
      pelicula_url: youtubeId ? `https://www.youtube.com/watch?v=${youtubeId}` : null,
      respaldo: true
    };
  } catch (err) {
    console.error("❌ Error TMDb o YouTube:", err.message);
    return null;
  }
}

/**
 * Búsqueda general en TMDb (para listas/categorías).
 * Mantenida por compatibilidad — ahora se prefiere buscarTMDbConPeliPREX.
 */
async function searchTMDb(params) {
  if (!TMDB_API_KEY || !YOUTUBE_API_KEY) return [];

  const { query, genre_id, primary_release_year, release_date_gte, release_date_lte, sort_by = 'popularity.desc', page = 1 } = params;
  let url = '';

  if (query) {
    url = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&language=es-ES&query=${encodeURIComponent(query)}&page=${page}`;
  } else if (genre_id || primary_release_year || release_date_gte || release_date_lte) {
    let discoverParams = `&sort_by=${sort_by}&page=${page}`;
    if (genre_id)              discoverParams += `&with_genres=${genre_id}`;
    if (primary_release_year)  discoverParams += `&primary_release_year=${primary_release_year}`;
    if (release_date_gte)      discoverParams += `&primary_release_date.gte=${release_date_gte}`;
    if (release_date_lte)      discoverParams += `&primary_release_date.lte=${release_date_lte}`;
    url = `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_API_KEY}&language=es-ES${discoverParams}`;
  } else {
    return [];
  }

  try {
    const resp = await fetch(url);
    const data = await resp.json();
    if (!data.results || data.results.length === 0) return [];

    const resultsToEnrich = data.results.slice(0, 10);
    const enrichedResults = [];

    for (const pelicula of resultsToEnrich) {
      if (!pelicula.title) continue;
      const year         = pelicula.release_date ? pelicula.release_date.substring(0, 4) : '';
      const youtubeQuery = `${pelicula.title} ${year} película completa español latino`;
      const youtubeUrl   = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(youtubeQuery)}&key=${YOUTUBE_API_KEY}&type=video&maxResults=1`;
      const youtubeResp  = await fetch(youtubeUrl);
      const youtubeData  = await youtubeResp.json();
      const youtubeId    = youtubeData.items?.[0]?.id?.videoId || null;
      enrichedResults.push({
        titulo:            pelicula.title,
        descripcion:       pelicula.overview         || "",
        fecha_lanzamiento: pelicula.release_date      || "",
        idioma_original:   pelicula.original_language || "",
        puntuacion:        pelicula.vote_average       || 0,
        generos_ids:       pelicula.genre_ids          || [],
        imagen_url: pelicula.poster_path
          ? `https://image.tmdb.org/t/p/w500${pelicula.poster_path}`
          : "",
        pelicula_url: youtubeId ? `https://www.youtube.com/watch?v=${youtubeId}` : null,
        respaldo: true
      });
    }
    return enrichedResults.filter(p => p.pelicula_url);
  } catch (err) {
    console.error("❌ Error en searchTMDb:", err.message);
    return [];
  }
}

/**
 * Búsqueda en la API de PeliPREX (existente - sin cambios).
 * Devuelve el resultado completo con count, results y porCapitulos.
 */
async function buscarEnPeliPREX(query) {
  try {
    const url  = `https://peliprex.fly.dev/search?q=${encodeURIComponent(query)}`;
    console.log(`📡 Buscando en PeliPREX: "${query}"...`);
    const resp = await fetch(url);

    if (!resp.ok) {
      console.error(`❌ PeliPREX respondió con status ${resp.status}`);
      return null;
    }

    const data = await resp.json();
    if (!data.results || data.results.length === 0) {
      console.log(`ℹ️ PeliPREX no encontró resultados para "${query}".`);
      return null;
    }

    const porCapitulos = {};
    for (const item of data.results) {
      const key = (item.title || "Sin título").trim();
      if (!porCapitulos[key]) porCapitulos[key] = [];
      porCapitulos[key].push(item);
    }

    const hayCapitulos =
      Object.keys(porCapitulos).length > 1 ||
      Object.values(porCapitulos).some(v => v.length > 1);

    return {
      count:   data.count,
      results: data.results,
      ...(hayCapitulos && { porCapitulos })
    };
  } catch (err) {
    console.error("❌ Error al buscar en PeliPREX:", err.message);
    return null;
  }
}

// ------------------- INICIAR SERVIDOR -------------------
async function startServer() {
  await loadUsersDataFromGitHub();
  const PORT = process.env.PORT || 8080;
  app.listen(PORT, () => console.log(`✅ Servidor v2.0 corriendo en http://localhost:${PORT}`));
}

startServer();
