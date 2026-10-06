import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata={title:"EasyReach — AI Sales Workforce",description:"One business brain for every customer channel."};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}