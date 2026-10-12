import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "EasyReach — AI Sales Workforce",
  description:
    "Connect your customer channels and business data to deliver a fast, trustworthy AI sales experience.",
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
