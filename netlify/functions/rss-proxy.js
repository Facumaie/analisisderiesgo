// netlify/functions/rss-proxy.js
//
// Proxy genérico para feeds RSS/Atom (Google News, Reddit, etc.) que evita
// problemas de CORS y los bloqueos por falta de User-Agent (Reddit devuelve
// 403 Forbidden a requests sin un User-Agent de navegador).
//
// USO desde el frontend:
//   /.netlify/functions/rss-proxy?url=<URL_ENCODEADA_DEL_FEED>
//
// Si ya tenés un rss-proxy.js propio, simplemente agregá el header
// 'User-Agent' al fetch existente — es el cambio mínimo necesario para
// que los feeds de Reddit (`reddit.com/r/.../search.rss`) funcionen.

exports.handler = async function (event) {
  const targetUrl = event.queryStringParameters && event.queryStringParameters.url;

  if (!targetUrl) {
    return {
      statusCode: 400,
      body: 'Falta el parámetro "url"',
    };
  }

  try {
    const resp = await fetch(targetUrl, {
      headers: {
        // Reddit (y algunos otros sitios) bloquean requests sin User-Agent
        // de navegador real con un 403.
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
                       '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
      },
      signal: AbortSignal.timeout(15000),
    });

    const body = await resp.text();
    const contentType = resp.headers.get('content-type') || 'application/xml; charset=utf-8';

    return {
      statusCode: resp.status,
      headers: {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300', // cachear 5 minutos
      },
      body,
    };
  } catch (e) {
    return {
      statusCode: 502,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: `Error al consultar el feed: ${e.message}`,
    };
  }
};
