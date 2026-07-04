// ═══════════════════════════════════════════════════════════════════════════
// POSICIONES — proxy a la API de Promiedos (api.promiedos.com.ar)
// GET /.netlify/functions/posiciones?liga={id}   (ej: liga=ebj → Primera Nacional)
// Devuelve: { liga, filas: [{ pos, equipo, pts, pj }], fuente }
//
// La API de Promiedos no está documentada, así que la extracción es GENÉRICA:
// prueba varios endpoints y busca recursivamente en el JSON cualquier array
// que parezca una tabla de posiciones (objetos con nombre de equipo + puntos).
// Si Promiedos cambia el esquema, esto sigue funcionando mientras la tabla
// exista en la respuesta.
// ═══════════════════════════════════════════════════════════════════════════

const CACHE = {}; // { liga: { ts, data } } — cache en memoria 30 min por instancia
const TTL = 30 * 60 * 1000;

const CAMPOS_NOMBRE = ['name', 'team', 'team_name', 'equipo', 'nombre', 'short_name'];
const CAMPOS_PTS = ['points', 'pts', 'puntos', 'p'];
const CAMPOS_POS = ['position', 'pos', 'rank', 'puesto', 'idx'];
const CAMPOS_PJ = ['played', 'pj', 'matches', 'games', 'jugados'];

const leerCampo = (o, campos) => {
  for (const c of campos) {
    if (o[c] !== undefined && o[c] !== null) {
      // el valor puede venir anidado ({ name: { short: 'X' } }) o directo
      const v = o[c];
      if (typeof v === 'object') { const s = v.short_name || v.name || v.value; if (s !== undefined) return s; continue; }
      return v;
    }
  }
  return undefined;
};

// ¿Este array parece una tabla de posiciones?
function esTabla(arr) {
  if (!Array.isArray(arr) || arr.length < 4) return false;
  const objetos = arr.filter(x => x && typeof x === 'object');
  if (objetos.length < 4) return false;
  let ok = 0;
  for (const o of objetos) {
    const nombre = leerCampo(o, CAMPOS_NOMBRE);
    const pts = leerCampo(o, CAMPOS_PTS);
    if (typeof nombre === 'string' && nombre.length > 1 && pts !== undefined && !isNaN(parseInt(pts))) ok++;
  }
  return ok >= objetos.length * 0.8;
}

// Busca recursivamente la tabla más grande dentro del JSON
function buscarTabla(nodo, encontradas = []) {
  if (Array.isArray(nodo)) {
    if (esTabla(nodo)) encontradas.push(nodo);
    nodo.forEach(x => buscarTabla(x, encontradas));
  } else if (nodo && typeof nodo === 'object') {
    Object.values(nodo).forEach(v => buscarTabla(v, encontradas));
  }
  return encontradas;
}

export default async (req) => {
  const url = new URL(req.url);
  const liga = (url.searchParams.get('liga') || '').replace(/[^a-z0-9]/gi, '');
  if (!liga) return Response.json({ error: 'Falta el parámetro liga' }, { status: 400 });

  const c = CACHE[liga];
  if (c && Date.now() - c.ts < TTL) return Response.json({ ...c.data, cache: true });

  const endpoints = [
    `https://api.promiedos.com.ar/leaguetables/${liga}`,
    `https://api.promiedos.com.ar/league/tables/${liga}`,
    `https://api.promiedos.com.ar/league/${liga}`,
  ];
  const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Referer': 'https://www.promiedos.com.ar/', 'Accept': 'application/json' };

  for (const ep of endpoints) {
    try {
      const r = await fetch(ep, { headers, signal: AbortSignal.timeout(10000) });
      if (!r.ok) continue;
      const json = await r.json();
      const tablas = buscarTabla(json);
      if (!tablas.length) continue;
      // La tabla "real" es la más larga (evita agarrar goleadores u otros arrays chicos)
      const tabla = tablas.sort((a, b) => b.length - a.length)[0];
      const filas = tabla.map((o, i) => ({
        pos: parseInt(leerCampo(o, CAMPOS_POS)) || i + 1,
        equipo: String(leerCampo(o, CAMPOS_NOMBRE) || '').trim(),
        pts: parseInt(leerCampo(o, CAMPOS_PTS)) || 0,
        pj: parseInt(leerCampo(o, CAMPOS_PJ)) || null,
      })).filter(f => f.equipo);
      const data = { liga, filas, fuente: ep, consultado: new Date().toISOString() };
      CACHE[liga] = { ts: Date.now(), data };
      return Response.json(data);
    } catch (e) { /* probar el siguiente endpoint */ }
  }
  return Response.json({ error: 'No se pudo obtener la tabla de Promiedos para esta liga. Puede que la API haya cambiado o el torneo no esté activo.' }, { status: 502 });
};
