// index.js — API completa de Películas con sistema de usuarios + MaguisTV style
// ¡MEJORADO con Respaldo en GitHub para Historial y Favoritos!
// ¡MEJORADO con integración de API externa Peliprex para ampliar el catálogo!

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

// ------------------- 🆕 API EXTERNA PELIPREX -------------------
// Las URLs de esta API son temporales (expiran). Por eso:
// - Se guardan los IDs, no las URLs, en historial/favoritos.
// - Se refresca el catálogo cada 2 horas para mantener URLs válidas en memoria.
const EXTERNAL_API_URL = "https://peliprex.fly.dev/catalog";
const EXTERNAL_API_REFRESH_MS = 2 * 60 * 60 * 1000; // Refrescar cada 2 horas

// 📂 Archivos locales (Mantenidos)
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


// ------------------- CARGAR PELÍCULAS LOCALES -------------------
let localPeliculas = [];
try {
  localPeliculas = JSON.parse(fs.readFileSync(PELIS_FILE, "utf8"));
  console.log(`✅ Cargadas ${localPeliculas.length} películas desde peliculas.json`);
} catch (err) {
  console.error("❌ Error cargando peliculas.json:", err.message);
  localPeliculas = [];
}

// ------------------- 🆕 CARGAR PELÍCULAS DE API EXTERNA (PELIPREX) -------------------
let externalApiMovies = [];

/**
 * Carga y refresca las películas desde la API externa Peliprex.
 * Marca cada película con _fromExternalApi: true para que el sistema
 * sepa que debe guardar el 'id' en lugar de 'pelicula_url' (que expira).
 */
async function loadExternalApiMovies() {
  try {
    console.log("📡 Cargando películas desde API externa Peliprex...");
    const resp = await fetch(EXTERNAL_API_URL);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    // Marcar cada película como proveniente de la API externa
    externalApiMovies = data.map(p => ({ ...p, _fromExternalApi: true }));
    // Reconstruir el catálogo combinado con las URLs frescas
    peliculas = [...localPeliculas, ...externalApiMovies];
    console.log(`✅ Cargadas ${externalApiMovies.length} películas desde API externa Peliprex`);
    console.log(`📚 Catálogo total actualizado: ${peliculas.length} películas`);
    return externalApiMovies;
  } catch (err) {
    console.error("❌ Error cargando películas de API externa Peliprex:", err.message);
    // En caso de error, devolver la caché actual sin romper el servidor
    return externalApiMovies;
  }
}

// Catálogo combinado: comienza con las locales, las externas se añaden al arrancar.
let peliculas = [...localPeliculas];

// Refresco periódico del catálogo externo para renovar las URLs que expiran.
setInterval(async () => {
  console.log("🔄 Refrescando catálogo de API externa Peliprex (renovando URLs expiradas)...");
  await loadExternalApiMovies();
}, EXTERNAL_API_REFRESH_MS);


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
/**
 * Tarea programada para limpiar historial y resumen de películas
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

app.get("/peliculas/:titulo", (req, res) => {
  const tituloRaw = decodeURIComponent(req.params.titulo || "");
  const titulo = tituloRaw.toLowerCase();
  const resultado = peliculas.filter(p =>
    (p.titulo || "").toLowerCase().includes(titulo)
  );

  if (resultado.length > 0)
    return res.json({ fuente: "local", resultados: resultado });

  return res.json({
    fuente: "local",
    total: 0,
    resultados: [],
    error: "Película no encontrada en el catálogo."
  });
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

  res.json({
    fuente: "local",
    total: 0,
    resultados: [],
    error: "No se encontraron películas con los criterios de búsqueda."
  });
});

// 🆕 ENDPOINT: Búsqueda por Categoría (Género)
app.get("/peliculas/categoria/:genero", (req, res) => {
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

    return res.json({
        fuente: "local",
        total: 0,
        resultados: [],
        error: "No se encontraron películas en esa categoría."
    });
});


// ------------------- 🆕 ENDPOINT: Obtener URL Fresca por ID (API Externa) -------------------
/**
 * Obtiene una URL de reproducción actualizada para películas de la API externa Peliprex.
 * Las URLs expiran después de algunas horas. Este endpoint las renueva usando el ID estable.
 * Uso: GET /pelicula/url?id=<id_de_la_pelicula>
 */
app.get("/pelicula/url", async (req, res) => {
  const id = req.query.id;
  if (!id) return res.status(400).json({ error: "Falta parámetro id" });

  try {
    const resp = await fetch(EXTERNAL_API_URL);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const pelicula = data.find(p => String(p.id) === String(id));
    if (!pelicula) {
      return res.status(404).json({ error: "Película no encontrada en la API externa." });
    }
    res.json({
      id: pelicula.id,
      titulo: pelicula.titulo,
      imagen_url: pelicula.imagen_url || "",
      pelicula_url: pelicula.pelicula_url
    });
  } catch (err) {
    console.error("❌ Error al obtener URL fresca de API externa:", err.message);
    res.status(500).json({ error: "Error al obtener URL de la película desde la API externa." });
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
// Acepta api_id para películas de API externa (no guarda pelicula_url que expira)
app.get("/user/add_favorite", (req, res) => {
  const email = (req.query.email || "").toLowerCase();
  const { titulo, imagen_url, pelicula_url: raw_pelicula_url, api_id } = req.query;

  // Para películas locales se limpia la URL; para externas se usa el api_id
  const pelicula_url = api_id ? null : cleanPeliculaUrl(raw_pelicula_url);

  if (!email || !titulo || (!pelicula_url && !api_id))
    return res.status(400).json({ error: "Faltan parámetros" });

  const user = getOrCreateUser(email);

  if (api_id) {
    // Película de API externa: guardar por api_id, NO guardar pelicula_url (expira)
    if (!user.favorites.some(f => String(f.api_id) === String(api_id))) {
      user.favorites.unshift({
        titulo,
        imagen_url,
        api_id: String(api_id),
        _fromExternalApi: true,
        addedAt: new Date().toISOString()
      });
      saveUser(email, user);
    }
  } else {
    // Película local: comportamiento original sin cambios
    if (!user.favorites.some(f => f.pelicula_url === pelicula_url)) {
      user.favorites.unshift({ titulo, imagen_url, pelicula_url, addedAt: new Date().toISOString() });
      saveUser(email, user);
    }
  }

  res.json({ ok: true, favorites: user.favorites });
});

app.get("/user/favorites", (req, res) => {
  const email = (req.query.email || "").toLowerCase();
  if (!email) return res.status(400).json({ error: "Falta email" });
  const user = getOrCreateUser(email);
  res.json({ total: user.favorites.length, favorites: user.favorites });
});

// ELIMINAR TODOS LOS FAVORITOS
app.get("/user/favorites/clear", (req, res) => {
  const email = (req.query.email || "").toLowerCase();
  if (!email) return res.status(400).json({ error: "Falta email" });

  const user = getOrCreateUser(email);
  if (!user) return res.status(404).json({ error: "Usuario no encontrado" });

  user.favorites = [];
  saveUser(email, user);

  res.json({ ok: true, message: "Lista de favoritos eliminada." });
});

// ELIMINAR UNA PELÍCULA DE FAVORITOS
// Acepta api_id para eliminar películas de API externa
app.get("/user/favorites/remove", (req, res) => {
  const email = (req.query.email || "").toLowerCase();
  const api_id = req.query.api_id; // Para películas de API externa
  const raw_pelicula_url = req.query.pelicula_url;
  const pelicula_url = api_id ? null : cleanPeliculaUrl(raw_pelicula_url);

  if (!email || (!pelicula_url && !api_id))
    return res.status(400).json({ error: "Faltan email o pelicula_url/api_id" });

  const user = getOrCreateUser(email);
  if (!user) return res.status(404).json({ error: "Usuario no encontrado" });

  const initialLength = user.favorites.length;

  if (api_id) {
    // Remover por api_id (películas de API externa)
    user.favorites = user.favorites.filter(f => String(f.api_id) !== String(api_id));
  } else {
    // Comportamiento original: remover por pelicula_url
    user.favorites = user.favorites.filter(f => f.pelicula_url !== pelicula_url);
  }

  if (user.favorites.length < initialLength) {
    saveUser(email, user);
    return res.json({ ok: true, message: "Película eliminada de favoritos." });
  }
  res.status(404).json({ ok: false, message: "Película no encontrada en favoritos." });
});

// Historial
// Acepta api_id para películas de API externa (no guarda pelicula_url que expira)
app.get("/user/add_history", (req, res) => {
  const email = (req.query.email || "").toLowerCase();
  const { titulo, pelicula_url: raw_pelicula_url, imagen_url, api_id } = req.query;

  // Para películas locales se limpia la URL; para externas se usa el api_id
  const pelicula_url = api_id ? null : cleanPeliculaUrl(raw_pelicula_url);

  if (!email || !titulo || (!pelicula_url && !api_id))
    return res.status(400).json({ error: "Faltan parámetros" });

  const user = getOrCreateUser(email);

  if (api_id) {
    // Película de API externa: guardar por api_id, NO guardar pelicula_url (expira)
    user.history.unshift({
      titulo,
      api_id: String(api_id),
      imagen_url,
      _fromExternalApi: true,
      fecha: new Date().toISOString()
    });
  } else {
    // Película local: comportamiento original sin cambios
    user.history.unshift({ titulo, pelicula_url, imagen_url, fecha: new Date().toISOString() });
  }

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

// ELIMINAR TODO EL HISTORIAL
app.get("/user/history/clear", (req, res) => {
  const email = (req.query.email || "").toLowerCase();
  if (!email) return res.status(400).json({ error: "Falta email" });

  const user = getOrCreateUser(email);
  if (!user) return res.status(404).json({ error: "Usuario no encontrado" });

  user.history = [];
  saveUser(email, user);

  res.json({ ok: true, message: "Historial de películas eliminado." });
});

// ELIMINAR UNA PELÍCULA DEL HISTORIAL
// Acepta api_id para eliminar películas de API externa
app.get("/user/history/remove", (req, res) => {
  const email = (req.query.email || "").toLowerCase();
  const api_id = req.query.api_id; // Para películas de API externa
  const raw_pelicula_url = req.query.pelicula_url;
  const pelicula_url = api_id ? null : cleanPeliculaUrl(raw_pelicula_url);

  if (!email || (!pelicula_url && !api_id))
    return res.status(400).json({ error: "Faltan email o pelicula_url/api_id" });

  const user = getOrCreateUser(email);
  if (!user) return res.status(404).json({ error: "Usuario no encontrado" });

  const initialLength = user.history.length;

  if (api_id) {
    // Remover por api_id (películas de API externa)
    user.history = user.history.filter(h => String(h.api_id) !== String(api_id));
  } else {
    // Comportamiento original: remover por pelicula_url
    user.history = user.history.filter(h => h.pelicula_url !== pelicula_url);
  }

  if (user.history.length < initialLength) {
    saveUser(email, user);
    return res.json({ ok: true, message: "Película eliminada del historial." });
  }
  res.status(404).json({ ok: false, message: "Película no encontrada en el historial." });
});


// ------------------- NUEVOS ENDPOINTS -------------------

// 🔁 Refrescar historial (uno o todos)
app.get("/user/history/refresh", (req, res) => {
  const email = (req.query.email || "").toLowerCase();
  const user = getOrCreateUser(email);
  if (!user) return res.status(400).json({ error: "Usuario no encontrado" });
  // Sin servicio de respaldo externo activo, se devuelve el historial actual sin cambios.
  res.json({ ok: true, refreshed: user.history });
});

// 🔁 Refrescar favoritos (uno o todos)
app.get("/user/favorites/refresh", (req, res) => {
  const email = (req.query.email || "").toLowerCase();
  const user = getOrCreateUser(email);
  if (!user) return res.status(400).json({ error: "Usuario no encontrado" });
  // Sin servicio de respaldo externo activo, se devuelve la lista actual sin cambios.
  res.json({ ok: true, refreshed: user.favorites });
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

/**
 * Sistema de seguimiento de latidos (heartbeat) para el progreso de streaming.
 * Acepta api_id para películas de API externa.
 * La clave del resumen será 'api:<id>' para externas o la URL para locales.
 */
app.get("/user/heartbeat", (req, res) => {
    const email = (req.query.email || "").toLowerCase();
    const raw_pelicula_url = req.query.pelicula_url;
    const api_id = req.query.api_id; // Para películas de API externa
    const currentTime = parseInt(req.query.currentTime);
    const totalDuration = parseInt(req.query.totalDuration);
    const titulo = req.query.titulo;

    // La clave del resumen: URL limpia (local) o 'api:id' (externa)
    const pelicula_url = api_id ? null : cleanPeliculaUrl(raw_pelicula_url);
    const key = api_id ? `api:${api_id}` : pelicula_url;

    if (!email || !key || isNaN(currentTime) || isNaN(totalDuration) || !titulo) {
        return res.status(400).json({ error: "Faltan parámetros válidos (email, pelicula_url o api_id, currentTime, totalDuration, titulo)." });
    }

    const user = getOrCreateUser(email);
    user.lastActivityTimestamp = new Date().toISOString();

    const percentage = (currentTime / totalDuration) * 100;
    const IS_COMPLETE_THRESHOLD = 90;
    const isComplete = percentage >= IS_COMPLETE_THRESHOLD;

    user.resume[key] = {
        titulo: titulo,
        pelicula_url: pelicula_url,
        api_id: api_id ? String(api_id) : null,
        _fromExternalApi: !!api_id,
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
 * Endpoint para verificar si una película ha sido vista y consumir 1 crédito.
 * Acepta api_id para películas de API externa.
 * Usa la misma clave que heartbeat para localizar el resumen.
 */
app.get("/user/consume_credit", (req, res) => {
    const email = (req.query.email || "").toLowerCase();
    const raw_pelicula_url = req.query.pelicula_url;
    const api_id = req.query.api_id; // Para películas de API externa

    // La clave debe coincidir exactamente con la usada en heartbeat
    const pelicula_url = api_id ? null : cleanPeliculaUrl(raw_pelicula_url);
    const key = api_id ? `api:${api_id}` : pelicula_url;

    if (!email || !key) {
        return res.status(400).json({ error: "Faltan parámetros (email, pelicula_url o api_id)." });
    }

    const user = getOrCreateUser(email);

    if (user.tipoPlan !== 'creditos') {
        return res.json({
            ok: true,
            consumed: false,
            message: `El plan del usuario es '${user.tipoPlan}', no se requiere consumo de crédito.`
        });
    }

    const resumeEntry = user.resume[key];

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


// ------------------- INICIAR SERVIDOR -------------------
async function startServer() {
  // 1. Intentar cargar los datos de usuario desde GitHub
  await loadUsersDataFromGitHub();

  // 2. Cargar películas de API externa Peliprex para ampliar el catálogo
  await loadExternalApiMovies();

  // 3. Iniciar el servidor
  const PORT = process.env.PORT || 8080;
  app.listen(PORT, () => console.log(`✅ Servidor corriendo en http://localhost:${PORT}`));
}

startServer();
