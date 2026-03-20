import type { Metadata } from "next";
import "./globals.css";
import ThemeProvider from "@/components/ThemeProvider";
import ButtonProtectionProvider from "@/components/ButtonProtectionProvider";

export const metadata: Metadata = {
  title: "OJT Progress Tracker",
  description: "Track OJT hours, accomplishments, and progress for each trainee.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <ButtonProtectionProvider>{children}</ButtonProtectionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
