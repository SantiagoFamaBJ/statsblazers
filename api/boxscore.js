module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { gameId } = req.query;
  if (!gameId) return res.status(400).json({ error: 'gameId requerido' });

  const targetUrl = `https://cdn.nba.com/static/json/liveData/boxscore/boxscore_${gameId}.json`;

  const commonHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Referer': 'https://www.nba.com/',
    'Origin': 'https://www.nba.com'
  };

  // Attempt 1: direct fetch
  try {
    const direct = await fetch(targetUrl, { headers: commonHeaders });
    if (direct.ok) {
      const data = await direct.json();
      return res.status(200).json(data);
    }
  } catch (e) {}

  // Attempt 2: via public CORS proxy (allorigins) - bypasses IP-based blocking
  try {
    const proxyUrl = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(targetUrl);
    const proxied = await fetch(proxyUrl);
    if (proxied.ok) {
      const data = await proxied.json();
      return res.status(200).json(data);
    }
  } catch (e) {}

  // Attempt 3: via corsproxy.io
  try {
    const proxyUrl2 = 'https://corsproxy.io/?' + encodeURIComponent(targetUrl);
    const proxied2 = await fetch(proxyUrl2, { headers: commonHeaders });
    if (proxied2.ok) {
      const data = await proxied2.json();
      return res.status(200).json(data);
    }
  } catch (e) {}

  return res.status(500).json({ error: 'Partido no encontrado o NBA.com bloqueó el acceso. Probá de nuevo en unos minutos.' });
}
