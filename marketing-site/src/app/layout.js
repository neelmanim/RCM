import { Suspense } from "react";
import { Header, Footer } from "../components/SiteChrome";
import AccessRequest from "../components/AccessRequest";
import "./globals.css";
const description = "Explore a modular CRM for customer records, notes, and sales pipeline. Try the sample workspace and see which capabilities are available or planned.";
export const metadata = {
  metadataBase: new URL("https://alternatecrm.com"),
  title: { default: "Alternate CRM | Customers, notes, and pipeline", template: "%s | Alternate CRM" },
  description,
  openGraph: { title: "Alternate CRM | Customers, notes, and pipeline", description, url: "https://alternatecrm.com", siteName: "Alternate CRM", locale: "en_US", type: "website" },
  twitter: { card: "summary_large_image", title: "Alternate CRM", description },
  icons: { icon: [{ url: "/favicon.svg", type: "image/svg+xml" }, { url: "/favicon.ico" }], apple: "/apple-touch-icon.png" },
};
export const viewport = { themeColor: "#06080c", width: "device-width", initialScale: 1 };
export default function RootLayout({ children }) {
  return <html lang="en"><body><a className="skip-link" href="#main-content">Skip to main content</a><Header />{children}<Footer /><Suspense fallback={null}><AccessRequest /></Suspense></body></html>;
}
