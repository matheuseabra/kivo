import type { Metadata } from "next";
import "./globals.css";
import { Toast } from "@/components/Toast";

export const metadata: Metadata = {
  title: "Kivo",
  description: "Visual AI workflow editor for images, video, audio, and 3D pipelines.",
  other: {
    // Kivo already ships a dark UI. This disables Dark Reader, whose DOM
    // injection otherwise causes hydration mismatches on every page.
    "darkreader-lock": "true",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
        <Toast />
      </body>
    </html>
  );
}
