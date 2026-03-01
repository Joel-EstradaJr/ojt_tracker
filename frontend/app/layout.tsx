import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OJT Progress Tracker",
  description: "Track OJT hours, accomplishments, and progress for each trainee.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
