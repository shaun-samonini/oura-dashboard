// Proxies /api/* requests to the Oura Ring API
// Keeps the token server-side so it's never exposed to the browser

const OURA_BASE = "https://api.ouraring.com/v2/usercollection";

export default async (req, context) => {
  const token = Netlify.env.get("OURA_TOKEN");
  if (!token) {
    return new Response(JSON.stringify({ error: "OURA_TOKEN not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Extract the Oura endpoint from the original URL
  // Request comes in as /.netlify/functions/oura-proxy
  // Original path was /api/daily_readiness?start_date=...&end_date=...
  // We get the original path from the x-nf-original-path header or reconstruct from splat
  const url = new URL(req.url);
  const originalPath = req.headers.get("x-nf-request-uri") || url.pathname;

  // Strip /api prefix to get the Oura endpoint + query string
  const apiPath = originalPath.replace(/^\/api/, "");
  const queryString = url.search;
  const ouraUrl = `${OURA_BASE}${apiPath}${queryString}`;

  try {
    const response = await fetch(ouraUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });

    const body = await response.text();

    return new Response(body, {
      status: response.status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: "Could not reach Oura API", detail: error.message }),
      {
        status: 502,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
};

export const config = {
  path: "/api/*",
};
