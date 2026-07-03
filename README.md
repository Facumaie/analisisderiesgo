# Análisis de Informes de Riesgo — DSED

App del Departamento Seguridad en Eventos Deportivos (DPEM) para la confección
de informes de análisis de riesgo de espectáculos futbolísticos.

## Estructura

```
├── index.html                      # App completa (single-file)
├── netlify.toml                    # Config Netlify (functions)
└── netlify/functions/
    ├── rss-proxy.js                # Proxy RSS para el buscador de noticias
    └── claude-proxy.js             # Proxy API Claude
```

## Deploy

1. Subir todo el contenido a un repo de GitHub (index.html en la raíz).
2. En Netlify: **Add new site → Import from GitHub** y elegir el repo.
3. Build command: vacío · Publish directory: `.` — Netlify detecta el resto por `netlify.toml`.

## Módulos

- 🏠 Inicio: dashboard de próximos partidos, pendientes y alertas
- 📋 Informes: fixture + análisis de riesgo con checklist (protocolo 5.3.1) y generación del informe consolidado
- 📊 Equipos: perfil por club (historial, interna, incidentes)
- ⚔️ Rivalidades: consulta de relación entre parcialidades y alianzas cruzadas
- ⚠️ Radicalizados: registro con import Excel (comparte colección con REPORTE MUNDIAL)
- 📰 Noticias: búsqueda unificada de violencia en el fútbol argentino y sudamericano

## Perfiles de acceso

Los mismos del REPORTE MUNDIAL (DIP / DSED). Firebase y Firestore ya están
configurados en `index.html` (proyecto `reportediario-a65ad`).
