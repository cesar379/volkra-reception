# 6. ElevenLabs Agents como voz (alternativa a Vapi)

El mismo backend sirve para Vapi o para ElevenLabs. Las reservas, la agenda y las reglas son las mismas; solo cambia el adaptador (`src/server/elevenlabs/handler.ts`). Cada negocio usa uno de los dos.

## Variables de entorno

| Variable | Para qué |
|---|---|
| `ELEVENLABS_TOOLS_SECRET` | Secreto que ElevenLabs envía como `Authorization: Bearer …` al inicio de la llamada y en cada herramienta. Guárdalo en el gestor de secretos de ElevenLabs |
| `ELEVENLABS_WEBHOOK_SECRET` | Secreto HMAC del webhook de fin de llamada (lo genera ElevenLabs al crear el webhook) |

## Endpoints

| Endpoint | Configuración en ElevenLabs |
|---|---|
| `POST /api/elevenlabs/init` | Webhook de inicio de llamada para llamadas entrantes (Twilio o SIP). En la pestaña *Security* del agente, activa la obtención de datos de inicio y permite sobrescribir el **prompt** y el **idioma** (el **primer mensaje** solo si pones `ELEVENLABS_OVERRIDE_FIRST_MESSAGE=1`; el plan Free no lo permite, y entonces el saludo es el del propio agente, con `{{negocio}}`). Recibe `caller_id`, `agent_id`, `called_number`, `call_sid` y `conversation_id`. Devuelve `conversation_initiation_client_data` con el prompt del negocio y las variables `negocio` y `transferencia` (`si`/`no`) |
| `POST /api/elevenlabs/tools/<herramienta>` | Una herramienta *webhook* por cada herramienta: `buscar_huecos`, `reservar_cita`, `buscar_mis_citas`, `cambiar_cita`, `cancelar_cita`, `consultar_informacion` y `dejar_recado`. Los parámetros son los de `src/server/agent/tool-definitions.ts`. Añade además `conversation_id` ← `system__conversation_id` y `agent_id` ← `system__agent_id` como variables dinámicas (no las rellena el modelo). Responde siempre 200 con un objeto JSON |
| `POST /api/elevenlabs/post-call` | Webhook *post-call* (`post_call_transcription`), firmado con `ElevenLabs-Signature`. Guarda la duración, el motivo de fin, el resumen (si el negocio lo permite) y si hubo transferencia. **No guarda la transcripción** |

## Reglas importantes

- **Un agente de ElevenLabs por negocio.** El número de transferencia de `transfer_to_number` se configura en el agente. Pon su ID en *Configuración → Asistente de voz → ID del agente en ElevenLabs*.
- **Transferencia solo en horario.** El prompt que envía `/init` ya dice si hoy se puede transferir. También puedes usar `{{transferencia}}` en la condición de la herramienta de sistema.
- **El teléfono de quien llama** lo da la telefonía en `/init`. Se guarda cifrado solo durante la llamada y se borra al recibir el fin de llamada. Aunque el modelo envíe un `caller_id`, se ignora: no puede suplantar a otra persona para ver o cancelar citas.
- **Pruebas desde el navegador de ElevenLabs** (sin llamada telefónica): no pasan por `/init`, así que las herramientas funcionan pero no hay teléfono. Reservar pedirá uno; es el comportamiento esperado.
- **Reintentos:** si ElevenLabs repite la misma herramienta con los mismos datos en la misma conversación, se devuelve el mismo resultado sin duplicar la cita.
- **Modelo:** elige un modelo de Claude en la configuración del agente de ElevenLabs. Nada de OpenAI.

## Probado

Cubierto en `tests/elevenlabs.test.ts`:
- Firma comprobada contra `webhooks.constructEvent` del SDK oficial.
- Inicio de llamada, reserva con reintento, que el modelo no pueda suplantar el teléfono, fin de llamada repetido, pruebas sin `/init` y aislamiento entre negocios.

Además, las tres rutas se han probado por HTTP contra el servidor local. **Falta probarlo con una cuenta real de ElevenLabs.**
