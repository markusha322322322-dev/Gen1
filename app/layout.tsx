import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "SIGNAL — рабочее пространство",
  description: "Командный сбор и обработка freelance-объявлений",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
