import express from "express";
import dotenv from "dotenv";
import { MongoClient } from "mongodb";

dotenv.config();

// ---------- CONFIG ----------
const {
  PORT = 3000,
  NINJA_HOST,
  NINJA_CLIENT_ID,
  NINJA_CLIENT_SECRET,
  OAUTH_REDIRECT_URI,
  NINJA_SCOPES = "management offline_access",
  MONGO_URI,
  MONGO_DB = "ninjaone_tokens",
  MONGO_COLLECTION = "oauth_tokens",
  MONGO_DOC_ID = "ninjaone",
} = process.env;

if (!NINJA_CLIENT_ID || !NINJA_CLIENT_SECRET || !MONGO_URI) {
  console.error("❌ Missing required env vars. Check .env");
  process.exit(1);
}

const AUTH_URL = `https://${NINJA_HOST}/oauth/authorize`;
const TOKEN_URL = `https://${NINJA_HOST}/ws/oauth/token`;

const app = express();
app.use(express.json());
app.use((_, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  next();
});

const client = new MongoClient(MONGO_URI);
let col;
let tokenCache = null;

const now = () => Date.now();
const willExpireSoon = (t) =>
  !t?.expires_at_ms || t.expires_at_ms - now() < 10 * 60 * 1000;

// ---------- TOKEN STORE ----------
async function initMongo() {
  await client.connect();
  col = client.db(MONGO_DB).collection(MONGO_COLLECTION);
}

async function loadTokens() {
  if (tokenCache) return tokenCache;
  const doc = await col.findOne({ _id: MONGO_DOC_ID });
  tokenCache = doc?.tokenSet || null;
  return tokenCache;
}

async function saveTokens(t) {
  tokenCache = { ...t, updated_at: new Date().toISOString() };
  await col.updateOne(
    { _id: MONGO_DOC_ID },
    { $set: { tokenSet: tokenCache } },
    { upsert: true }
  );
  return tokenCache;
}

// ---------- OAUTH ----------
app.get("/", (_, res) => res.send("NinjaOne Ticket Broker (MongoDB) running."));

app.get("/debug/tokens", async (_, res) => {
  const t = await loadTokens();
  if (!t) return res.json({ authorized: false });
  res.json({
    authorized: true,
    access_token_len: t.access_token?.length ?? 0,
    refresh_token_len: t.refresh_token?.length ?? 0,
    expires_in_s: Math.max(0, Math.round((t.expires_at_ms - now()) / 1000)),
  });
});

app.get("/oauth/start", (_, res) => {
  const url = new URL(AUTH_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", NINJA_CLIENT_ID);
  url.searchParams.set("redirect_uri", OAUTH_REDIRECT_URI);
  url.searchParams.set("scope", NINJA_SCOPES);
  url.searchParams.set("prompt", "consent"); // force fresh refresh_token
  res.redirect(url.toString());
});

app.get("/oauth/callback", async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.status(400).send(`OAuth error: ${error}`);
  if (!code) return res.status(400).send("Missing code");

  const basic = Buffer.from(
    `${NINJA_CLIENT_ID}:${NINJA_CLIENT_SECRET}`
  ).toString("base64");
  const form = new URLSearchParams();
  form.set("grant_type", "authorization_code");
  form.set("code", code);
  form.set("redirect_uri", OAUTH_REDIRECT_URI);

  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form,
  });
  const j = await r.json();
  if (!r.ok)
    return res
      .status(r.status)
      .send(`Token exchange failed: ${JSON.stringify(j)}`);

  await saveTokens({
    ...j,
    expires_at_ms: now() + Math.max(0, (j.expires_in ?? 0) - 60) * 1000,
  });

  res.send("<p>✅ Authorized. You can close this tab.</p>");
});

// ---------- TOKEN MANAGEMENT ----------
async function refreshAccessToken() {
  const t = await loadTokens();
  if (!t?.refresh_token) throw new Error("No refresh_token. Re-authorize.");
  const basic = Buffer.from(
    `${NINJA_CLIENT_ID}:${NINJA_CLIENT_SECRET}`
  ).toString("base64");
  const form = new URLSearchParams();
  form.set("grant_type", "refresh_token");
  form.set("refresh_token", t.refresh_token);

  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form,
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`Refresh failed: ${JSON.stringify(j)}`);

  const next = {
    ...t,
    ...j,
    refresh_token: j.refresh_token ?? t.refresh_token,
    expires_at_ms: now() + Math.max(0, (j.expires_in ?? 0) - 60) * 1000,
  };
  await saveTokens(next);
  return next.access_token;
}

async function getAccessToken() {
  const t = await loadTokens();
  if (!t) throw new Error("Not authorized yet. Visit /oauth/start");
  if (willExpireSoon(t)) return refreshAccessToken();
  return t.access_token;
}

async function ninjaRequest(method, path, data) {
  const doCall = async () => {
    const token = await getAccessToken();
    return fetch(`https://${NINJA_HOST}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: data ? JSON.stringify(data) : undefined,
    });
  };

  let resp = await doCall();
  if (resp.status === 401) {
    await refreshAccessToken();
    resp = await doCall();
  }
  if (!resp.ok) {
    throw new Error(
      `${method} ${path} failed: ${resp.status} ${await resp.text()}`
    );
  }
  return resp.json();
}

// ---------- PUBLIC APIs ----------

// Public endpoint: return a fresh access_token for Make.com
app.get("/api/access-token", async (req, res) => {
  try {
    const token = await getAccessToken(); // auto-refreshes if expiring
    res.json({ access_token: token });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Create Ticket
app.post("/api/tickets", async (req, res) => {
  try {
    const data = await ninjaRequest("POST", "/v2/ticketing/ticket", req.body);
    res.status(201).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Update ticket (full object with only allowed fields)
app.put("/api/tickets/:id", async (req, res) => {
  try {
    const id = req.params.id;

    // Fetch existing ticket
    const current = await ninjaRequest(
      "GET",
      `/v2/ticketing/ticket/${encodeURIComponent(id)}`
    );

    // Pick only allowed fields
    const allowedKeys = [
      "cc",
      "priority",
      "clientId",
      "ticketFormId",
      "subject",
      "locationId",
      "parentTicketId",
      "status",
      "requesterUid",
      "attributes",
      "version",
      "assignedAppUserId",
      "type",
      "nodeId",
      "additionalAssignedTechnicianIds",
      "tags",
      "severity",
    ];
    const filtered = {};
    for (const key of allowedKeys) {
      if (current[key] !== undefined) filtered[key] = current[key];
    }

    // Merge updates from request body (e.g. { status: 5000 })
    const payload = { ...filtered, ...req.body };

    // PUT update
    const updated = await ninjaRequest(
      "PUT",
      `/v2/ticketing/ticket/${encodeURIComponent(id)}`,
      payload
    );
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get all organizations
app.get("/api/organizations", async (req, res) => {
  try {
    const data = await ninjaRequest("GET", "/v2/organizations");
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get single organization by ID (filter from all orgs)
app.get("/api/organizations/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // fetch all orgs
    const data = await ninjaRequest("GET", "/v2/organizations");

    // find the one with matching ID
    const org = data.find((o) => String(o.id) === String(id));

    if (!org) {
      return res.status(404).json({ error: `Organization ${id} not found` });
    }

    res.json(org);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get single ticket by ID
app.get("/api/tickets/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const data = await ninjaRequest(
      "GET",
      `/v2/ticketing/ticket/${encodeURIComponent(id)}`
    );
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- START ----------
(async () => {
  await initMongo();
  app.listen(PORT, () => {
    console.log(`✅ Server running on http://localhost:${PORT}`);
    console.log(`Authorize at http://localhost:${PORT}/oauth/start`);
  });
})();
