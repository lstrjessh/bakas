import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Bakas · Typhoon tracks, past and present",
  description:
    "Explore current tropical cyclones, replay Western Pacific storm tracks, and view near-real-time Himawari satellite imagery.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
