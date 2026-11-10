# Contrato de encargo de tratamiento (art. 28 RGPD)

Anexo a las [Condiciones del servicio](/condiciones) de Volkra Hub. *Última actualización: 1 de noviembre de 2026.*

**Responsable del tratamiento:** el Cliente (el negocio que contrata Volkra Hub).
**Encargado del tratamiento:** {{TITULAR}}, NIF {{NIF}}, {{DOMICILIO}} («Volkra»).

## 1. Objeto

Volkra tratará datos personales por cuenta del Cliente únicamente para prestar los servicios de Volkra Hub contratados. En Reception: atender llamadas, chat web y WhatsApp, informar, gestionar citas, tomar recados y enviar avisos.

## 2. Datos e interesados

- **Interesados:** personas que contactan con el Cliente (sus clientes o pacientes, actuales o potenciales) y el personal del Cliente que figure en la agenda.
- **Datos:**
  - identificativos y de contacto: nombre, teléfono y email;
  - datos de la cita: servicio, fecha, hora, profesional y código;
  - recados y motivo resumido;
  - historial de interacciones: fecha, duración, resultado, herramientas usadas, resumen opcional y grabación opcional;
  - texto de las conversaciones escritas mientras están abiertas.
- **Categorías especiales:** no se pretende tratarlas. Si un interesado aporta datos de salud por iniciativa propia, se tratan con las mismas medidas y el Cliente decide sobre ellos.

## 3. Duración

Mientras esté vigente el servicio. Al terminar, Volkra devolverá los datos al Cliente si lo pide en los 30 días siguientes y después los suprimirá, salvo obligación legal de conservarlos, en cuyo caso los bloqueará.

## 4. Obligaciones de Volkra

1. Tratar los datos solo según las instrucciones documentadas del Cliente, que son estas condiciones y la configuración que haga en el panel. Si una instrucción le parece contraria a la normativa, lo avisará.
2. Garantizar la confidencialidad de las personas autorizadas a tratar los datos.
3. Aplicar las medidas de seguridad del apartado 6.
4. Recurrir a subencargados solo según el apartado 5.
5. Ayudar al Cliente a atender los derechos de los interesados. Si un interesado se dirige a Volkra, se lo trasladará sin demora.
6. Ayudar al Cliente con la seguridad, las evaluaciones de impacto y las consultas a la autoridad, en la medida de lo razonable.
7. Notificar al Cliente, sin dilación indebida y a ser posible en 48 horas, cualquier violación de seguridad que afecte a sus datos, con la información disponible.
8. Poner a disposición del Cliente la información necesaria para demostrar el cumplimiento y permitir auditorías razonables, con preaviso y a costa del Cliente.
9. No usar los datos para fines propios, para publicidad ni para entrenar modelos de inteligencia artificial.

## 5. Subencargados

El Cliente autoriza de forma general a Volkra a recurrir a los subencargados de la lista, para las funciones indicadas:

| Subencargado | Función | Ubicación / garantías |
|---|---|---|
| Supabase Inc. | Base de datos y autenticación | Servidores en la UE (Irlanda) |
| Vercel Inc. | Alojamiento de la aplicación | Servidores en la UE (Irlanda); DPF / CCT |
| Anthropic PBC | Modelo de IA (Claude) | EE. UU.; DPF / CCT |
| ElevenLabs / Vapi | Voz (reconocimiento y síntesis) | EE. UU. / UE; DPF / CCT |
| Operador de telefonía | Número y llamadas | UE / EE. UU.; DPF / CCT |
| Meta Platforms Ireland | WhatsApp Business (si se activa) | UE / EE. UU.; CCT |
| Google | Google Calendar (si se conecta) | UE / EE. UU.; DPF / CCT |
| Resend | Envío de emails | EE. UU.; DPF / CCT |

Volkra avisará al Cliente de cualquier cambio en la lista con al menos 15 días de antelación. El Cliente podrá oponerse por motivos razonables y, si no hay alternativa, darse de baja. Volkra impondrá a cada subencargado obligaciones equivalentes a las de este contrato.

(DPF: Marco de Privacidad de Datos UE-EE. UU. CCT: cláusulas contractuales tipo de la Comisión Europea.)

## 6. Medidas de seguridad

- Cifrado en tránsito (TLS) en todas las comunicaciones.
- Separación de los datos de cada Cliente en la base de datos (seguridad a nivel de fila).
- Tokens de servicios de terceros cifrados (AES-256-GCM).
- Comprobación de la firma de las peticiones que llegan de los proveedores de voz y WhatsApp.
- Minimización:
  - solo las 4 últimas cifras del teléfono en el historial;
  - IP y número en el chat solo como *hash*;
  - el texto de los chats se borra al terminar la conversación;
  - sin grabación salvo que el Cliente la active.
- Acceso del personal de Volkra limitado a soporte y mantenimiento.
- Copias de seguridad del proveedor de base de datos.

## 7. Obligaciones del Cliente

- Informar a los interesados y contar con base legal para el tratamiento.
- Dar instrucciones lícitas.
- Configurar el servicio de forma adecuada a su actividad (por ejemplo, no pedir datos de salud innecesarios y no activar grabaciones sin informar).

## 8. Aceptación

Este contrato se acepta junto con las Condiciones del servicio al contratar Volkra Hub.
