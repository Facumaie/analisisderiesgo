// ═══════════════════════════════════════════════════════════════════════════
// RSS-PROXY (versión endurecida) — reemplaza al rss-proxy anterior
// SEGURIDAD: antes aceptaba CUALQUIER url (proxy abierto: terceros podían usar
// tu Netlify para hacer requests anónimos y consumir tu cuota). Ahora solo
// permite los dominios que la app realmente consume.
// IMPORTANTE: borrar el rss-proxy.js viejo del repo al subir este archivo.
// ═══════════════════════════════════════════════════════════════════════════

const DOMINIOS_PERMITIDOS = [
  'news.google.com',
  'www.reddit.com',
  'reddit.com',
  'old.reddit.com',
];

export default async (req) => {
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET' };
  const raw = new URL(req.url).searchParams.get('url') || '';

  let destino;
  try { destino = new URL(raw); } catch { return new Response('URL inválida', { status: 400, headers: cors }); }
  if (destino.protocol !== 'https:') return new Response('Solo se permite https', { status: 400, headers: cors });
  if (!DOMINIOS_PERMITIDOS.includes(destino.hostname)) {
    return new Response(`Dominio no permitido: ${destino.hostname}`, { status: 403, headers: cors });
  }

  try {
    const r = await fetch(destino, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml' },
      signal: AbortSignal.timeout(12000),
      redirect: 'follow',
    });
    const cuerpo = await r.text();
    return new Response(cuerpo.slice(0, 800_000), {
      status: r.status,
      headers: { ...cors, 'content-type': r.headers.get('content-type') || 'text/xml; charset=utf-8', 'cache-control': 'public, max-age=120' },
    });
  } catch (e) {
    return new Response('Error al obtener el feed: ' + e.message, { status: 502, headers: cors });
  }
};
