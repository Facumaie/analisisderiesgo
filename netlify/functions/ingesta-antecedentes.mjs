// ═══════════════════════════════════════════════════════════════════════════
// INGESTA AUTOMÁTICA DE ANTECEDENTES — Netlify Scheduled Function
// Corre cada 6 horas: lee los clubes del fixture futuro (air_fixture),
// busca noticias de incidentes en Google News RSS y las guarda en
// air_antecedentes con estado "pendiente" para validar desde la app (tab Inicio).
// No pondera en el motor de riesgo hasta que un operador la apruebe.
// ═══════════════════════════════════════════════════════════════════════════

export const config = { schedule: "0 */6 * * *" }; // cada 6 hs (UTC)

const PROJECT = "reportediario-a65ad";
const API_KEY = "AIzaSyBCaMF3aUlEBxfKZLDCyksGwSgNsWUGHt0";
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

// Mismas keywords que la pestaña Noticias de la app
const KEYWORDS = ['barra','hincha','radicaliz','faccion','facción','violencia','incidente','disturbio','detenido','ultra','aguante','banderazo','enfrentamiento','arresto','detencion','detención','pelea','agresion','agresión','herido','tiroteo','pirotecnia','avalancha','suspendido','clausura'];
const KEYWORDS_GRAVES = ['herido','tiroteo','muert','apuñal','apunal','baleado','fallec','avalancha'];
// La noticia además tiene que ser DE FÚTBOL: sin esto, "hallaron un arsenal de armas"
// o una nota del diario "El Porvenir" matchean como si fueran los clubes.
const CONTEXTO_FUTBOL = ['futbol','fútbol','partido','hincha','barra','club','torneo','cancha','estadio','afa','ascenso','primera','liga','clasico','clásico','plantel','jugador','tribuna','aprevide','descenso','copa','fecha','vestuario','parcialidad'];
// Clubes cuyo nombre es una palabra común, un lugar o un medio: exigen doble contexto
const CLUBES_AMBIGUOS = ['ARSENAL','EL PORVENIR','ATLANTA','INDEPENDIENTE','UNION','COLON','HURACAN','BELGRANO','TIGRE','PLATENSE','BROWN','MITRE','GUEMES','SARMIENTO','ESTUDIANTES','DEFENSA Y JUSTICIA','SAN MARTIN','QUILMES','BANFIELD','LANUS','MORON','MERLO','ALVARADO','LIBERTAD','JUVENTUD UNIDA','EXCURSIONISTAS','DOCK SUD','ARGENTINO','CENTRAL','RIVER','PROGRESO','PORVENIR','VICTORIA'];
// Google News agrega " - Fuente" (y a veces " - Fuente - Sección") al final del título
function tituloSinMedio(titulo) {
  let t = titulo;
  for (let i = 0; i < 2; i++) {
    const r = t.replace(/\s[-–—]\s[^-–—]{1,40}$/, '');
    if (r.length >= 20) t = r; else break;
  }
  return t;
}

const norm = s => (s || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
const hash = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36); };

async function fsGet(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Firestore GET ${r.status}: ${await r.text()}`);
  return r.json();
}

// Trae todos los docs de una colección (paginado), con máscara de campos opcional
async function fsListar(col, campos = []) {
  const docs = []; let pageToken = '';
  do {
    const mask = campos.map(c => `&mask.fieldPaths=${c}`).join('');
    const data = await fsGet(`${BASE}/${col}?key=${API_KEY}&pageSize=300${mask}${pageToken ? '&pageToken=' + pageToken : ''}`);
    (data.documents || []).forEach(d => docs.push(d));
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return docs;
}

function parseRss(xml, fuente) {
  const items = [];
  const bloques = xml.split('<item>').slice(1);
  for (const b of bloques) {
    const tag = (t) => {
      const m = b.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`));
      return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, '').trim() : '';
    };
    const titulo = tag('title'), link = tag('link'), pub = tag('pubDate'), desc = tag('description');
    const srcM = b.match(/<source[^>]*>([\s\S]*?)<\/source>/);
    if (titulo && link) items.push({
      titulo, link, desc,
      fuente: srcM ? srcM[1].trim() : fuente,
      fecha: pub ? new Date(pub).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
    });
  }
  return items;
}

export default async () => {
  const resumen = { clubes: 0, noticias: 0, nuevas: 0, duplicadas: 0, errores: [] };
  try {
    // 1) Clubes con partidos de hoy en adelante
    const hoy = new Date().toISOString().slice(0, 10);
    const fixture = await fsListar('air_fixture', ['local', 'visitante', 'fecha']);
    const clubes = new Set();
    fixture.forEach(d => {
      const f = d.fields || {};
      if ((f.fecha?.stringValue || '') >= hoy) {
        if (f.local?.stringValue) clubes.add(norm(f.local.stringValue));
        if (f.visitante?.stringValue) clubes.add(norm(f.visitante.stringValue));
      }
    });
    resumen.clubes = clubes.size;
    if (!clubes.size) return new Response(JSON.stringify({ ...resumen, msg: 'Sin partidos futuros en el fixture.' }));

    // 2) Links ya guardados (evita duplicar antecedentes manuales o de corridas previas)
    const existentes = new Set();
    (await fsListar('air_antecedentes', ['link'])).forEach(d => {
      const l = d.fields?.link?.stringValue; if (l) existentes.add(l);
    });

    // 3) Google News RSS por club, últimos 7 días (máx. 20 clubes por corrida)
    for (const club of [...clubes].slice(0, 20)) {
      try {
        const q = `"${club}" (barra OR incidentes OR detenidos OR enfrentamiento OR violencia OR pirotecnia OR banderazo OR suspendido) (futbol OR hinchas OR club OR partido OR cancha OR estadio) when:7d`;
        const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=es-419&gl=AR&ceid=AR:es`;
        const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
        if (!r.ok) continue;
        const items = parseRss(await r.text(), 'Google News');

        for (const n of items.slice(0, 8)) {
          // El club tiene que aparecer en el TÍTULO REAL (sin el " - Medio" que agrega Google)
          const tituloReal = tituloSinMedio(n.titulo);
          const texto = norm(tituloReal + ' ' + n.desc);
          if (!texto.includes(club) && !club.split(' ').some(w => w.length > 4 && texto.includes(w))) continue;
          const textoLc = (tituloReal + ' ' + n.desc).toLowerCase();
          if (!KEYWORDS.some(k => textoLc.includes(k))) continue;
          // Contexto futbolero obligatorio; doble para clubes de nombre ambiguo
          const contexto = CONTEXTO_FUTBOL.filter(c => textoLc.includes(c)).length;
          const minimo = CLUBES_AMBIGUOS.some(a => club === a || club.includes(a)) ? 2 : 1;
          if (contexto < minimo) continue;
          resumen.noticias++;
          if (existentes.has(n.link)) { resumen.duplicadas++; continue; }

          // 4) Crear con ID determinístico (hash del link): otra red anti-duplicados
          const docId = 'auto_' + hash(n.link);
          const body = { fields: {
            club:     { stringValue: club },
            fecha:    { stringValue: n.fecha },
            gravedad: { stringValue: KEYWORDS_GRAVES.some(k => textoLc.includes(k)) ? 'grave' : 'menor' },
            titulo:   { stringValue: n.titulo.slice(0, 300) },
            link:     { stringValue: n.link },
            fuente:   { stringValue: `ingesta auto · ${n.fuente}`.slice(0, 120) },
            estado:   { stringValue: 'pendiente' },
            ts:       { timestampValue: new Date().toISOString() },
          }};
          const cr = await fetch(`${BASE}/air_antecedentes?documentId=${docId}&key=${API_KEY}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
          });
          if (cr.ok) { resumen.nuevas++; existentes.add(n.link); }
          else if (cr.status === 409) resumen.duplicadas++;
          else resumen.errores.push(`${club}: ${cr.status}`);
        }
      } catch (e) { resumen.errores.push(`${club}: ${e.message}`); }
    }
    return new Response(JSON.stringify(resumen));
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message, ...resumen }), { status: 500 });
  }
};
