// Dedicated POI lookup. Never ship AMAP_WEB_SERVICE_KEY to a browser.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') return res.status(405).json({ message: '只支持 GET' });
  const key = process.env.AMAP_WEB_SERVICE_KEY;
  if (!key) return res.status(503).json({ message: '尚未配置高德 Web 服务 Key' });
  // Accept both the app's keyword and AMap's original keywords parameter.
  const rawKeyword = req.query.keyword ?? req.query.keywords ?? '';
  const keyword = typeof rawKeyword === 'string' ? rawKeyword.trim() : '';
  const children = String(req.query.children || '0');
  if (keyword.length < 1 || keyword.length > 80 || !['0', '1'].includes(children)) {
    return res.status(400).json({ message: '搜索条件无效' });
  }
  const query = new URLSearchParams({
    key, keywords: keyword, city: '370100', citylimit: 'true',
    children, offset: '50', page: '1', extensions: 'all'
  });
  try {
    const response = await fetch('https://restapi.amap.com/v3/place/text?' + query, {
      signal: AbortSignal.timeout(8500),
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) throw new Error('高德接口 HTTP ' + response.status);
    const data = await response.json();
    if (data.status !== '1') {
      return res.status(502).json({
        message: '高德搜索失败：' + (data.info || '未知错误'),
        code: String(data.infocode || 'AMAP_ERROR')
      });
    }
    // Return only the response required for place search, rather than proxy arbitrary remote URLs.
    res.status(200).json({ status: data.status, pois: Array.isArray(data.pois) ? data.pois : [], count: data.count || '0' });
  } catch (error) {
    res.status(error.name === 'TimeoutError' ? 504 : 502).json({ message: '高德搜索暂不可用，请重试' });
  }
}
