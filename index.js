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

// ------------------- FUNCIÓN PARA CONSULTAR API EXTERNA EN PARALELO -------------------
async function fetchExternalPeliculas() {
  try {
    const response = await fetch('https://peliprex.fly.dev/catalog');
    if (!response.ok) {
      console.log(`⚠️ API externa respondió con status ${response.status}`);
      return [];
    }
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.log("⚠️ Error al consultar API externa /catalog:", error.message);
    return [];
  }
}

async function fetchExternalSearch(params = {}) {
  try {
    const url = new URL('https://peliprex.fly.dev/search');
    
    // Agregar todos los parámetros de búsqueda
    if (params.q) url.searchParams.append('q', params.q);
    if (params.genre) url.searchParams.append('genre', params.genre);
    if (params.year) url.searchParams.append('year', params.year);
    if (params.desde) url.searchParams.append('desde', params.desde);
    if (params.hasta) url.searchParams.append('hasta', params.hasta);
    if (params.language) url.searchParams.append('language', params.language);
    
    const response = await fetch(url.toString());
    if (!response.ok) {
      console.log(`⚠️ API externa search respondió con status ${response.status}`);
      return [];
    }
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.log("⚠️ Error al consultar API externa /search:", error.message);
    return [];
  }
}

function combinarResultados(externos, locales) {
  // Crear un Set con las URLs de los resultados externos para evitar duplicados
  const urlsExternas = new Set(externos.map(p => p.pelicula_url));
  
  // Filtrar locales que no estén ya en externos
  const localesUnicos = locales.filter(p => !urlsExternas.has(p.pelicula_url));
  
  // Dar prioridad a externos, luego complementar con locales únicos
  return [...externos, ...localesUnicos];
}

// ------------------- RUTAS PRINCIPALES -------------------
app.get("/", (req, res) => {
  res.json({
    mensaje: "🎬 API de Películas funcionando correctamente",
    total: peliculas.length,
    ejemplo: "/peliculas o /peliculas/El%20Padrino"
  });
});

// 🔧 1. MEJORA EN CARGA DE PELÍCULAS (dos fuentes en paralelo)
app.get("/peliculas", async (req, res) => {
  try {
    // Consultar ambas fuentes en paralelo
    const [externas, locales] = await Promise.all([
      fetchExternalPeliculas(),
      Promise.resolve(peliculas) // locales ya están cargadas
    ]);
    
    // Combinar resultados dando prioridad a externas
    const resultadosCombinados = combinarResultados(externas, locales);
    
    res.json(resultadosCombinados);
  } catch (error) {
    console.error("❌ Error en /peliculas:", error.message);
    // Fallback a locales si algo falla
    res.json(peliculas);
  }
});

app.get("/peliculas/:titulo", async (req, res) => {
  const tituloRaw = decodeURIComponent(req.params.titulo || "");
  const titulo = tituloRaw.toLowerCase();
  
  // Búsqueda local
  const resultadoLocal = peliculas.filter(p =>
    (p.titulo || "").toLowerCase().includes(titulo)
  );

  if (resultadoLocal.length > 0)
    return res.json({ fuente: "local", resultados: resultadoLocal });

  console.log(`🔎 No se encontró "${tituloRaw}" en el JSON.`);
  return res.json({ 
      fuente: "local", 
      total: 0, 
      resultados: [], 
      error: "Película no encontrada en local." 
  });
});

// 🔧 3. MEJORA EN BÚSQUEDA AVANZADA (dos fuentes en paralelo)
app.get("/buscar", async (req, res) => {
  const { año, genero, idioma, desde, hasta, q } = req.query;
  
  // Preparar parámetros para búsqueda externa
  const paramsExternos = {};
  if (q) paramsExternos.q = q;
  if (genero) paramsExternos.genre = genero;
  if (año) paramsExternos.year = año;
  if (desde) paramsExternos.desde = desde;
  if (hasta) paramsExternos.hasta = hasta;
  if (idioma) paramsExternos.language = idioma;
  
  try {
    // Consultar ambas fuentes en paralelo
    const [resultadosExternos, resultadosLocales] = await Promise.all([
      // Solo consultar externa si hay al menos un parámetro válido
      Object.keys(paramsExternos).length > 0 ? fetchExternalSearch(paramsExternos) : Promise.resolve([]),
      // Búsqueda local en paralelo
      Promise.resolve(peliculas.filter(p => {
        let cumple = true;
        
        if (q) {
          const ql = q.toLowerCase();
          cumple = cumple && (
            (p.titulo || "").toLowerCase().includes(ql) ||
            (p.descripcion || "").toLowerCase().includes(ql)
          );
        }
        
        if (año) cumple = cumple && String(p.año) === String(año);
        if (genero) cumple = cumple && (p.generos || "").toLowerCase().includes(String(genero).toLowerCase());
        if (idioma) cumple = cumple && (p.idioma_original || "").toLowerCase() === String(idioma).toLowerCase();
        if (desde && hasta) cumple = cumple && parseInt(p.año) >= parseInt(desde) && parseInt(p.año) <= parseInt(hasta);
        
        return cumple;
      }))
    ]);
    
    // Si no hay resultados externos pero sí locales, devolver locales
    if (resultadosExternos.length === 0 && resultadosLocales.length > 0) {
      return res.json({ fuente: "local", total: resultadosLocales.length, resultados: resultadosLocales });
    }
    
    // Si hay externos, combinarlos dando prioridad
    if (resultadosExternos.length > 0) {
      const combinados = combinarResultados(resultadosExternos, resultadosLocales);
      return res.json({ fuente: "combinada", total: combinados.length, resultados: combinados });
    }
    
    // Si no hay resultados de ningún lado
    res.json({ fuente: "local", total: 0, resultados: [], error: "No se encontraron películas con los criterios de búsqueda." });
    
  } catch (error) {
    console.error("❌ Error en búsqueda combinada:", error.message);
    // Fallback a búsqueda local solamente
    let resultados = peliculas;
    
    if (q) {
      const ql = q.toLowerCase();
      resultados = resultados.filter(p =>
        (p.titulo || "").toLowerCase().includes(ql) ||
        (p.descripcion || "").toLowerCase().includes(ql)
      );
    }
    
    if (año) resultados = resultados.filter(p => String(p.año) === String(año));
    if (genero) resultados = resultados.filter(p =>
      (p.generos || "").toLowerCase().includes(String(genero).toLowerCase())
    );
    if (idioma) resultados = resultados.filter(
      p => (p.idioma_original || "").toLowerCase() === String(idioma).toLowerCase()
    );
    if (desde && hasta) resultados = resultados.filter(
      p => parseInt(p.año) >= parseInt(desde) && parseInt(p.año) <= parseInt(hasta)
    );
    
    res.json({ fuente: "local", total: resultados.length, resultados });
  }
});

// 🔧 2. BÚSQUEDA POR CATEGORÍA (mejorada con dos fuentes)
app.get("/peliculas/categoria/:genero", async (req, res) => {
    const generoRaw = decodeURIComponent(req.params.genero || "");
    const generoBuscado = generoRaw.toLowerCase();

    try {
        // Consultar ambas fuentes en paralelo
        const [resultadosExternos, resultadosLocales] = await Promise.all([
            fetchExternalSearch({ genre: generoBuscado }),
            Promise.resolve(peliculas.filter(p =>
                (p.generos || "").toLowerCase().includes(generoBuscado)
            ))
        ]);
        
        // Si hay resultados externos, combinarlos dando prioridad
        if (resultadosExternos.length > 0) {
            const combinados = combinarResultados(resultadosExternos, resultadosLocales);
            // Aleatorizar los resultados combinados
            return res.json({ 
                fuente: "combinada", 
                total: combinados.length, 
                resultados: shuffleArray(combinados) 
            });
        }
        
        // Si solo hay resultados locales
        if (resultadosLocales.length > 0) {
            return res.json({ 
                fuente: "local", 
                total: resultadosLocales.length, 
                resultados: shuffleArray(resultadosLocales) 
            });
        }
        
        // Si no hay resultados
        console.log(`🔎 No se encontró la categoría "${generoRaw}" en ninguna fuente.`);
        return res.json({ 
            fuente: "local", 
            total: 0, 
            resultados: [], 
            error: "No se encontraron películas en la categoría solicitada." 
        });
        
    } catch (error) {
        console.error(`❌ Error en búsqueda por categoría "${generoRaw}":`, error.message);
        // Fallback a búsqueda local solamente
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
            error: "No se encontraron películas en la categoría solicitada." 
        });
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

  if (!titulo) user.history = toRefresh;
  saveUser(email, user);
  res.json({ ok: true, refreshed: toRefresh });
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

  if (!titulo) user.favorites = toRefresh;
  saveUser(email, user);
  res.json({ ok: true, refreshed: toRefresh });
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

// ------------------- INICIAR SERVIDOR -------------------
async function startServer() {
  // 1. Intentar cargar los datos de usuario desde GitHub
  await loadUsersDataFromGitHub();
  
  // 2. Iniciar el servidor
  const PORT = process.env.PORT || 8080;
  app.listen(PORT, () => console.log(`✅ Servidor corriendo en http://localhost:${PORT}`));
}

startServer();
