import type { Metadata, Viewport } from "next";
import "@fontsource/fraunces/latin-600.css";
import "@fontsource/fraunces/latin-600-italic.css";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://ruutin.irwan.cc"),
  title: "Ruutin | Calm routines for busy families",
  description:
    "A parent-first routine and reward space that helps families make everyday progress feel lighter.",
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    shortcut: "/icon-192.png",
    apple: "/apple-touch-icon.png",
  },
  manifest: "/manifest.webmanifest",
  openGraph: {
    title: "Ruutin | Calm routines for busy families",
    description:
      "A parent-first routine and reward space that helps families make everyday progress feel lighter.",
    type: "website",
    images: [
      {
        url: "/ruutin-social-card.png",
        width: 1728,
        height: 910,
        alt: "Ruutin — gentle family routines and shared progress",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Ruutin | Calm routines for busy families",
    description:
      "A parent-first routine and reward space that helps families make everyday progress feel lighter.",
    images: ["/ruutin-social-card.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#694477",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
