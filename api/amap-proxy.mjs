// Official JSAPI serviceHost proxy endpoint /_AMapService/*.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();
  const jsCode = process.env.AMAP_SECURITY_JS_CODE;
  if (!jsCode) return res.status(503).json({ message: '尚未配置高德 JS API 安全密钥' });
  const rawPath = req.query.path;
  const path = Array.isArray(rawPath) ? rawPath.join('/') : String(rawPath || '');
  // Only route the documented JS API proxy request paths, never arbitrary URLs or hosts.
  if (!/^(v3|v4|v5)\/[a-zA-Z0-9_./-]+$/.test(path) || path.includes('..') || path.length > 220) {
    return res.status(400).json({ message: '不支持的高德接口路径' });
  }
  const isStyle = path.startsWith('v4/map/styles');
  const host = isStyle ? 'https://webapi.amap.com/' : 'https://restapi.amap.com/';
  const query = new URLSearchParams();
  const original = new URL(req.url, 'https://example.invalid');
  for (const [key, value] of original.searchParams) {
    if (key === 'path' || key === 'jscode') continue;
    if (key.length <= 64 && value.length <= 2000) query.append(key, value);
  }
  query.set('jscode', jsCode);
  const headers = { Accept: 'application/json,text/plain,*/*' };
  if (req.method === 'POST') headers['Content-Type'] = req.headers['content-type'] || 'application/x-www-form-urlencoded';
  try {
    let body;
    if (req.method === 'POST') {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 16384) return res.status(413).end();
        chunks.push(chunk);
      }
      body = Buffer.concat(chunks);
    }
    const upstream = await fetch(host + path + '?' + query.toString(), {
      method: req.method, headers, body,
      signal: AbortSignal.timeout(9000),
      redirect: 'error'
    });
    const contentType = upstream.headers.get('content-type') || 'application/json';
    if (!/^(application\/json|text\/plain|application\/javascript|text\/javascript|image\/)/i.test(contentType)) {
      return res.status(502).end();
    }
    const bytes = Buffer.from(await upstream.arrayBuffer());
    if (bytes.length > 1500000) return res.status(502).end();
    res.setHeader('Content-Type', contentType);
    res.status(upstream.status).send(bytes);
  } catch (_) {
    return res.status(502).json({ message: '高德代理连接失败' });
  }
}
