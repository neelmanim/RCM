import Script from "next/script";
import "./globals.css";

export const metadata = {
  metadataBase: new URL("https://alternatecrm.com"),
  title: "Alternate CRM | The Autonomous Sales Conversation OS",
  description:
    "Sub-200ms WebRTC power dialer, live speech-to-intent intelligence, and autonomous multi-touch cadences. Kill the static CRM database and accelerate your revenue pipeline.",
  keywords: [
    "AI CRM",
    "Conversation OS",
    "Sales Automation",
    "WebRTC Dialer",
    "Speech to Intent",
    "Revenue Intelligence",
    "Sales Cadence",
    "Superleap alternative",
    "Salesforce alternative",
    "HubSpot alternative",
  ],
  authors: [{ name: "Alternate CRM Team" }],
  openGraph: {
    title: "Alternate CRM | The Autonomous Sales Conversation OS",
    description:
      "Sub-200ms WebRTC power dialer, live speech-to-intent intelligence, and autonomous multi-touch cadences. Kill the static CRM database and accelerate your revenue pipeline.",
    url: "https://alternatecrm.com",
    siteName: "Alternate CRM",
    images: [
      {
        url: "/icon-192.png",
        width: 192,
        height: 192,
        alt: "Alternate CRM Autonomous Sales Conversation OS",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Alternate CRM | The Autonomous Sales Conversation OS",
    description:
      "Sub-200ms WebRTC power dialer, live speech-to-intent intelligence, and autonomous multi-touch cadences. Kill the static CRM database and accelerate your revenue pipeline.",
    images: ["/icon-192.png"],
  },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export const viewport = {
  themeColor: "#080b0d",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Script id="microsoft-clarity" strategy="afterInteractive">
          {`
            (function(c,l,a,r,i,t,y){
                c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
                t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
                y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
            })(window, document, "clarity", "script", "z366fhqfpn");
          `}
        </Script>
      </body>
    </html>
  );
}

