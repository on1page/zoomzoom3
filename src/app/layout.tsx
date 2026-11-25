import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ZoomZoom — Recensioni verificate su case, zone e servizi della casa",
  description: "ZoomZoom (nome provvisorio): portale indipendente di recensioni verificate su immobili, zone, proprietari, affittuari, amministratori, agenzie e ditte del settore casa.",
  icons: {
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Crect x='2' y='2' width='44' height='44' rx='10' fill='%2317334F'/%3E%3Cpath d='M24 9 L38 21 V39 H10 V21 Z' fill='none' stroke='%23fff' stroke-width='2.6' stroke-linejoin='round'/%3E%3Cpath d='M24,17.2 L25.43,21.03 L29.52,21.21 L26.32,23.75 L27.41,27.69 L24,25.44 L20.59,27.69 L21.68,23.75 L18.48,21.21 L22.57,21.03 Z' fill='%23C9A227'/%3E%3C/svg%3E",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="it" suppressHydrationWarning>
      <body className="antialiased">
        <a className="skip-link" href="#main">Salta al contenuto principale</a>
        {children}
      </body>
    </html>
  );
}
