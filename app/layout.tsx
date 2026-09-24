import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Weather Patterns",
  description: "Personalized weather service. Accurate, hyperlocal forecasts from the NWS, Open-Meteo and PurpleAir, tuned to your microclimate.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <main>{children}</main>
      </body>
    </html>
  );
}
