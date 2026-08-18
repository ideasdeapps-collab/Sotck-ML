// Página de inicio ("/") — entrypoint de producción Vercel.
// Renderiza el contenedor principal con todas las vistas disponibles.
import TabbedApp from "./TabbedApp";

export default function Home() {
  return (
    <main style={{ minHeight: "100vh", padding: "24px 12px" }}>
      <h1 style={{ maxWidth: 1040, margin: "0 auto 8px", fontSize: 22, fontFamily: "system-ui" }}>
        📈 Stock ML — Predicción, Intradía, Señales y AI Live Trading
      </h1>
      <TabbedApp />
    </main>
  );
}
