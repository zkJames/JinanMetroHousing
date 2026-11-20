// The browser-facing JS API key is public by design; server-side security values must stay secret.
export default function handler(req, res) {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const key = (process.env.AMAP_JS_API_KEY || '').trim();
  const payload = {
    jsApiKey: key,
    proxyPoi: true,
    useProxy: true,
    webServiceKey: '',
    missingConfig: !key
  };
  res.status(200).send('window.JINAN_MAP_CONFIG = ' + JSON.stringify(payload).replace(/</g, '\\u003c') + ';');
}
