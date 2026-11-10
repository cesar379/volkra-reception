# 8. WhatsApp Business

El mismo agente (Claude, las mismas 7 herramientas y la misma agenda) atendiendo por WhatsApp. Usa la **Cloud API de Meta** directamente, sin intermediarios.

A diferencia del chat web, en WhatsApp el número de la persona lo da WhatsApp y es fiable, como el de una llamada. Por eso:
- no hace falta pedir un teléfono para reservar;
- la persona puede ver, cambiar o cancelar sus citas sin código si escribe desde el número con el que reservó.

## Qué necesitas

| Dónde | Qué | Para qué |
|---|---|---|
| Meta | App de tipo **Empresa** con el producto **WhatsApp** y una cuenta de Meta Business | Una sola para toda la plataforma |
| Meta | Un número por negocio, verificado en la cuenta de WhatsApp Business | Cada número atiende a un negocio, y solo a uno |
| Meta | Token permanente de un **usuario del sistema** | Enviar las respuestas |
| Vercel | `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `ANTHROPIC_API_KEY`, `CRON_SECRET` | Firma del webhook, alta del webhook, Claude y borrado diario |
| Vercel (opcional) | `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_GRAPH_VERSION` | Token común de la plataforma; versión de la Graph API (`v23.0` por defecto) |
| Volkra | Configuración → WhatsApp: *Phone number ID* (y el token, si es propio del negocio) | Asociar el número al negocio |

`WHATSAPP_GRAPH_URL` es solo para pruebas en local (ver abajo). En producción se deja vacía.

## 1. Crear la app en Meta (una vez, para toda la plataforma)

1. https://developers.facebook.com → **Mis apps → Crear app** → tipo **Empresa** → añade el producto **WhatsApp**.
2. Asocia una cuenta de **Meta Business** (Business Manager) verificada.
3. **Configuración de la app → Básica**: copia el **Secreto de la app** a `WHATSAPP_APP_SECRET`.
4. Inventa un texto largo y aleatorio para `WHATSAPP_VERIFY_TOKEN` (por ejemplo `openssl rand -hex 24`).
5. Pon las dos variables en Vercel (más `ANTHROPIC_API_KEY`, que es quien responde, y `CRON_SECRET`) y vuelve a desplegar.
6. **WhatsApp → Configuración → Webhook → Editar**:
   - URL de devolución de llamada: `<APP_URL>/api/whatsapp/webhook` (por ejemplo `https://entrada.volkra.es/api/whatsapp/webhook`).
   - Token de verificación: el mismo de `WHATSAPP_VERIFY_TOKEN`.
   - Pulsa **Verificar y guardar** y, en **Campos del webhook**, suscríbete a **messages**.
7. Publica la app (**Publicar → Publicar**). Sin publicar, Meta solo envía los webhooks de prueba del panel, **ni siquiera los mensajes al número de prueba**. Antes, en **Configuración de la app → Información básica**, pon:
   - URL de la política de privacidad: `https://entrada.volkra.es/privacidad`
   - URL de las condiciones: `https://entrada.volkra.es/condiciones`
   - URL de eliminación de datos: `https://entrada.volkra.es/privacidad#10-tus-derechos`

Comprueba `<APP_URL>/api/health`: debe mostrar `"whatsapp": true` y `"claude": true`.

## 2. Token de acceso permanente

El token temporal del panel de pruebas caduca en 24 horas. Para producción:

1. **Meta Business Suite → Configuración del negocio → Usuarios del sistema** → crea un usuario del sistema (rol administrador).
2. **Asignar activos**: la app y la cuenta de WhatsApp Business, con control total.
3. **Generar token**: elige la app, caducidad **Nunca** y los permisos `whatsapp_business_messaging` y `whatsapp_business_management`.

Ese token se puede poner:
- **en cada negocio** (Configuración → WhatsApp → Token de acceso): se guarda cifrado con `ENCRYPTION_KEY` y el navegador no puede leerlo; o
- **en `WHATSAPP_ACCESS_TOKEN`**, si todos los números cuelgan de la cuenta de Volkra. Se usa cuando el negocio no tiene token propio.

## 3. Conectar el número de un negocio

1. En Meta, **WhatsApp → Configuración de la API**: añade y verifica el número del negocio. Un número que ya usa la app de WhatsApp en un móvil hay que darlo de baja antes, o usar uno nuevo. Meta revisa el nombre visible.
2. Copia el **Identificador del número de teléfono** (*Phone number ID*). Son solo cifras y no es el número de teléfono.
3. **Suscribe la app a la cuenta de WhatsApp Business (WABA) del número.** Hazlo siempre, también con el número de prueba: Meta lo deja suscrito a su app interna «WA DevX Webhook Events» y los mensajes no llegan a Volkra. Sin error visible.
   En el **Explorador de la API Graph** (developers.facebook.com/tools/explorer), con la app «Volkra» y los permisos `whatsapp_business_management` y `whatsapp_business_messaging`:
   - `GET <WABA_ID>/subscribed_apps` muestra las apps suscritas.
   - `POST <WABA_ID>/subscribed_apps` suscribe la app. Debe responder `{"success": true}`.
4. En Volkra: **Configuración → WhatsApp** → pega el identificador (y el token si es propio del negocio) → **Comprobar y activar**.
   Volkra comprueba con Meta que ese token da acceso a ese número antes de guardarlo. Un mismo número no puede estar en dos negocios.
5. Escribe al número desde otro móvil. La conversación aparece en **Llamadas** con el canal «WhatsApp».

> **Modo de pruebas de Meta:** con el número de prueba que da Meta solo puedes escribir desde los teléfonos que añadas como destinatarios (hasta 5). Con un número propio verificado y la app publicada, cualquiera puede escribir.

## Probar en local, sin Meta

`npm run whatsapp:local` simula la Graph API y te deja escribir como si fueras un cliente. El agente es el real: Claude, las herramientas y la agenda local.

1. En `.env.local`: `ANTHROPIC_API_KEY`, `WHATSAPP_APP_SECRET` y `WHATSAPP_VERIFY_TOKEN` (cualquier texto) y `WHATSAPP_GRAPH_URL=http://127.0.0.1:4599`.
2. `npm run dev` y, en otra terminal, `npm run whatsapp:local`.
3. Panel → **Configuración → WhatsApp**: identificador `100000000000001`, token `local` → **Comprobar y activar**.
4. Escribe en la terminal; las respuestas salen ahí mismo.

El script solo funciona contra `localhost`. Si tu terminal ya define `ANTHROPIC_BASE_URL`, Next no la sobrescribe con `.env.local`.

## Cómo funciona

- `GET /api/whatsapp/webhook` responde al `hub.challenge` solo si `hub.verify_token` coincide con `WHATSAPP_VERIFY_TOKEN`.
- `POST /api/whatsapp/webhook` comprueba la firma `X-Hub-Signature-256` (HMAC-SHA256 de los bytes crudos con `WHATSAPP_APP_SECRET`), responde 200 enseguida (si no, Meta reintenta) y el agente contesta después con `after()`.
- El negocio se identifica por el *Phone number ID* del webhook (`whatsapp_phone_number_id`, único).
- Cada mensaje se procesa una sola vez: Meta repite webhooks y el id del mensaje se guarda en `whatsapp_inbound`. Los mensajes de hace más de 24 h (reintentos tardíos) no se contestan: ya están fuera de la ventana de WhatsApp.
- El turno pasa por el mismo `chatTurn` → `executeTool` que el chat web, con las 7 herramientas de agenda (sin transferir ni colgar). El modelo es el del negocio (`voice_model`), con la API de Anthropic.
- La conversación es la última abierta de ese número. Tras 2 horas sin mensajes o 30 turnos empieza otra.
- Si la persona manda varios mensajes seguidos, se contestan en orden: cada uno espera a que termine el anterior.
- Audios, fotos y ubicaciones no se interpretan: el asistente pide que lo escriba.
- Si el agente falla, la persona recibe un aviso y el fallo aparece en **Para revisar**.
- Solo se responde dentro de la ventana de 24 horas de WhatsApp (siempre se contesta a un mensaje recibido), así que no hacen falta plantillas aprobadas.
- Límites: los mismos que el chat web (`CHAT_LIMITS`), contados por número en vez de por IP.

## Datos personales (RGPD)

- El texto de la conversación solo se guarda mientras está abierta, porque es el contexto que necesita el agente. Al terminar (2 h sin mensajes o 30 turnos) se borra. Pasa al abrir otra conversación de ese negocio y, como tarde, en la tarea diaria `/api/cron/daily`.
- Queda el registro en **Llamadas**: últimas 4 cifras, resultado, las herramientas usadas y un resumen breve si el negocio lo tiene activado. Las citas y los recados se guardan como los del teléfono.
- El número no se guarda en claro en las conversaciones, solo un hash con `APP_SECRET` para los límites.
- Los ids de mensajes de Meta se borran a los 8 días: solo sirven para no contestar dos veces a un reintento.
- Meta guarda sus propias copias de los mensajes como encargado de tratamiento. Menciónalo en la política de privacidad del negocio.

## Coste

Meta no cobra las conversaciones de atención al cliente iniciadas por la persona (ventana de 24 h). Lo que se paga es Claude por cada mensaje, igual que en el chat web.

## Pendiente

- Recordatorios de cita por WhatsApp. Escribir primero a la persona requiere plantillas aprobadas por Meta y tiene coste.
- Notas de voz: transcribirlas antes de pasarlas al agente.
- Alta de números de clientes con *Embedded Signup* de Meta (ahora el identificador y el token se pegan a mano).
