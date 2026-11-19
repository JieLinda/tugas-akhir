import React from "react"
import type { Metadata } from 'next'
import { Figtree, Source_Serif_4, JetBrains_Mono } from 'next/font/google'
import './globals.css'
import { ThemeProvider } from "@/components/theme-provider"
import { AuthProvider } from "@/components/auth-provider"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"

const figtree = Figtree({
  subsets: ['latin'],
  variable: '--font-figtree',
  display: 'swap',
})

const sourceSerif = Source_Serif_4({
  subsets: ['latin'],
  variable: '--font-source-serif',
  display: 'swap',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
})

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

export const metadata: Metadata = {
  title: 'PULSE — Predictive Usage for Leadership and Successor Excellence',
  description: 'PULSE (Predictive Usage for Leadership and Successor Excellence) — Sistem otomasi primary filter, scoring, readiness, dan audit trail untuk talent & succession planning.',
  icons: {
    icon: [
      {
        url: `${basePath}/icons/favicon-16x16.png`,
        sizes: "16x16",
        type: "image/png",
      },
      {
        url: `${basePath}/icons/favicon-32x32.png`,
        sizes: "32x32",
        type: "image/png",
      },
      { url: `${basePath}/icons/favicon.ico`, type: "image/x-icon" },
    ],
    apple: `${basePath}/icons/apple-touch-icon.png`,
    other: [
      {
        rel: "mask-icon",
        url: `${basePath}/icons/safari-pinned-tab.svg`,
        color: "#5bbad5",
      },
      {
        rel: "msapplication-config",
        url: `${basePath}/icons/browserconfig.xml`,
      },
    ],
  },
  manifest: `${basePath}/icons/site.webmanifest`,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="id" suppressHydrationWarning className={`${figtree.variable} ${sourceSerif.variable} ${jetbrainsMono.variable}`}>
      <body className={`${figtree.className} font-sans antialiased`}>
        <AuthProvider>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            <TooltipProvider>{children}</TooltipProvider>
            <Toaster richColors position="top-right" />
          </ThemeProvider>
        </AuthProvider>
      </body>
    </html>
  )
}
