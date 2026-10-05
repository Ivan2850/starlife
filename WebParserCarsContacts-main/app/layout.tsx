import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Robota Contacts",
  description:
    "Збір публічних контактів роботодавців із вакансій robota.ua"
};

type RootLayoutProps = {
  children: ReactNode;
};

export default function RootLayout({
  children
}: RootLayoutProps) {
  return (
    <html lang="uk">
      <body>{children}</body>
    </html>
  );
}