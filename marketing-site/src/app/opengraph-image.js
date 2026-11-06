import { ImageResponse } from "next/og";

export const alt = "Alternate CRM | The Autonomous Sales Conversation OS";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "space-between",
          backgroundColor: "#06080c",
          backgroundImage:
            "radial-gradient(circle at 25% 25%, rgba(99, 102, 241, 0.18) 0%, transparent 50%), radial-gradient(circle at 75% 75%, rgba(211, 250, 118, 0.12) 0%, transparent 50%)",
          padding: "80px",
          fontFamily: "system-ui, -apple-system, sans-serif",
          color: "#ffffff",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div
            style={{
              width: "56px",
              height: "56px",
              borderRadius: "16px",
              backgroundColor: "#d3fa76",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "32px",
              color: "#06080c",
              fontWeight: 900,
            }}
          >
            ✳
          </div>
          <span
            style={{
              fontSize: "36px",
              fontWeight: 900,
              letterSpacing: "-0.04em",
              color: "#ffffff",
            }}
          >
            alternate<span style={{ color: "#d3fa76" }}>crm</span>
          </span>
          <span
            style={{
              marginLeft: "12px",
              padding: "6px 14px",
              borderRadius: "9999px",
              backgroundColor: "rgba(99, 102, 241, 0.2)",
              border: "1px solid rgba(99, 102, 241, 0.4)",
              color: "#a5b4fc",
              fontSize: "14px",
              fontWeight: 800,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            CONVERSATION OS
          </span>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "20px",
            maxWidth: "960px",
          }}
        >
          <h1
            style={{
              fontSize: "64px",
              fontWeight: 900,
              letterSpacing: "-0.04em",
              lineHeight: 1.1,
              margin: 0,
              color: "#ffffff",
            }}
          >
            Kill the static CRM.
            <br />
            <span
              style={{
                backgroundImage: "linear-gradient(90deg, #d3fa76, #38bdf8)",
                backgroundClip: "text",
                color: "transparent",
              }}
            >
              Accelerate your pipeline.
            </span>
          </h1>
          <p
            style={{
              fontSize: "24px",
              color: "#94a3b8",
              lineHeight: 1.5,
              margin: 0,
            }}
          >
            Sub-200ms WebRTC power dialer, live speech-to-intent intelligence, and
            autonomous multi-touch cadences.
          </p>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "32px",
            color: "#64748b",
            fontSize: "18px",
            fontWeight: 600,
          }}
        >
          <span>🔒 Zero sign-in required</span>
          <span>•</span>
          <span>⚡ Pre-seeded enterprise pipeline</span>
          <span>•</span>
          <span>🛡️ SOC2 Type II compliance ready</span>
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}
