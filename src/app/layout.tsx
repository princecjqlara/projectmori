import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Mori — Conversations to customers",
  description:
    "Your conversations, customers, and campaign performance. Together in one thoughtful workspace.",
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
