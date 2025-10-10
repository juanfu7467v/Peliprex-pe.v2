import express from "express";
import cors from "cors";
import fs from "fs";

const app = express();
app.use(cors());

// Cargar las películas desde el JSON
const peliculas = JSON.parse(fs.readFileSync("./peliculas.json", "utf8"));

// --- Control de inactividad ---
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
setInterval(revisarInactividad, 30000); // Revisa cada 30 segundos

// Middleware que actualiza la última petición
app.use((req, res, next) => {
  ultimaPeticion = Date.now();
  next();
});

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

// 🔍 Buscar película por título
app.get("/peliculas/:titulo", (req, res) => {
  const titulo = decodeURIComponent(req.params.titulo).toLowerCase();
  const resultado = peliculas.filter((p) =>
    p.titulo.toLowerCase().includes(titulo)
  );
  if (resultado.length > 0) {
    res.json(resultado);
  } else {
    res.status(404).json({ error: "Película no encontrada" });
  }
});

// 🔎 Búsqueda avanzada (por año, género, idioma, etc.)
app.get("/buscar", (req, res) => {
  const { año, genero, idioma, desde, hasta } = req.query;
  let resultados = peliculas;

  if (año) resultados = resultados.filter((p) => p.año === año);
  if (genero)
    resultados = resultados.filter((p) =>
      p.generos.toLowerCase().includes(genero.toLowerCase())
    );
  if (idioma)
    resultados = resultados.filter(
      (p) => p.idioma_original.toLowerCase() === idioma.toLowerCase()
    );
  if (desde && hasta)
    resultados = resultados.filter(
      (p) =>
        parseInt(p.año) >= parseInt(desde) &&
        parseInt(p.año) <= parseInt(hasta)
    );

  res.json({
    total: resultados.length,
    resultados,
  });
});

// 🌍 Iniciar servidor
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`✅ Servidor corriendo en http://localhost:${PORT}`);
});
