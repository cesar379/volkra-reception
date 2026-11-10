# 4. Google Calendar

La agenda de Volkra es la fuente de verdad. Google Calendar sirve para dos cosas:
- **Copia:** cada cita se crea, mueve o borra también en el calendario del negocio o del profesional.
- **Bloqueos:** si un profesional tiene su propio calendario, sus eventos personales bloquean huecos.

Si Google falla, la cita se guarda igual, se marca para reintentar y aparece en **Para revisar**.

## Crear las credenciales (una vez, para toda la plataforma)

Google ha renombrado la antigua «Pantalla de consentimiento OAuth»: ahora es **Google Auth Platform** («Plataforma de autenticación de Google»), con un menú lateral (Información general, Imagen de marca, Público, Clientes, Acceso a los datos…).

1. Entra en https://console.cloud.google.com y crea un proyecto, por ejemplo «Volkra». Comprueba arriba que está seleccionado.
2. **APIs y servicios → Biblioteca**: busca **Google Calendar API** y pulsa **Habilitar**. Sin esto, los permisos de calendario no aparecen en el paso 4.
3. **APIs y servicios → Pantalla de consentimiento de OAuth** (te lleva a Google Auth Platform). Si aparece **Comenzar**, rellena:
   - Nombre «Volkra» y tu email de asistencia.
   - Público: **Externo**.
   - Email de contacto, acepta las condiciones y **Crear**.
4. **Acceso a los datos → Agregar o quitar permisos**. En el panel de la derecha marca `.../auth/calendar.events`, `openid` y `.../auth/userinfo.email`. Si no salen en la lista, abajo del panel, en **Agregar permisos manualmente**, pega:
   ```
   https://www.googleapis.com/auth/calendar.events
   openid
   https://www.googleapis.com/auth/userinfo.email
   ```
   Pulsa **Agregar a la tabla → Actualizar** y después **Guardar**.
5. **Público → Usuarios de prueba → Agregar usuarios**: añade la cuenta de Google de cada negocio que vaya a conectar. Si no está en la lista, Google bloquea la conexión.
6. **Clientes → Crear cliente → Aplicación web**:
   - URI de redirección autorizado: `<APP_URL>/api/google/callback`, por ejemplo `https://entrada.volkra.es/api/google/callback`. Tiene que coincidir exactamente con `APP_URL` (mismo dominio, sin barra final); si no, Google responde `redirect_uri_mismatch`. En local: `http://localhost:3000/api/google/callback`.
7. Copia el ID de cliente y el secreto a `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` en Vercel (el secreto solo se muestra completo al crearlo). Comprueba que también están `APP_URL` y `ENCRYPTION_KEY`, y vuelve a desplegar.

Comprueba `<APP_URL>/api/health`: debe mostrar `"google": true`.

> **Verificación de Google:** mientras la app está «en pruebas», solo pueden conectar las cuentas que añadas como usuarios de prueba (hasta 100). El ámbito de calendario es sensible: para abrirlo a cualquier cliente, Google pide verificar la app (política de privacidad en volkra.es, vídeo de demostración…). Para los primeros clientes basta con añadirlos como usuarios de prueba.

## Conectar un negocio

En la app: **Configuración → Integraciones → Conectar Google Calendar**, con la cuenta de Google del negocio.
- Por defecto se usa el calendario `primary`. Se puede cambiar por el ID de otro calendario.
- Para que los eventos de un profesional bloqueen huecos: **Configuración → Equipo**, campo «Calendario de Google» (normalmente su email).

El token se guarda cifrado (AES-256-GCM con `ENCRYPTION_KEY`) y no es accesible desde el navegador.
