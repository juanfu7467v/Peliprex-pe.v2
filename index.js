// index.js — API de Películas con nueva integración de peliprex.fly.dev + sistema de usuarios
// Eliminadas: TMDB API y YouTube API v3
// Nuevas fuentes: peliculas.json (local) + https://peliprex.fly.dev/catalog y /search

import express from "express";
import cors from "cors";
import fs from "fs";
import fetch from "node-fetch";
import path from "path";

const app = express();
app.use(cors());

// ------------------- GITHUB CONFIGURACIÓN DE RESPALDO -------------------
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO; // Formato: 'usuario/nombre-del-repositorio'
const BACKUP_FILE_NAME = "users_data.json";

// 📂 Archivos locales
const PELIS_FILE = path.join(process.cwd(), "peliculas.json");
const USERS_FILE = path.join(process.cwd(), BACKUP_FILE_NAME);

// URL de la nueva API
const PELIPREX_API_BASE = "https://peliprex.fly.dev";

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

/** Elimina duplicados basados en el título (para evitar películas repetidas) */
function removeDuplicatesByTitle(array) {
    const seen = new Set();
    return array.filter(item => {
        const titulo = item.titulo?.toLowerCase() || '';
        if (seen.has(titulo)) return false;
        seen.add(titulo);
        return true;
    });
}

// ------------------- CARGAR PELÍCULAS LOCALES -------------------
let peliculas = [];
try {
  peliculas = JSON.parse(fs.readFileSync(PELIS_FILE, "utf8"));
  console.log(`✅ Cargadas ${peliculas.length} películas desde peliculas.json`);
} catch (err) {
  console.error("❌ Error cargando peliculas.json:", err.message);
  peliculas = [];
}

// ------------------- FUNCIONES DE GITHUB -------------------

/** Obtiene el SHA de la última versión del archivo en GitHub, necesario para actualizar. */
async function getFileSha(filePath) {
  if (!GITHUB_TOKEN || !GITHUB_REPO) return null;
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${filePath}`;
  try {
    const resp = await fetch(url);
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

// ------------------- FUNCIÓN PARA OBTENER PELÍCULAS DE LA NUEVA API -------------------
async function obtenerPeliculasDesdeAPI() {
    try {
        const url = `${PELIPREX_API_BASE}/catalog`;
        const response = await fetch(url);
        
        if (!response.ok) {
            console.error(`❌ Error al obtener catálogo: ${response.status}`);
            return [];
        }
        
        const data = await response.json();
        
        if (!data.results || !Array.isArray(data.results)) {
            console.error("❌ Formato inesperado de la API:", data);
            return [];
        }
        
        // Transformar los datos al formato esperado por el frontend
        return data.results.map(item => ({
            titulo: item.titulo || "Sin título",
            imagen_url: item.imagen_url || "",
            pelicula_url: cleanPeliculaUrl(item.pelicula_url || ""),
            descripcion: item.descripcion || "",
            fecha_lanzamiento: item.fecha_lanzamiento || "",
            duracion: item.duracion || "",
            idioma_original: item.idioma_original || "",
            popularidad: item.popularidad || 0,
            puntuacion: item.puntuacion || 0,
            generos: item.generos || "",
            año: item.año || "",
            id: item.id,
            size: item.size || "",
            descripcion_detallada: item.descripcion_detallada || "",
            fuente: "api_externa"
        }));
        
    } catch (error) {
        console.error("❌ Error al obtener películas de la API:", error.message);
        return [];
    }
}

// ------------------- FUNCIÓN PARA BUSCAR EN LA NUEVA API -------------------
async function buscarPeliculasEnAPI(query) {
    try {
        const url = `${PELIPREX_API_BASE}/search?q=${encodeURIComponent(query)}`;
        const response = await fetch(url);
        
        if (!response.ok) {
            console.error(`❌ Error en búsqueda API: ${response.status}`);
            return [];
        }
        
        const data = await response.json();
        
        if (!data.results || !Array.isArray(data.results)) {
            console.error("❌ Formato inesperado en búsqueda API:", data);
            return [];
        }
        
        return data.results.map(item => ({
            titulo: item.titulo || "Sin título",
            imagen_url: item.imagen_url || "",
            pelicula_url: cleanPeliculaUrl(item.pelicula_url || ""),
            descripcion: item.descripcion || "",
            fecha_lanzamiento: item.fecha_lanzamiento || "",
            duracion: item.duracion || "",
            idioma_original: item.idioma_original || "",
            popularidad: item.popularidad || 0,
            puntuacion: item.puntuacion || 0,
            generos: item.generos || "",
            año: item.año || "",
            id: item.id,
            size: item.size || "",
            descripcion_detallada: item.descripcion_detallada || "",
            fuente: "api_externa"
        }));
        
    } catch (error) {
        console.error("❌ Error al buscar en API:", error.message);
        return [];
    }
}

// ------------------- RUTAS PRINCIPALES -------------------
app.get("/", (req, res) => {
  res.json({
    mensaje: "🎬 API de Películas funcionando correctamente",
    total_local: peliculas.length,
    ejemplo: "/peliculas o /peliculas/El%20Padrino"
  });
});

// 🔧 MEJORADO: Obtiene películas de dos fuentes: local + API externa
app.get("/peliculas", async (req, res) => {
    try {
        // Obtener películas de ambas fuentes en paralelo
        const [peliculasLocales, peliculasAPI] = await Promise.all([
            Promise.resolve(peliculas), // Fuente local
            obtenerPeliculasDesdeAPI()   // Fuente API externa
        ]);
        
        // Combinar resultados
        let todasLasPeliculas = [...peliculasLocales, ...peliculasAPI];
        
        // Eliminar duplicados por título (opcional, para mantener limpio)
        todasLasPeliculas = removeDuplicatesByTitle(todasLasPeliculas);
        
        res.json(todasLasPeliculas);
        
    } catch (error) {
        console.error("❌ Error al combinar fuentes:", error);
        // Fallback: solo películas locales si algo falla
        res.json(peliculas);
    }
});

// 🔧 MEJORADO: Busca en dos fuentes: local + API externa
app.get("/peliculas/:titulo", async (req, res) => {
  const tituloRaw = decodeURIComponent(req.params.titulo || "");
  const titulo = tituloRaw.toLowerCase();
  
  try {
      // Buscar en ambas fuentes en paralelo
      const [resultadosLocales, resultadosAPI] = await Promise.all([
          Promise.resolve(peliculas.filter(p =>
            (p.titulo || "").toLowerCase().includes(titulo)
          )),
          buscarPeliculasEnAPI(tituloRaw)
      ]);
      
      // Combinar resultados
      let todosLosResultados = [...resultadosLocales, ...resultadosAPI];
      
      // Si hay resultados combinados, devolverlos
      if (todosLosResultados.length > 0) {
          return res.json({ 
              fuente: "combinada", 
              total: todosLosResultados.length,
              resultados: todosLosResultados 
          });
      }
      
      // Si no hay resultados en ninguna fuente
      return res.json({ 
          fuente: "local/api", 
          total: 0, 
          resultados: [], 
          error: "Película no encontrada en local ni en API externa." 
      });
      
  } catch (error) {
      console.error("❌ Error al buscar en fuentes combinadas:", error);
      
      // Fallback: solo búsqueda local si algo falla
      const resultado = peliculas.filter(p =>
        (p.titulo || "").toLowerCase().includes(titulo)
      );
      
      if (resultado.length > 0)
        return res.json({ fuente: "local", resultados: resultado });
      
      return res.json({ 
          fuente: "local", 
          total: 0, 
          resultados: [], 
          error: "Película no encontrada." 
      });
  }
});

// 🔎 Búsqueda avanzada (MANTENIDA SIN CAMBIOS - solo local)
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
    
  res.json({ fuente: "local", total: resultados.length, resultados });
});

// 🆕 Búsqueda por Categoría (MANTENIDA SIN CAMBIOS - solo local)
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
        error: "Categoría no encontrada." 
    });
});

// ------------------- RUTAS DE USUARIOS (SIN CAMBIOS) -------------------
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

// ------------------- ENDPOINTS DE REFRESH (MANTENIDOS) -------------------
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
    const resultadosAPI = await buscarPeliculasEnAPI(h.titulo);
    if (resultadosAPI.length > 0) {
      refreshed.push(resultadosAPI[0]);
    } else {
      refreshed.push(h);
    }
  }

  if (!titulo) user.history = refreshed;
  saveUser(email, user);
  res.json({ ok: true, refreshed });
});

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
    const resultadosAPI = await buscarPeliculasEnAPI(f.titulo);
    if (resultadosAPI.length > 0) {
      refreshed.push(resultadosAPI[0]);
    } else {
      refreshed.push(f);
    }
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
    
    res.json({ 
        ok: true, 
        message: "Latido registrado.", 
        progress: user.resume[key] 
    });
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
  await loadUsersDataFromGitHub();
  
  const PORT = process.env.PORT || 8080;
  app.listen(PORT, () => console.log(`✅ Servidor corriendo en http://localhost:${PORT}`));
}

startServer();
