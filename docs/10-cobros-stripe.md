# 10. Cobro de la suscripción con Stripe

Cada negocio paga su cuota mensual con tarjeta. El administrador del negocio lo hace desde **Configuración → Usuarios y cuenta → Suscripción**. Allí también abre el portal de Stripe para cambiar la tarjeta, descargar facturas o cancelar.

Sin las tres variables de Stripe, la sección muestra «no configurado» y todo lo demás funciona igual. Volkra **no corta el servicio** a quien no paga: el estado se ve en el panel y se decide a mano. Así los pilotos gratuitos no necesitan tarjeta.

## Configuración en Stripe (una vez)

1. Crea la cuenta en https://dashboard.stripe.com y completa los datos de la empresa: titular, NIF, cuenta bancaria.
2. **Productos → Añadir producto**:
   - Nombre: «Volkra Hub · Reception». Cada producto nuevo tendrá su propio precio.
   - Precio recurrente: **149 € al mes**. Decide si el precio incluye el IVA o no.
   - Copia el **ID del precio** (`price_…`) a `STRIPE_PRICE_ID`.
3. **Desarrolladores → Claves de API**: copia la **clave secreta** (`sk_live_…`, o `sk_test_…` para pruebas) a `STRIPE_SECRET_KEY`.
4. **Desarrolladores → Webhooks → Añadir endpoint**:
   - URL: `https://app.volkra.es/api/stripe/webhook`
   - Eventos: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated` y `customer.subscription.deleted`.
   - Copia el **secreto de firma** (`whsec_…`) a `STRIPE_WEBHOOK_SECRET`.
5. **Configuración → Facturación → Portal de clientes**: activa el portal y permite actualizar el método de pago, ver facturas y cancelar la suscripción.
6. **Configuración → Facturación → Facturas**: activa el envío de facturas por email. Pon los datos fiscales de Volkra en las facturas.
7. Pon las tres variables en Vercel (Production) y vuelve a desplegar. `https://app.volkra.es/api/health` debe mostrar `"billing": true`.

> Prueba primero con las claves de **modo de prueba** (`sk_test_…`) y la tarjeta 4242 4242 4242 4242. Después cambia a las claves reales: una nueva clave secreta, un nuevo secreto de webhook y el ID del precio en modo real.

## Cómo funciona

- **Suscribirse** abre la página de pago de Stripe, en español y con NIF opcional para la factura.
- Stripe avisa a `/api/stripe/webhook`, firmado y comprobado. El estado se guarda en la tabla `billing`, que solo escribe el servidor; nadie puede marcarse como pagado desde el navegador.
- Estados: Sin suscripción, Pago pendiente, Activa, Pago atrasado, Impagada y Cancelada.
