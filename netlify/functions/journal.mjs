// Journal data — GET returns all entries, POST saves an entry
// Uses Netlify Blobs for persistent storage

import { getStore } from "@netlify/blobs";

const STORE_NAME = "oura-data";
const BLOB_KEY = "journal";

export default async (req, context) => {
  const store = getStore(STORE_NAME);

  if (req.method === "GET") {
    try {
      const data = await store.get(BLOB_KEY, { type: "json" });
      return new Response(JSON.stringify(data || {}), {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    } catch {
      return new Response("{}", {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }
  }

  if (req.method === "POST") {
    try {
      const payload = await req.json();
      const { date, entry } = payload;

      if (!date || !entry) {
        return new Response(JSON.stringify({ error: "Missing date or entry" }), {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }

      // Load existing, merge, save
      let journal = {};
      try {
        journal = (await store.get(BLOB_KEY, { type: "json" })) || {};
      } catch {
        journal = {};
      }

      journal[date] = entry;
      await store.setJSON(BLOB_KEY, journal);

      return new Response(JSON.stringify({ status: "ok" }), {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }
  }

  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config = {
  path: "/api/journal",
};
