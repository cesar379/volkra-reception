# Estado del proyecto (honesto)

Fecha: 1 de noviembre de 2026. **Volkra Hub** (plataforma) con su primer producto, **Reception**. Producción: https://app.volkra.es (antes entrada.volkra.es, que sigue funcionando y redirige) en Vercel, región Dublín, y Supabase en Irlanda.

Leyenda:
- 🟢 Funciona en producción, probado con el servicio real.
- ✅ Probado con tests automáticos (y en local).
- 🟡 Hecho, sin probar todavía contra el servicio real.
- ⏳ Pendiente.

## Núcleo de reservas

| Función | Estado | Cómo se comprobó |
|---|---|---|
| Disponibilidad real: horario, jornada partida, festivos, días especiales, horario por profesional, ausencias, margen, antelación | ✅ | Tests contra Postgres (PGlite) |
| Reservar, cambiar, cancelar | 🟢 | Tests y reservas reales por chat, WhatsApp y voz en producción |
| Sin solapes con llamadas simultáneas (restricción en BD) | ✅ | Tests con reservas en paralelo; la misma restricción protege en Postgres |
| Idempotencia (webhook repetido) | ✅ | Tests |
| Verificación de identidad para cambiar o cancelar | ✅ | Tests |

## Canales

| Canal | Estado | Detalle |
|---|---|---|
| Voz con ElevenLabs Agents | 🟢 / ⏳ | Llamadas reales desde «Probar el asistente». **Falta un número de teléfono español** conectado al agente |
| Voz con Vapi | 🟡 | Webhook y herramientas probados con tests; sin cuenta ni número |
| Chat web (widget + página pública) | 🟢 | Probado en producción el 23/10. Ver `docs/07-chat-web.md` |
| WhatsApp Business (Cloud API de Meta) | 🟢 | Funciona con el número de prueba de Meta y token permanente (usuario del sistema). Ver `docs/08-whatsapp.md` |
| Simulador con Claude | 🟢 | Clave de Anthropic en producción |

## Panel y cuentas

| Función | Estado |
|---|---|
| Acceso con Supabase Auth (email y contraseña) | 🟢 |
| Emails de alta y contraseña de Supabase por SMTP de Resend (remitente «Volkra») | 🟢 probado el 10/11 con el de recuperar contraseña |
| «¿Has olvidado tu contraseña?» en `/login` (enlace → `/nueva-contrasena`) | 🟢 probado; plantilla de Supabase en español con `token_hash` |
| Panel, agenda, historial de llamadas, incidencias, configuración | 🟢 |
| Multiempresa con aislamiento por RLS | ✅ tests |
| **Usuarios del negocio:** invitar por email (administrador o equipo), anular, quitar acceso; nunca sin administrador | ✅ tests y local (Configuración → Usuarios y cuenta) |
| **Exportar todos los datos** del negocio en JSON | ✅ tests y local |
| **Dar de baja el negocio** (borra todos sus datos, con confirmación) | ✅ tests |

## Avisos e integraciones

| Integración | Estado |
|---|---|
| Email (Resend, dominio volkra.es verificado, `citas@volkra.es`) | 🟢 activo |
| Avisos de cita a las dos partes con invitación de calendario (.ics); recados y llamadas fallidas al negocio | ✅ tests; 🟡 primer envío real sin confirmar |
| **Recordatorio por email el día antes** (tarea diaria `/api/cron/daily`, 16:00 UTC; opción en Configuración → Negocio) | ✅ tests |
| Google Calendar | 🟢 conexión hecha en producción el 27/10/2026. La app de Google sigue «en pruebas»: solo conectan los usuarios de prueba hasta verificarla (verificación del dominio en marcha) |
| Textos legales: privacidad, condiciones, encargo de tratamiento | 🟢 publicados en `/privacidad`, `/condiciones` y `/encargo-tratamiento` |
| RGPD: borrado diario del texto de chats y WhatsApp terminados | ✅ tests |
| **Alertas para Volkra** (`ALERT_EMAIL`): errores no controlados en producción, saldo o clave de Anthropic, resumen diario de fallos; como mucho una por tipo y hora | ✅ tests |
| **Puesta en marcha** en el panel: lista de lo que falta para que un negocio nuevo funcione, calculada de su configuración. Procedimiento interno en [guía 11](11-alta-de-clinica.md) | ✅ tests |

## Pendiente

- ⏳ **Número de teléfono español** para el asistente de voz (ElevenLabs o Vapi + Twilio, con el *Regulatory Bundle* aprobado). Ver `docs/03-telefono-y-primera-llamada.md`.
- 🟡 **Cobro a clientes con Stripe**: suscripción, portal de facturas y webhook hechos y con tests; falta la cuenta de Stripe y las claves. Ver `docs/10-cobros-stripe.md`.
- ⏳ Recordatorios por WhatsApp o SMS: requieren plantillas aprobadas por Meta o un proveedor de SMS.
- ⏳ Verificación de la app de Google y verificación de la empresa en Meta.
- ⏳ Números de WhatsApp de cada cliente en su propia cuenta (*Embedded Signup*, Tech Provider de Meta).
- ⏳ Notas de voz de WhatsApp (ahora se pide que lo escriban).
- ⏳ Bots de gestión por WhatsApp (del negocio y de Volkra) para que el negocio no tenga que usar la web: diseño en [guía 9](09-bots-whatsapp.md).
- ⏳ Planes de pago de Vercel y Supabase antes del primer cliente de pago: el plan gratuito no permite uso comercial y pausa el proyecto si no se usa.
- ⏳ Tests de extremo a extremo del navegador (Playwright).
