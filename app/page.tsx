// Página de inicio ("/") — resuelve el 404 de Vercel.
// Renderiza el contenedor de pestañas con las 4 vistas.
import TabbedApp from "./TabbedApp";

export default function Home() {
  return (
    <main style={{ minHeight: "100vh", padding: "24px 12px" }}>
      <h1 style={{ maxWidth: 1040, margin: "0 auto 8px", fontSize: 22, fontFamily: "system-ui" }}>
        📈 Stock ML — Predicción, Intradía y Señales
      </h1>
      <TabbedApp />
    </main>
  );
}
