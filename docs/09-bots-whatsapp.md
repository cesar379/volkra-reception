# 9. Tres bots en WhatsApp (diseño, pendiente de construir)

Idea: que el negocio no tenga que usar la web. Se da de alta, configura su negocio y lleva su agenda escribiendo por WhatsApp, que ya usa todo el día. El panel web queda como respaldo y para soporte.

## Los tres bots

| Bot | Número al que se escribe | Quién escribe | Qué hace |
|---|---|---|---|
| **1. Volkra (interno nuestro)** | El número de Volkra, independiente | Administradores de Volkra y dueños de negocios | Alta de negocios nuevos, configuración antes de que el negocio tenga su número, soporte, estado de todos los negocios (solo administradores) |
| **2. Gestión del negocio** | El número del negocio | Su personal, dado de alta por teléfono | Horario, servicios, equipo, festivos, ausencias, bloqueos, agenda completa |
| **3. Atención al cliente** | El número del negocio | Cualquier otro número | Reservar, cambiar, cancelar, preguntar. **Ya existe** ([guía 8](08-whatsapp.md)) |

En el número del negocio, el bot se elige por **quién escribe**: WhatsApp da el número del remitente y no se puede falsificar. Si es del personal, contesta el bot de gestión. Si no, el de clientes.

Permisos en el bot de Volkra: un administrador puede tocar cualquier negocio. Un dueño solo el suyo; si tiene varios, el bot pregunta cuál.

## Estructura en Meta

```
Meta Business de Volkra
├── WhatsApp Business «Volkra»       → número de Volkra (bot 1)
├── WhatsApp Business «Peluquería X» → número de Peluquería X (bots 2 y 3)
├── WhatsApp Business «Clínica Y»    → número de Clínica Y (bots 2 y 3)
└── …
```

- Una cuenta de WhatsApp Business por cliente: si un negocio recibe denuncias o bloqueos, no afecta a los demás, y si se va, su cuenta se traspasa o se da de baja sin tocar el resto.
- Todos los números en la misma app de Meta y el mismo webhook. El número de Volkra se identifica por su *Phone number ID* (configuración en Vercel).
- Meta limita cuántas cuentas y números se pueden tener mientras la Meta Business no está verificada: conviene verificarla pronto.
- Más adelante, un cliente puede tener la cuenta en su propia Meta Business (`subscribed_apps` o *Embedded Signup*).

## Mismo motor, distintas instrucciones y herramientas

Los tres bots comparten el webhook, la firma, el orden de mensajes, el bucle de Claude con herramientas, los límites y el borrado RGPD. Cada bot tiene sus propias instrucciones para Claude y sus herramientas. Los bots 1 y 2 comparten casi todas las herramientas de configuración.

Ejemplos de lo que el negocio podrá hacer:
- «Abrimos de 9 a 14 y de 17 a 20, los sábados solo mañana» → horario.
- «Corte 15 €, 30 min. Tinte desde 40 €, hora y media» → servicios.
- «Ha entrado Laura, hace cortes y peinados, no trabaja los lunes» → equipo.
- «El 8 de diciembre cerramos» → festivo.
- «Si preguntan por aparcamiento, hay uno gratis enfrente» → preguntas frecuentes.
- Una foto de la lista de precios → servicios con sus precios.

## Fiabilidad

Si el bot entiende mal un horario o un precio, se lo dirá mal a los clientes. Por eso:
1. **Resumen y confirmación** antes de guardar cualquier cambio.
2. **Historial de cambios** (quién, qué, cuándo) y «deshaz lo último».
3. **Avisos de conflicto**: por ejemplo, citas que quedan fuera del horario nuevo.
4. **Permisos por rol**: un profesional solo toca su agenda.

## Lo que no se puede hacer por WhatsApp

- Conectar el número del negocio en Meta (paso de Meta; *Embedded Signup* lo simplifica).
- Autorizar Google Calendar: Google obliga a hacerlo en su web. Se manda el enlace por WhatsApp.

## Fases

1. Personal por número de teléfono y bot de gestión con herramientas de agenda: bloquear huecos, ausencias, ver la agenda, mover y cancelar.
2. Herramientas de configuración (horario, servicios, equipo, festivos, preguntas frecuentes) con confirmación e historial. Número y bot de Volkra con alta de negocios.
3. Fotos (lista de precios) y notas de voz transcritas.

## Por decidir

- Quién del negocio usa el bot de gestión: solo el dueño o también los profesionales.
- Si se activa para todos los negocios o negocio a negocio.
- Teléfonos de los administradores de Volkra (variable en Vercel).
