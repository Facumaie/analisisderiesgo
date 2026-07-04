// ═══════════════════════════════════════════════════════════════════════════
// POSICIONES v2 — fuente: API pública de ESPN (verificada y estable)
// GET /.netlify/functions/posiciones?liga=arg.2
// Devuelve: { liga, filas: [{ pos, equipo, pts, pj, nota }], fuente }
//
// Ligas argentinas en ESPN: arg.1 Liga Profesional · arg.2 Primera Nacional ·
// arg.3 Primera B Metropolitana · arg.4 Primera C · arg.5 Primera D
// "nota" trae la zona que marca ESPN (Relegation, Promotion, Copa...) cuando existe.
// ═══════════════════════════════════════════════════════════════════════════

const CACHE = {};
const TTL = 30 * 60 * 1000;

const stat = (fila, nombre) => {
  const s = (fila.stats || []).find(x => x.name === nombre);
  return s ? (typeof s.value === 'number' ? s.value : parseFloat(s.value)) : null;
};

export default async (req) => {
  const liga = (new URL(req.url).searchParams.get('liga') || '').replace(/[^a-z0-9.\-]/gi, '');
  if (!liga) return Response.json({ error: 'Falta el parámetro liga' }, { status: 400 });

  const c = CACHE[liga];
  if (c && Date.now() - c.ts < TTL) return Response.json({ ...c.data, cache: true });

  try {
    const r = await fetch(`https://site.api.espn.com/apis/v2/sports/soccer/${liga}/standings`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Accept': 'application/json' },
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) throw new Error(`ESPN respondió ${r.status}`);
    const json = await r.json();

    // La tabla vive en children[].standings.entries[]. Si hay zonas (torneos con
    // grupos), se toma la de más equipos; las entradas traen team + stats[].
    const grupos = (json.children || []).filter(ch => ch.standings?.entries?.length);
    if (!grupos.length) throw new Error('ESPN no devolvió tabla para esta liga (¿torneo inactivo?)');
    const entradas = grupos.sort((a, b) => b.standings.entries.length - a.standings.entries.length)[0].standings.entries;

    const filas = entradas.map((e, i) => ({
      pos: stat(e, 'rank') || i + 1,
      equipo: e.team?.displayName || e.team?.name || '',
      pts: stat(e, 'points') ?? 0,
      pj: stat(e, 'gamesPlayed'),
      nota: e.note?.description || '',
    })).filter(f => f.equipo).sort((a, b) => a.pos - b.pos);

    if (filas.length < 4) throw new Error('Tabla incompleta');
    const data = { liga, filas, fuente: 'ESPN (site.api.espn.com)', consultado: new Date().toISOString() };
    CACHE[liga] = { ts: Date.now(), data };
    return Response.json(data);
  } catch (e) {
    return Response.json({ error: 'No se pudo obtener la tabla (' + e.message + ').' }, { status: 502 });
  }
};
