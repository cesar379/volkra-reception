# Textos legales (borradores)

| Documento | Para quién | Dónde publicarlo |
|---|---|---|
| [privacidad.md](privacidad.md) | Todos. Lo piden Google y Meta | https://app.volkra.es/privacidad |
| [condiciones.md](condiciones.md) | Negocios clientes | https://app.volkra.es/condiciones |
| [encargo-tratamiento.md](encargo-tratamiento.md) | Negocios clientes (anexo) | https://app.volkra.es/encargo-tratamiento |

Se publican como páginas estáticas de la app (`src/components/legal/legal-page.tsx`): editar el `.md` y desplegar.

## Datos del titular

Los únicos datos que exige la ley (LSSI art. 10 y RGPD art. 13): nombre o razón social, NIF y domicilio. Se leen de las variables de entorno `LEGAL_TITULAR`, `LEGAL_NIF` y `LEGAL_DOMICILIO` (o, si no existen, de [titular.json](titular.json)) y se insertan en los tres textos. Mientras estén vacíos, la página muestra `[TITULAR]`, `[NIF]` y `[DOMICILIO]`.

Decisiones tomadas para no pedir más datos: precio según la oferta aceptada, sin permanencia, 30 días para recuperar los datos tras la baja y juzgados del domicilio de Volkra.

Conviene que los revise un asesor RGPD, sobre todo antes de la primera clínica.

## Lo que ya cumple la app (comprobado en el código)

- El asistente se presenta como asistente virtual con IA (`src/server/agent/prompt.ts`, saludo de Vapi y ElevenLabs).
- No pide datos de salud ni los anota en el motivo (regla 7 del prompt y descripción de las herramientas).
- Texto de chat web y WhatsApp borrado al terminar; ids de WhatsApp a los 8 días (`/api/cron/daily`).
- Historial con las 4 últimas cifras del teléfono; IP y número del chat solo como *hash*.
- Tokens de Google y WhatsApp cifrados (AES-256-GCM).
- Google Calendar: solo `calendar.events` (y `openid email` para identificar la cuenta).

## Pendiente en la app

- Borrado o exportación automática de los datos de un negocio tras la baja (hoy sería manual).
- Enlace a la privacidad en el widget de chat.

## Para Google y Meta

- **Google** (pantalla de consentimiento): página de inicio `https://volkra.es`, privacidad `https://app.volkra.es/privacidad`, condiciones `https://app.volkra.es/condiciones`, dominio autorizado `volkra.es` (cubre el subdominio). La sección 7 de la privacidad incluye la declaración de Uso Limitado que exige Google. volkra.es ya tiene la etiqueta de verificación de Search Console.
- **Meta** (publicar la app): URL de privacidad `https://app.volkra.es/privacidad`; instrucciones de eliminación de datos: `https://app.volkra.es/privacidad#10-tus-derechos`.
