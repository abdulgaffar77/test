import { setDefaultResultOrder } from 'node:dns';

setDefaultResultOrder('ipv4first');   // Keep this — helps with IPv4

const TARGET_BASE = (process.env.TARGET_DOMAIN || '').replace(/\/$/, '');
const PUBLIC_RELAY_PATH = (process.env.PUBLIC_RELAY_PATH || '/relay').replace(/\/$/, '');
const RELAY_KEY = (process.env.RELAY_KEY || '').trim();

export default async ({ req, res, log, error }) => {
  if (!TARGET_BASE) {
    return res.json({ error: "TARGET_DOMAIN not set" }, 500);
  }

  // Auth
  if (RELAY_KEY) {
    const providedKey = req.headers['x-relay-key'] || req.headers['X-Relay-Key'];
    if (providedKey !== RELAY_KEY) {
      return res.text("Unauthorized", 401);
    }
  }

  const url = new URL(req.url || '/', `https://${req.host}`);
  const path = url.pathname;

  if (!path.startsWith(PUBLIC_RELAY_PATH)) {
    return res.text("Not Found", 404);
  }

  // Map path
  const upstreamPath = path === PUBLIC_RELAY_PATH ? '/' : path.replace(PUBLIC_RELAY_PATH, '');
  const targetUrl = `${TARGET_BASE}${upstreamPath}${url.search || ''}`;

  try {
    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers: {
        ...req.headers,
        'host': new URL(TARGET_BASE).host,     // ← This is the important SNI part
      },
      body: req.body,
      redirect: 'follow',
    });

    const headers = Object.fromEntries(upstream.headers);

    // Remove problematic headers
    delete headers['content-encoding'];
    delete headers['transfer-encoding'];
    delete headers['content-length'];

    if (upstream.body) {
      return res.stream(upstream.body, {
        status: upstream.status,
        headers
      });
    } else {
      return res.text(await upstream.text(), upstream.status, headers);
    }

  } catch (err) {
    error(err);
    return res.text("Relay Error", 502);
  }
};