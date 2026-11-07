export async function POST(request) {
  let payload;
  try {
    if (Number(request.headers.get("content-length")) > 16000) {
      return Response.json({ error: "Request is too large." }, { status: 413 });
    }
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) {
      return Response.json({ error: "Request origin is not allowed." }, { status: 403 });
    }
    const body = await request.text();
    if (body.length > 16000) {
      return Response.json({ error: "Request is too large." }, { status: 413 });
    }
    payload = JSON.parse(body);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error();
    }
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const limits = {
    first_name: 100,
    last_name: 100,
    email: 255,
    company: 200,
    phone: 50,
    team_size: 50,
    primary_interest: 100,
    notes: 2000,
    website_hp: 500,
    utm_source: 100,
    utm_medium: 100,
    utm_campaign: 150,
    utm_term: 100,
    utm_content: 100,
    referrer: 500,
    landing_page: 500,
    form_intent: 100,
  };

  const clean = {};
  for (const [key, limit] of Object.entries(limits)) {
    if (payload[key] != null && (typeof payload[key] !== "string" || payload[key].length > limit)) {
      return Response.json({ error: "Please shorten the form fields and try again." }, { status: 400 });
    }
    clean[key] = (payload[key] || "").trim();
  }

  const cleanEmail = (clean.email || "").toLowerCase();
  const EMAIL_REGEX = /^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$/;
  if (
    !clean.first_name ||
    !cleanEmail ||
    cleanEmail.length > 255 ||
    !EMAIL_REGEX.test(cleanEmail) ||
    cleanEmail.includes("..") ||
    cleanEmail.startsWith(".") ||
    cleanEmail.endsWith(".")
  ) {
    return Response.json(
      { error: "Please provide a valid work email address (e.g., name@company.com)." },
      { status: 400 }
    );
  }

  try {
    const base = process.env.ALTERNATE_CRM_API_URL || "https://api.alternatecrm.com";
    const upstream = await fetch(`${base.replace(/\/$/, "")}/api/public/leads/inbound`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(clean),
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });

    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok || data.success !== true) {
      if (upstream.status === 400 || upstream.status === 422) {
        return Response.json(
          { error: data.detail || data.error || "Please check your information and try again." },
          { status: 400 }
        );
      }
      if (upstream.status === 429) {
        return Response.json(
          { error: "Too many requests. Please wait a moment and try again." },
          { status: 429 }
        );
      }
      return Response.json(
        { error: "We could not save your request. Please try again." },
        { status: 502 }
      );
    }

    return Response.json(
      { success: true, message: "Thank you! Your request has been recorded." },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return Response.json(
      { error: "The access service is unavailable. We could not confirm your request was saved. Please try again." },
      { status: 503 }
    );
  }
}
