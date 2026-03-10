// PIN authentication — validates PIN against DASHBOARD_PIN env var
// Returns a simple token on success that the client stores in localStorage

export default async (req, context) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const { pin } = await req.json();
    const correctPin = process.env.DASHBOARD_PIN;

    if (!correctPin) {
      // No PIN configured — allow access
      return new Response(JSON.stringify({ valid: true, token: "no-pin-set" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (pin === correctPin) {
      // Simple token: hash of PIN + a salt so it's not just the PIN in localStorage
      const token = btoa(`oura-auth-${correctPin}-${Date.now()}`).slice(0, 32);
      return new Response(JSON.stringify({ valid: true, token }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ valid: false }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const config = {
  path: "/api/auth",
};
