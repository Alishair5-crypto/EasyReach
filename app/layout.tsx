import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "EasyReach — AI Sales Workforce",
    template: "%s | EasyReach",
  },
  description:
    "Connect your customer channels and verified business data to deliver a consistent, trustworthy AI sales experience.",
  applicationName: "EasyReach",
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#090b14",
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
