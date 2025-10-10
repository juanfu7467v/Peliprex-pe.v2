import express from "express";
import cors from "cors";
import fs from "fs";

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(cors());
app.use(express.json());

// Cargar las películas desde el archivo JSON
let peliculas = [];
try {
  const data = fs.readFileSync("./peliculas.json", "utf-8");
  peliculas = JSON.parse(data);
  console.log(`✅ ${peliculas.length} películas cargadas correctamente.`);
} catch (err) {
  console.error("❌ Error al cargar peliculas.json:", err);
}

// Ruta principal
app.get("/", (req, res) => {
  res.send({
    mensaje: "🎬 Bienvenido a la API de Películas",
    endpoints: {
      todas: "/peliculas",
      buscar: "/peliculas?titulo=nombre",
      por_genero: "/peliculas?genero=accion",
      por_año: "/peliculas?anio=2020"
    }
  });
});

// Obtener todas las películas
app.get("/peliculas", (req, res) => {
  const { titulo, genero, anio } = req.query;
  let resultados = peliculas;

  if (titulo) {
    const query = titulo.toLowerCase();
    resultados = resultados.filter(p =>
      p.titulo.toLowerCase().includes(query)
    );
  }

  if (genero) {
    const query = genero.toLowerCase();
    resultados = resultados.filter(p =>
      p.generos.toLowerCase().includes(query)
    );
  }

  if (anio) {
    resultados = resultados.filter(p => p.año === anio);
  }

  res.json(resultados);
});

// Obtener una película exacta por título
app.get("/pelicula/:titulo", (req, res) => {
  const titulo = decodeURIComponent(req.params.titulo).toLowerCase();
  const pelicula = peliculas.find(p => p.titulo.toLowerCase() === titulo);

  if (!pelicula) {
    return res.status(404).json({ error: "Película no encontrada" });
  }

  res.json(pelicula);
});

// Manejar rutas no encontradas
app.use((req, res) => {
  res.status(404).json({ error: "Ruta no encontrada" });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor escuchando en http://localhost:${PORT}`);
});
