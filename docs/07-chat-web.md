# Chat web

El mismo agente (Claude, mismas herramientas, misma agenda) atendiendo por escrito en la web del negocio.

## Activar
1. `ANTHROPIC_API_KEY` en Vercel (el chat usa Claude directamente, no ElevenLabs ni Vapi).
2. Panel → Configuración → **Chat web** → Activar.
3. Pegar el código en la web del cliente, antes de `</body>`:
   ```html
   <script src="https://entrada.volkra.es/widget.js" data-key="wc_..." async></script>
   ```
   Opcional: `data-color="#0f766e"` para el color del botón.

También hay enlace directo: `https://entrada.volkra.es/chat/wc_...`

## Cómo funciona
- `public/widget.js` pinta el botón y abre un iframe con `/chat/<clave>`.
- `POST /api/chat/<clave>` → `src/server/webchat/session.ts` → Claude con las herramientas de `src/server/agent/`.
- Cada conversación aparece en **Llamadas** con canal «Chat web».
- Sin teléfono de llamada: para reservar se pide un teléfono; para ver, cambiar o cancelar citas hace falta código + nombre.

## Límites (público, sin login)
| Límite | Valor |
|---|---|
| Reservas + recados por conversación | 2 |
| Reservas + recados por IP y día | 4 |
| Conversaciones nuevas por IP y hora | 10 |
| Mensajes por conversación | 30 |
| Mensajes por negocio y día | 1000 |
| Inactividad que cierra la conversación | 2 h |

La IP no se guarda: solo un hash con `APP_SECRET`. Desactivar o regenerar el código desde el panel corta el chat al instante.
