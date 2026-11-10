# 3. Número de teléfono y primera llamada real

El teléfono, la transcripción y la voz los gestiona **Vapi**. El razonamiento lo hace **Claude**, a través del proveedor `anthropic` de Vapi. Las herramientas (agenda, reservas…) las ejecuta este servidor.

## 3.1 Cuenta de Vapi

1. Crea una cuenta en https://vapi.ai. Para llamadas reales necesitarás añadir saldo (tú decides cuándo; consulta los precios actuales en su web).
2. En el panel, **API Keys**: copia la clave *Private*. Va a `VAPI_API_KEY`, que solo usa el script de conexión.
3. Modelo: el asistente usa Claude (`claude-sonnet-5` por defecto, o `claude-haiku-5-5`, se elige en Configuración → Asistente de voz). Vapi factura el uso del modelo; si prefieres usar tu propia clave de Anthropic, Vapi permite añadirla en su panel (*Provider Keys*). Comprueba ese apartado en tu cuenta.

## 3.2 Número español

Los números que Vapi regala son de EE. UU. Para un número **español** (+34) lo habitual es comprarlo en Twilio e importarlo en Vapi:

1. Crea una cuenta en https://www.twilio.com. Para números de España, Twilio exige aprobar un ***Regulatory Bundle***: datos de la empresa y una dirección en España, con documentación. Puede tardar varios días: empieza por aquí.
2. Compra un número español con capacidad de voz (geográfico 9xx o móvil). Consulta en Twilio los requisitos y el precio de cada tipo.
3. En Vapi: **Phone Numbers → Import → Twilio**, con el número, el *Account SID* y el *Auth Token* de Twilio.
4. Copia el **ID** del número en Vapi.

> Alternativa: Vapi también acepta números por SIP de otros operadores. Útil si el negocio quiere **mantener su número actual**, desviando las llamadas (por ejemplo, cuando no contestan o fuera de horario) al número del asistente. El desvío se configura en el operador del negocio.

## 3.3 Conectar el número con el servidor y con el negocio

Con la app ya desplegada ([guía 2](02-vercel.md)):

```bash
VAPI_API_KEY=... VAPI_WEBHOOK_SECRET=... APP_URL=https://app.volkra.es DATABASE_URL=... \
  npm run vapi:connect -- <ID-del-número-en-Vapi> <ID-del-negocio>
```

El ID del negocio lo ves en la base de datos (tabla `businesses`).

El script hace dos cosas:
- Configura el número en Vapi **sin asistente fijo**, con la URL del servidor y el secreto. En cada llamada Vapi pide el asistente a `/api/vapi/webhook`, que lo genera con la configuración actual del negocio.
- Asigna el número al negocio.

Sin script, a mano: en Vapi, en el número, deja *Assistant* vacío y en *Server URL* pon `https://app.volkra.es/api/vapi/webhook` con la cabecera `Authorization: Bearer <VAPI_WEBHOOK_SECRET>`. Después, en la app, ve a **Configuración → Asistente de voz** y rellena «ID del número en Vapi» y «Número del asistente».

## 3.4 Primera llamada

1. En **Configuración**, revisa horario, servicios, equipo, preguntas frecuentes y el número de transferencia.
2. Prueba antes en **Probar el asistente**. Con `ANTHROPIC_API_KEY`, usa Claude con el mismo prompt y las mismas herramientas.
3. Llama al número desde tu móvil. Prueba:
   - «Quería una limpieza mañana por la tarde» → te ofrece 2 o 3 horas reales → elige una → di tu nombre → confirma con un código.
   - «Quiero cambiar mi cita al jueves» / «Quería cancelar mi cita».
   - «¿Tenéis aparcamiento?» y una pregunta que no esté configurada (debe decir que no lo sabe).
   - «Quiero hablar con una persona»: en horario transfiere; fuera de horario ofrece dejar un recado.
4. En el panel: la cita está en **Agenda**, la llamada en **Llamadas** con su resumen, y los recados en **Para revisar**.

## Si algo falla

| Síntoma | Causa probable |
|---|---|
| Vapi dice «no está configurado» | El ID del número no está asignado a ningún negocio |
| El asistente no puede usar herramientas | `VAPI_WEBHOOK_SECRET` distinto en Vapi y en Vercel (el webhook responde 401) |
| Silencio al empezar | `APP_URL` mal configurada o servidor lejos (límite de 7,5 s de Vapi) |
| Habla en inglés al «pensar» | No debería: cada herramienta tiene su mensaje de espera en español. Revisa que el número no tenga un asistente fijo de Vapi |

## Transparencia y RGPD (resumen)

- El saludo debe decir que es un asistente virtual con IA. La app no deja guardar un saludo sin esa mención.
- Las llamadas no se graban por defecto. Si el negocio activa la grabación, hay que avisarlo en el saludo y revisar la base legal.
- Firma un contrato de encargado de tratamiento con cada cliente. Vapi, Twilio, Supabase, Anthropic y Google son subencargados: revisa sus DPA y en qué región procesan.
