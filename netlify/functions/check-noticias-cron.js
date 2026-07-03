// netlify/functions/check-noticias-cron.js
//
// Función programada (Netlify Scheduled Functions) que corre periódicamente,
// consulta feeds de noticias sobre VIOLENCIA EN EL FÚTBOL ARGENTINO y equipos
// SUDAMERICANOS jugando en Argentina, detecta noticias NUEVAS de relevancia
// "alta" y las envía al grupo de Telegram del DSED.
//
// Programación: ver netlify.toml ([[scheduled.functions]])
// Persistencia de "ya notificados": Netlify Blobs (@netlify/blobs).

const TG_TOKEN   = process.env.TG_TOKEN   || '8107695059:AAE-tB_4LEsngQj3qqbyh8y4x4j8eFhrSTk';
const TG_CHAT_ID = process.env.TG_CHAT_ID || '-1003955392468';

const RSS_KEYWORDS_DURAS = [
  'barra','hincha','radicaliz','faccion','violencia','incidente','disturbio',
  'detenido','ultra','aguante','traslado','concentracion','banderazo','captura',
  'admision','enfrentamiento','arresto','detencion','pelea','agresion','herido',
  'tiroteo','pirotecnia','avalancha','suspendido por incidentes',
];

function googleNewsUrl(q) {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=es-419&gl=AR&ceid=AR:es`;
}
function redditSearchUrl(subreddit, q) {
  return `https://www.reddit.com/r/${subreddit}/search.rss?q=${encodeURIComponent(q)}&restrict_sr=on&sort=new&t=year`;
}

// Feeds enfocados en violencia en el fútbol argentino + visitas sudamericanas
const FEEDS_CRON = [
  { id: 'g_barras',    label: 'Barras bravas Argentina', tipo: 'rss',
    url: googleNewsUrl('barras bravas Argentina incidentes') },
  { id: 'g_violencia', label: 'Violencia en el fútbol argentino', tipo: 'rss',
    url: googleNewsUrl('violencia hinchas fútbol argentino incidentes estadio') },
  { id: 'g_ascenso',   label: 'Incidentes en el Ascenso', tipo: 'rss',
    url: googleNewsUrl('incidentes hinchas Primera Nacional Primera B ascenso') },
  { id: 'g_radicaliz', label: 'Radicalizados / D. de Admisión', tipo: 'rss',
    url: googleNewsUrl('radicalizados fútbol derecho admisión estadio Argentina') },
  { id: 'g_interna',   label: 'Internas de barras', tipo: 'rss',
    url: googleNewsUrl('interna barra brava disputa poder facción') },
  { id: 'g_liberta',   label: 'Copa Libertadores en Argentina', tipo: 'rss',
    url: googleNewsUrl('hinchas Copa Libertadores Buenos Aires incidentes visitante') },
  { id: 'g_sudam',     label: 'Copa Sudamericana en Argentina', tipo: 'rss',
    url: googleNewsUrl('hinchas Copa Sudamericana Argentina incidentes') },
  { id: 'g_extranj',   label: 'Hinchadas sudamericanas visitantes', tipo: 'rss',
    url: googleNewsUrl('hinchas brasileños OR chilenos OR uruguayos OR paraguayos Buenos Aires estadio') },
  { id: 'g_reddit_arg', label: 'Reddit r/Argentina', tipo: 'reddit',
    url: redditSearchUrl('Argentina', 'barra brava OR incidentes hinchas') },
  { id: 'g_reddit_fut', label: 'Reddit r/futbol', tipo: 'reddit',
    url: redditSearchUrl('futbol', 'barra brava Argentina OR violencia hinchas') },
];

function clasificarRelevanciaAlta(titulo, desc) {
  const t = (titulo + ' ' + desc).toLowerCase();
  return RSS_KEYWORDS_DURAS.some(k => t.includes(k));
}

function extraerTag(block, tag) {
  const r = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = block.match(r);
  return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : '';
}
function extraerLinkHref(block) {
  const m = block.match(/<link[^>]*href="([^"]+)"/i);
  return m ? m[1] : '';
}

async function fetchFeedItems(feed) {
  const resp = await fetch(feed.url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
                     '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const xml = await resp.text();

  const items = [];
  if (feed.tipo === 'reddit') {
    const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
    let m;
    while ((m = entryRegex.exec(xml)) !== null) {
      const block = m[1];
      items.push({
        titulo: extraerTag(block, 'title'),
        link:   extraerLinkHref(block) || extraerTag(block, 'id'),
        desc:   extraerTag(block, 'content').replace(/<[^>]+>/g, '').slice(0, 180)
                  || extraerTag(block, 'summary').replace(/<[^>]+>/g, '').slice(0, 180),
        fecha:  extraerTag(block, 'updated') || extraerTag(block, 'published'),
      });
    }
  } else {
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let m;
    while ((m = itemRegex.exec(xml)) !== null) {
      const block = m[1];
      items.push({
        titulo: extraerTag(block, 'title'),
        link:   extraerTag(block, 'link') || extraerTag(block, 'guid'),
        desc:   extraerTag(block, 'description').replace(/<[^>]+>/g, '').slice(0, 180),
        fecha:  extraerTag(block, 'pubDate'),
      });
    }
  }
  return items.filter(n => n.titulo).slice(0, 30);
}

async function sendTelegram(text) {
  if (!TG_TOKEN || !TG_CHAT_ID) return;
  const resp = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TG_CHAT_ID, text, parse_mode: 'Markdown' }),
  });
  if (!resp.ok) {
    const data = await resp.json().catch(() => null);
    console.warn('Error enviando Telegram:', data);
  }
}

let getStore = null;
try { ({ getStore } = require('@netlify/blobs')); } catch (e) {}

exports.handler = async function () {
  const nuevasAlertas = [];

  let store = null;
  let yaNotificados = new Set();
  if (getStore) {
    try {
      store = getStore('noticias-notificadas');
      const data = await store.get('links', { type: 'json' });
      if (Array.isArray(data)) yaNotificados = new Set(data);
    } catch (e) { console.warn('No se pudo leer Netlify Blobs:', e.message); }
  }

  const LIMITE_FECHA = new Date();
  LIMITE_FECHA.setMonth(LIMITE_FECHA.getMonth() - 4);

  for (const feed of FEEDS_CRON) {
    try {
      const items = await fetchFeedItems(feed);
      for (const n of items) {
        if (!n.link || yaNotificados.has(n.link)) continue;
        if (!n.fecha) continue;
        const f = new Date(n.fecha);
        if (isNaN(f) || f < LIMITE_FECHA) continue;
        if (!clasificarRelevanciaAlta(n.titulo, n.desc)) continue;
        nuevasAlertas.push({ ...n, feedLabel: feed.label });
        yaNotificados.add(n.link);
      }
    } catch (e) { console.warn(`Error en feed ${feed.label}:`, e.message); }
  }

  if (nuevasAlertas.length > 0) {
    let msg = `🔴 *ALERTA — Violencia en el fútbol / noticias relevancia alta*\n\n`;
    nuevasAlertas.slice(0, 8).forEach(n => {
      msg += `📰 *${n.feedLabel}*\n${n.titulo}\n${n.link}\n\n`;
    });
    msg += `_Análisis de Informes de Riesgo — DSED · revisión automática_`;
    await sendTelegram(msg);
  }

  if (store) {
    try {
      const arr = Array.from(yaNotificados).slice(-500);
      await store.setJSON('links', arr);
    } catch (e) { console.warn('No se pudo guardar en Netlify Blobs:', e.message); }
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true, nuevas: nuevasAlertas.length }) };
};
