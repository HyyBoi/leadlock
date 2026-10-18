import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "LeadLock", description: "Every lead has one accountable owner." };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
