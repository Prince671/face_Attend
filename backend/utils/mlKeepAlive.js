const fetch = require('node-fetch');

const normalizeHealthUrl = (baseUrl) => {
  if (!baseUrl) return null;
  const trimmed = String(baseUrl).trim().replace(/\/+$/, '');
  if (!trimmed) return null;
  return /\/health$/i.test(trimmed) ? trimmed : `${trimmed}/health`;
};

const startMlKeepAlive = () => {
  const enabled = String(process.env.ML_KEEPALIVE_ENABLED || '').toLowerCase() === 'true';
  const healthUrl = normalizeHealthUrl(process.env.ML_KEEPALIVE_URL || process.env.ML_SERVICE_URL);

  if (!enabled || !healthUrl) {
    return null;
  }

  const intervalMs = Math.max(Number(process.env.ML_KEEPALIVE_INTERVAL_MS || 60000), 30000);
  const timeoutMs = Math.max(Number(process.env.ML_KEEPALIVE_TIMEOUT_MS || 10000), 3000);
  let running = false;

  const ping = async () => {
    if (running) return;
    running = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(healthUrl, {
        method: 'GET',
        signal: controller.signal,
        headers: { 'User-Agent': 'StudySphere-ML-KeepAlive/1.0' },
      });

      if (!response.ok) {
        console.warn(`ML keep-alive returned ${response.status} for ${healthUrl}`);
      }
    } catch (error) {
      console.warn(`ML keep-alive failed: ${error.message}`);
    } finally {
      clearTimeout(timeout);
      running = false;
    }
  };

  setTimeout(ping, 5000);
  const interval = setInterval(ping, intervalMs);
  console.log(`ML keep-alive enabled: ${healthUrl} every ${Math.round(intervalMs / 1000)}s`);
  return interval;
};

module.exports = { startMlKeepAlive };
