# 5. Decisiones técnicas

## Proveedor de voz: Vapi (frente a Retell AI y ElevenLabs)

Se eligió **Vapi**. Lo que pesó, comprobado en su documentación y su especificación OpenAPI (octubre de 2026):

- **Asistente por llamada (`assistant-request`).** En cada llamada Vapi pregunta a nuestro servidor qué asistente usar. Un único despliegue sirve a todos los negocios, y cualquier cambio en la configuración se aplica en la siguiente llamada, sin sincronizar nada.
- **Claude como cerebro.** Proveedor `anthropic` nativo, con `claude-sonnet-5` y `claude-haiku-5-5` entre los modelos disponibles.
- **Transferencia decidida por el servidor** (`transfer-destination-request`). Se transfiere solo en horario y si hay número configurado; si no, el asistente ofrece dejar un recado.
- **Español:** Deepgram `nova-3` con `language: "es"` y voces neuronales es-ES de Azure.
- **Interrupciones naturales** (`stopSpeakingPlan`) y mensajes de espera configurables. Los de Vapi por defecto están en inglés y aquí se sustituyen todos por mensajes en español.

**Retell AI** ofrece algo parecido (telefonía, voces, llamada a funciones). No encontré una ventaja decisiva para este caso y **no he comparado precios actuales**.

**ElevenLabs Agents** es una alternativa interesante por la calidad de sus voces en español. Se está estudiando en una sesión aparte (guía con ElevenLabs y n8n).

La lógica de negocio es independiente del proveedor. `src/server/agent/` (herramientas, prompt, transferencia) no sabe nada de Vapi; solo `src/server/vapi/` traduce el formato de Vapi. Cambiar de proveedor de voz es escribir otro adaptador como ese, sin tocar reservas ni agenda.

## Modelo

- **Llamadas:** `claude-sonnet-5` por defecto, el más capaz de los que ofrece Vapi. `claude-haiku-5-5` es la alternativa rápida, con razonamiento desactivado para minimizar la latencia. Se elige por negocio.
- **Simulador:** usa el mismo modelo que el negocio, llamando directamente a la API de Anthropic (`@anthropic-ai/sdk`), con esfuerzo bajo y caché de prompt en la parte estable. Lo que se prueba en el simulador es lo que pasará en el teléfono.
- **Sin clave de Anthropic:** el simulador usa un guion local determinista que llama a las mismas herramientas reales. Así la demo funciona sin ninguna cuenta.

## Base de datos

- **Producción:** Postgres de Supabase con conexión directa (pooler). Las consultas de pantalla se ejecutan con el rol `authenticated` y el usuario de la sesión, así que la RLS de Postgres aplica de verdad. Las del webhook se ejecutan como servidor, filtrando siempre por el negocio del número llamado.
- **Local y tests:** **PGlite**, Postgres compilado a WASM. Ejecuta las mismas migraciones, incluida RLS y la restricción de exclusión `btree_gist`. Por eso los tests prueban la base de datos real y no una imitación.
- **Concurrencia:** restricción `EXCLUDE USING gist (staff_id WITH =, tstzrange(starts_at, ends_at) WITH &&) WHERE status = 'confirmed'`. Aunque dos llamadas reserven a la vez, Postgres rechaza la segunda, y el sistema prueba con otro profesional u ofrece alternativas.

## Fechas

Las expresiones habladas («el jueves que viene», «a última hora») las interpreta el servidor de forma determinista, en `Europe/Madrid`, en vez de dejar que el modelo calcule fechas. Convenciones:
- «el jueves» o «este jueves»: el próximo jueves. Dicho un jueves, el de la semana siguiente.
- «el jueves de la semana que viene»: el jueves de la semana siguiente.

El asistente siempre repite el día con su fecha antes de confirmar.

## Privacidad (RGPD)

- No se graban llamadas ni se guardan transcripciones por defecto. Lo que se guarda es un resumen breve de cada llamada, que se puede desactivar, y los pasos que dio el asistente, sin teléfonos ni emails.
- Del cliente se guardan nombre y teléfono, que hacen falta para la cita. El email solo si lo da y acepta recibir la confirmación.
- En el calendario externo solo va el servicio, el nombre y el código de la cita (sin teléfono).
- Los tokens de Google se guardan cifrados y la RLS impide leerlos desde el navegador.
- El asistente se identifica como IA, y el saludo se valida al guardarlo.
