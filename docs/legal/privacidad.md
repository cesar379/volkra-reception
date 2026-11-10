# Política de privacidad de Volkra Hub

*Última actualización: 1 de noviembre de 2026*

Volkra Hub es la plataforma de herramientas con inteligencia artificial de Volkra para negocios. Su primer producto, **Reception**, es un recepcionista con IA: atiende llamadas, el chat de la web y WhatsApp, informa y gestiona citas en la agenda del negocio. Esta política explica qué datos personales tratamos, para qué y con qué derechos.

## 1. Quién es el responsable

{{TITULAR}} («Volkra»), NIF {{NIF}}, {{DOMICILIO}}. Contacto: hola@volkra.es.

## 2. Dos papeles distintos

- **Clientes de Volkra** (los negocios y las personas que usan el panel): Volkra es **responsable** de sus datos de cuenta y de facturación.
- **Personas que contactan con un negocio** (por teléfono, chat web o WhatsApp): el **responsable es el negocio** al que llaman o escriben. Volkra trata esos datos por cuenta del negocio, como **encargado del tratamiento** (art. 28 RGPD), con un contrato de encargo y solo según sus instrucciones. Para ejercer sus derechos, esas personas pueden dirigirse al negocio o a hola@volkra.es, y les ayudaremos.

## 3. Qué datos tratamos

**Clientes del servicio**
- Nombre, email y contraseña (guardada cifrada por el proveedor de autenticación).
- Datos del negocio: nombre, dirección, horario, servicios, equipo, preguntas frecuentes y email para avisos.
- Datos de facturación: nombre o razón social, NIF y dirección.

**Personas que contactan con el negocio**
- Número de teléfono o de WhatsApp. En el historial de llamadas solo se muestran las 4 últimas cifras; el número completo se guarda en la ficha de la cita.
- Nombre y, solo si la persona lo pide, email, para enviarle la confirmación.
- Datos de la cita: servicio, fecha, hora, profesional y código de la cita.
- Recados: nombre, teléfono o email y el motivo resumido.
- Contenido de la conversación:
  - **Teléfono:** la conversación se procesa en tiempo real para responder. Volkra guarda las herramientas usadas (por ejemplo «buscar huecos» o «reservar»), el resultado y, si el negocio lo activa, un resumen breve. La grabación de audio está desactivada salvo que el negocio la active.
  - **Chat web y WhatsApp:** el texto se guarda solo mientras la conversación está abierta, porque es el contexto que necesita el asistente. Se borra al terminar (2 horas sin mensajes o 30 turnos) y, como tarde, en el borrado automático diario.
- **Datos técnicos:** para limitar abusos del chat web usamos un identificador cifrado de la IP o del número (un *hash*). La IP no se guarda en claro.

**No pedimos datos de salud.** El asistente está instruido para no preguntar por síntomas ni diagnósticos, y para resumir el motivo de una cita o un recado sin datos de salud. Si la persona los da por iniciativa propia, el negocio decide qué conservar.

## 4. Para qué y con qué base legal

| Finalidad | Base legal |
|---|---|
| Prestar el servicio al negocio (cuenta, panel, soporte) | Ejecución del contrato (art. 6.1.b RGPD) |
| Atender llamadas y mensajes y gestionar citas por cuenta del negocio | La del negocio, normalmente la ejecución de un contrato o de medidas precontractuales con la persona; Volkra actúa como encargado |
| Enviar la confirmación de la cita por email | Consentimiento de la persona (art. 6.1.a) |
| Seguridad, prevención de abusos y registros técnicos | Interés legítimo (art. 6.1.f) |
| Facturación y obligaciones fiscales | Obligación legal (art. 6.1.c) |

No usamos los datos para publicidad, no los vendemos y no los usamos para entrenar modelos de inteligencia artificial.

## 5. Inteligencia artificial

Las respuestas las genera un modelo de inteligencia artificial (Claude, de Anthropic). Al empezar, el asistente se presenta como asistente virtual del negocio. Las decisiones sobre las citas (disponibilidad, reservas, cambios y cancelaciones) siguen las reglas que configura el negocio, y la persona siempre puede pedir hablar con alguien del equipo o dejar un recado. Ninguna decisión con efectos jurídicos se basa únicamente en el tratamiento automatizado.

## 6. Proveedores (subencargados)

Solo compartimos los datos necesarios con estos proveedores, que actúan por cuenta de Volkra:

| Proveedor | Para qué | Dónde |
|---|---|---|
| Supabase | Base de datos y autenticación | Unión Europea (Irlanda) |
| Vercel | Alojamiento de la aplicación | Unión Europea (Irlanda); empresa de EE. UU. |
| Anthropic | Modelo de IA que genera las respuestas | EE. UU. |
| ElevenLabs o Vapi (según el negocio) | Voz de las llamadas: reconocimiento y síntesis | EE. UU. / UE |
| Meta (WhatsApp Business) | Mensajes de WhatsApp, si el negocio lo activa | UE / EE. UU. |
| Google | Copia de las citas en Google Calendar, si el negocio lo conecta | UE / EE. UU. |
| Resend | Envío de emails (avisos y confirmaciones) | EE. UU. |
| Operador de telefonía | Número de teléfono y llamadas | UE / EE. UU. |

Las transferencias a EE. UU. se amparan en el Marco de Privacidad de Datos UE-EE. UU. o en cláusulas contractuales tipo de la Comisión Europea.

## 7. Google Calendar

Si un negocio conecta su Google Calendar, Volkra pide el permiso `calendar.events` para:
- crear, mover y borrar en ese calendario las citas que gestiona el asistente;
- leer las horas ocupadas, para no reservar encima de otros compromisos.

Volkra no lee el contenido de otros eventos más allá de su horario, no accede a otros datos de la cuenta de Google y guarda el token de acceso cifrado. El negocio puede desconectarlo en cualquier momento desde Volkra o desde https://myaccount.google.com/permissions.

**El uso que Volkra hace de la información recibida de las API de Google, y su transferencia a cualquier otra aplicación, se ajusta a la [Política de datos de usuario de los servicios de API de Google](https://developers.google.com/terms/api-services-user-data-policy), incluidos los requisitos de Uso Limitado.** Esos datos no se usan para publicidad ni para entrenar modelos de IA, no se transfieren a terceros salvo para prestar esta función, y ninguna persona los lee salvo con permiso del negocio, por seguridad o por obligación legal.

## 8. Cuánto tiempo los conservamos

- **Texto del chat web y de WhatsApp:** hasta que termina la conversación.
- **Identificadores de mensajes de WhatsApp:** 8 días, para no contestar dos veces al mismo mensaje.
- **Citas, recados e historial de llamadas:** mientras el negocio mantenga el servicio. A su baja, se devuelven o se borran en un plazo de 30 días, salvo obligación legal.
- **Datos de cuenta y facturación:** mientras dure el contrato y, después, los plazos legales (por ejemplo, 6 años los datos contables).

## 9. Seguridad

- Cifrado en tránsito (HTTPS).
- Aislamiento de los datos de cada negocio en la base de datos.
- Tokens de terceros (Google, WhatsApp) cifrados con AES-256-GCM.
- Acceso del personal limitado a lo necesario.
- Borrado automático de las conversaciones.

## 10. Tus derechos

Puedes ejercer los derechos de acceso, rectificación, supresión, oposición, limitación del tratamiento y portabilidad escribiendo a hola@volkra.es, indicando qué pides y, si hace falta, un dato que nos permita identificarte (por ejemplo, el número desde el que llamaste). Si los datos se trataron por cuenta de un negocio, se lo trasladaremos.

Si crees que no hemos atendido bien tu solicitud, puedes reclamar ante la Agencia Española de Protección de Datos: https://www.aepd.es.

## 11. Cookies

La aplicación (https://app.volkra.es) solo usa cookies técnicas, necesarias para iniciar sesión y mantenerla. No usa cookies de análisis ni de publicidad. Las cookies de https://volkra.es se describen en su propia política de cookies.

## 12. Cambios

Si cambiamos esta política de forma relevante, lo avisaremos a los clientes por email y en el panel con antelación razonable.
