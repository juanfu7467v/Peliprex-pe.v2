// index.js — API completa de Películas con respaldo TMDb + embeds externos + sistema de usuarios
// ¡MEJORADO con Respaldo en GitHub para Historial y Favoritos y REPRODUCCIÓN CON EMBEDS EXTERNOS!

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
const TMDB_API_KEY = process.env.TMDB_API_KEY;
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY; // Opcional ahora

if (!TMDB_API_KEY) console.error("❌ ERROR: La variable de entorno TMDB_API_KEY no está configurada.");
if (!YOUTUBE_API_KEY) console.warn("⚠️ ADVERTENCIA: YOUTUBE_API_KEY no configurada. Los trailers no estarán disponibles.");


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

/** Devuelve un array con elementos aleatorios y desordenados. */
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// Mapeo de las categorías del usuario a los IDs de Género de TMDb.
// Para categorías compuestas, se usan los IDs separados por coma (ej. Comedia Romántica: "35,10749").
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
    "deportes": 99, // Documental
    "biografia": 18, // Drama
    "musical": 10402,
    "politica": 18, // Drama
    "cine independiente": 18, // Drama
    "superheroes": 28, // Action
    "cine clasico": null, // No TMDb genre ID
    "aventura epica": 12, // Adventure
    "cine romantico juvenil": 10749, // Romance
    "ficcion postapocaliptica": 878, // Science Fiction
    "peliculas religiosas / fe": 18, // Drama
    "cine historico": 36, // History
    "comedia romantica": "35,10749", // Comedy, Romance
    "terror psicologico": "27,53", // Horror, Thriller
    "accion militar / belica": 10752, // War
    "ciencia ficcion futurista": 878, // Science Fiction
    "cine experimental / arte": 99 // Documentary
};


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
      resume: {},
      // 🆕 Campo para la limpieza de actividad
      lastActivityTimestamp: new Date().toISOString() 
    };
    writeUsersData(data);
  }
  
  // Asegurar que el campo resume y lastActivityTimestamp existen en usuarios antiguos
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


// ------------------- TAREA PROGRAMADA: ELIMINACIÓN DE ACTIVIDAD CADA 24 HRS -------------------
/** * Tarea programada para limpiar historial y resumen de películas 
 * que tienen más de 24 horas de la última actividad/latido.
 */
const MS_IN_24_HOURS = 24 * 60 * 60 * 1000;

setInterval(() => {
    console.log("🧹 Iniciando chequeo de limpieza de actividad de 24 horas...");
    const data = readUsersData();
    let usersModified = false;
    const now = Date.now();

    for (const email in data.users) {
        const user = data.users[email];
        let userActivityModified = false;

        // --- Limpieza de Historial ---
        const historyLengthBefore = user.history.length;
        user.history = user.history.filter(h => {
            const historyDate = new Date(h.fecha).getTime();
            // Mantener solo lo que fue agregado en las últimas 24 horas
            return now - historyDate < MS_IN_24_HOURS;
        });
        if (user.history.length !== historyLengthBefore) {
            console.log(`   [${email}] Historial: Eliminados ${historyLengthBefore - user.history.length} elementos por antigüedad (>24h).`);
            userActivityModified = true;
        }

        // --- Limpieza de Resumen de Reproducción ---
        const resumeKeysBefore = Object.keys(user.resume).length;
        const newResume = {};
        for (const url in user.resume) {
            const resumeEntry = user.resume[url];
            const lastHeartbeatDate = new Date(resumeEntry.lastHeartbeat).getTime();
            // Mantener solo lo que tuvo un latido en las últimas 24 horas
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

        if (userActivityModified) {
            usersModified = true;
        }
    }

    if (usersModified) {
        writeUsersData(data);
        console.log("✅ Limpieza de actividad completada y datos guardados.");
    } else {
        console.log("ℹ️ No se encontraron actividades para limpiar.");
    }

}, MS_IN_24_HOURS); // Ejecutar cada 24 horas


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
    // buscarPeliculaRespaldo solo trae el primer resultado y lo detalla
    const respaldo = await buscarPeliculaRespaldo(tituloRaw);
    if (respaldo) return res.json({ fuente: "respaldo", resultados: [respaldo] });
    
    // Si no hay resultados en el respaldo
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
// MODIFICADO: Ahora es ASYNC para incluir la lógica de respaldo.
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
  
  // TMDb usa YYYY-MM-DD para release dates
  const release_date_gte = desde ? `${desde}-01-01` : null;
  const release_date_lte = hasta ? `${hasta}-12-31` : null;

  try {
    const respaldoResults = await searchTMDb({
      query: q,
      genre_id: tmdb_genre_id,
      primary_release_year: año,
      release_date_gte: release_date_gte,
      release_date_lte: release_date_lte,
      // Se omite el filtro de 'idioma' para TMDb ya que requiere un código ISO 639-1 específico
    });

    if (respaldoResults.length > 0) {
        return res.json({ fuente: "respaldo", total: respaldoResults.length, resultados: respaldoResults });
    }
  } catch (error) {
    console.error("❌ Error al buscar respaldo avanzado:", error);
  }

  // Si no hay resultados en local ni en respaldo
  res.json({ fuente: "local/respaldo", total: 0, resultados: [], error: "No se encontraron películas con los criterios de búsqueda, ni localmente ni en el respaldo." });
});

// 🆕 NUEVO ENDPOINT: Búsqueda por Categoría (Género)
app.get("/peliculas/categoria/:genero", async (req, res) => {
    const generoRaw = decodeURIComponent(req.params.genero || "");
    const generoBuscado = generoRaw.toLowerCase();

    // 1. Búsqueda Local
    let resultados = peliculas.filter(p =>
        (p.generos || "").toLowerCase().includes(generoBuscado)
    );
    
    // Aleatorizar los resultados locales (si existen)
    if (resultados.length > 0) {
        return res.json({ 
            fuente: "local", 
            total: resultados.length, 
            resultados: shuffleArray(resultados) 
        });
    }
    
    // 2. Búsqueda de Respaldo (TMDb) si la local falla
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
        // Usar 'vote_count.desc' para obtener películas populares de esa categoría.
        const respaldoResults = await searchTMDb({
            genre_id: tmdb_genre_id,
            sort_by: 'vote_count.desc' 
        });

        // La aleatoriedad se aplica a los resultados del respaldo.
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
    // 🆕 Incluir información de la última actividad del latido
    ultimaActividadHeartbeat: user.lastActivityTimestamp || "Sin latidos", 
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
  
  // 🆕 Incluir actividad de resumen de reproducción
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


// ------------------- NUEVOS ENDPOINTS DE SEGUIMIENTO DE STREAMING (LATIDOS) -------------------

/**
 * 🆕 Sistema de seguimiento de latidos (heartbeat) para el progreso de streaming.
 * @param email - Correo del usuario.
 * @param pelicula_url - URL de la película (como clave única).
 * @param titulo - Título de la película.
 * @param currentTime - Tiempo actual de reproducción (en segundos).
 * @param totalDuration - Duración total de la película (en segundos).
 */
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
    user.lastActivityTimestamp = new Date().toISOString(); // Actualiza la actividad global del usuario

    // 🔑 Clave única para el resumen de reproducción
    const key = pelicula_url;

    // Calcula el porcentaje visto
    const percentage = (currentTime / totalDuration) * 100;

    // Umbral para considerar "vista completa" (por ejemplo, 90%)
    const IS_COMPLETE_THRESHOLD = 90; 
    const isComplete = percentage >= IS_COMPLETE_THRESHOLD;
    
    // Almacenar/actualizar el resumen de la reproducción
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
    
    res.json({ 
        ok: true, 
        message: "Latido registrado.", 
        progress: user.resume[key] 
    });
});

/**
 * 🆕 Endpoint para verificar si una película ha sido vista y consumir 1 crédito.
 * Solo consume el crédito si el plan es 'creditos' y la película está marcada como 'vista completa' 
 * en el resumen de reproducción (isComplete: true).
 * @param email - Correo del usuario.
 * @param pelicula_url - URL de la película.
 */
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
        return res.json({ 
            ok: false, 
            consumed: false, 
            message: "Créditos insuficientes." 
        });
    }

    // 1. Consumir el crédito
    user.credits -= 1;
    
    // 2. Marcar el resumen como "crédito consumido" para evitar doble cobro
    resumeEntry.creditConsumed = true; 
    
    saveUser(email, user);

    res.json({ 
        ok: true, 
        consumed: true, 
        remaining_credits: user.credits, 
        message: "Crédito consumido exitosamente. La película se marcó como vista completa." 
    });
});

// ------------------- RESPALDO TMDb CON EMBEDS EXTERNOS (SIN YOUTUBE) -------------------
/**
 * 🎬 FUNCIÓN MEJORADA: Búsqueda de una película con embeds externos (Vidsrc, SuperEmbed, etc.)
 * Esta función genera URLs de reproducción directamente usando el ID de TMDb.
 * YouTube solo se usa opcionalmente para trailers.
 */
async function buscarPeliculaRespaldo(titulo) {
  if (!TMDB_API_KEY) {
      console.error("❌ No se puede usar el respaldo: Falta TMDB_API_KEY.");
      return null;
  }
  
  try {
    // 1. Buscar la película en TMDb
    const searchUrl = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&language=es-ES&query=${encodeURIComponent(titulo)}`;
    const searchResp = await fetch(searchUrl);
    const searchData = await searchResp.json();
    
    if (!searchData.results || searchData.results.length === 0) {
      console.log(`⚠️ No se encontró "${titulo}" en TMDb.`);
      return null;
    }

    const pelicula = searchData.results[0];
    const tmdbId = pelicula.id;

    // 2. Obtener detalles completos de la película
    const detallesUrl = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}&language=es-ES`;
    const detallesResp = await fetch(detallesUrl);
    const detalles = await detallesResp.json();

    // 🎯 3. GENERAR URLs DE EMBEDS EXTERNOS (Sistema de Mirrors)
    const mirrors = [
      {
        nombre: "Vidsrc.me",
        url: `https://vidsrc.me/embed/movie?tmdb=${tmdbId}&lang=es`,
        prioridad: 1
      },
      {
        nombre: "Vidsrc.to", 
        url: `https://vidsrc.to/embed/movie/${tmdbId}`,
        prioridad: 2
      },
      {
        nombre: "SuperEmbed",
        url: `https://multiembed.mov/?video_id=${tmdbId}&tmdb=1`,
        prioridad: 3
      },
      {
        nombre: "Vidsrc.xyz",
        url: `https://vidsrc.xyz/embed/movie/${tmdbId}`,
        prioridad: 4
      },
      {
        nombre: "2embed",
        url: `https://www.2embed.cc/embed/${tmdbId}`,
        prioridad: 5
      }
    ];

    // Fuente principal (primera en la lista)
    const fuentePrincipal = mirrors[0];

    // 4. (OPCIONAL) Buscar trailer en YouTube si está configurado
    let trailerUrl = null;
    if (YOUTUBE_API_KEY) {
      try {
        const year = pelicula.release_date ? pelicula.release_date.substring(0, 4) : '';
        const youtubeQuery = `${pelicula.title} ${year} trailer oficial español`;
        const youtubeUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(youtubeQuery)}&key=${YOUTUBE_API_KEY}&type=video&maxResults=1`;
        const youtubeResp = await fetch(youtubeUrl);
        const youtubeData = await youtubeResp.json();
        const youtubeId = youtubeData.items?.[0]?.id?.videoId;
        
        if (youtubeId) {
          trailerUrl = `https://www.youtube.com/watch?v=${youtubeId}`;
        }
      } catch (err) {
        console.warn("⚠️ No se pudo obtener el trailer de YouTube:", err.message);
      }
    }

    // 5. Retornar los datos de la película con embeds
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
      
      // 🎬 URL DE REPRODUCCIÓN PRINCIPAL (Embed externo)
      pelicula_url: fuentePrincipal.url,
      fuente_video: fuentePrincipal.nombre,
      
      // 🔄 SISTEMA DE MIRRORS (Fuentes alternativas)
      mirrors: mirrors,
      
      // 🎞️ TRAILER (Opcional, si está disponible)
      trailer_url: trailerUrl,
      
      // Metadatos adicionales
      tmdb_id: tmdbId,
      respaldo: true
    };

  } catch (err) {
    console.error("❌ Error en buscarPeliculaRespaldo:", err.message);
    return null;
  }
}

// 🆕 FUNCIÓN MEJORADA: Búsqueda general en TMDb con embeds (para listas/avanzada/categorías)
async function searchTMDb(params) {
    if (!TMDB_API_KEY) {
        console.error("❌ No se puede usar searchTMDb: Falta TMDB_API_KEY.");
        return [];
    }
    
    const { query, genre_id, primary_release_year, release_date_gte, release_date_lte, sort_by = 'popularity.desc', page = 1 } = params;
    
    let url = '';
    
    if (query) {
        // Búsqueda por query (nombre o descripción)
        url = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&language=es-ES&query=${encodeURIComponent(query)}&page=${page}`;
    } else if (genre_id || primary_release_year || release_date_gte || release_date_lte) {
        // Búsqueda avanzada/Discover (para género, año, rango de fechas)
        let discoverParams = `&sort_by=${sort_by}&page=${page}`;
        if (genre_id) discoverParams += `&with_genres=${genre_id}`;
        if (primary_release_year) discoverParams += `&primary_release_year=${primary_release_year}`;
        if (release_date_gte) discoverParams += `&primary_release_date.gte=${release_date_gte}`;
        if (release_date_lte) discoverParams += `&primary_release_date.lte=${release_date_lte}`;

        url = `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_API_KEY}&language=es-ES${discoverParams}`;
    } else {
        return []; // No hay criterio de búsqueda válido
    }

    try {
        const resp = await fetch(url);
        const data = await resp.json();
        
        if (!data.results || data.results.length === 0) return [];

        // Limitar a 10 resultados para optimizar rendimiento
        const resultsToEnrich = data.results.slice(0, 10);
        const enrichedResults = [];

        for (const pelicula of resultsToEnrich) {
            if (!pelicula.title) continue; // Saltar si no tiene título
            
            const tmdbId = pelicula.id;

            // 🎯 Generar URL de embed directamente (sin llamar a YouTube)
            const embedUrl = `https://vidsrc.to/embed/movie/${tmdbId}`;
            
            // Estructura de datos optimizada
            enrichedResults.push({
                titulo: pelicula.title,
                descripcion: pelicula.overview || "",
                fecha_lanzamiento: pelicula.release_date || "",
                idioma_original: pelicula.original_language || "",
                puntuacion: pelicula.vote_average || 0,
                popularidad: pelicula.popularity || 0,
                generos_ids: pelicula.genre_ids || [],
                imagen_url: pelicula.poster_path
                    ? `https://image.tmdb.org/t/p/w500${pelicula.poster_path}`
                    : "",
                
                // 🎬 URL DE REPRODUCCIÓN (Embed externo)
                pelicula_url: embedUrl,
                fuente_video: "Vidsrc.to",
                
                // Metadatos
                tmdb_id: tmdbId,
                respaldo: true
            });
        }

        return enrichedResults;

    } catch (err) {
        console.error("❌ Error en searchTMDb:", err.message);
        return [];
    }
}


// ------------------- INICIAR SERVIDOR -------------------
async function startServer() {
  // 1. Intentar cargar los datos de usuario desde GitHub
  await loadUsersDataFromGitHub();
  
  // 2. Iniciar el servidor
  const PORT = process.env.PORT || 8080;
  app.listen(PORT, () => {
    console.log(`✅ Servidor corriendo en http://localhost:${PORT}`);
    console.log(`🎬 Sistema de embeds externos activado (Vidsrc, SuperEmbed, etc.)`);
    console.log(`📊 Total de películas locales: ${peliculas.length}`);
  });
}

startServer();
