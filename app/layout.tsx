import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Stock ML — Predicción, Intradía y Señales",
  description:
    "Predicción XGBoost, simulación Monte Carlo, chartismo intradía y señales combinadas.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body style={{ margin: 0, background: "#fafafa", color: "#111" }}>
        {children}
      </body>
    </html>
  );
}
