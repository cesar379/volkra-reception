# 2. Desplegar en Vercel

## Requisitos

- Supabase configurado ([guía 1](01-supabase.md)). En Vercel **hay que usar `DATABASE_URL`**: la base embebida es solo para local, porque el disco de Vercel no es persistente.
- El código en un repositorio de GitHub.

## Pasos

1. En https://vercel.com, **Add New → Project** e importa el repositorio. Vercel detecta Next.js.
2. En **Environment Variables** añade como mínimo:

| Variable | Valor |
|---|---|
| `APP_URL` | `https://app.volkra.es` (o la URL de Vercel mientras tanto) |
| `APP_SECRET` | `openssl rand -base64 32` |
| `ENCRYPTION_KEY` | `openssl rand -base64 32` |
| `DATABASE_URL` | Cadena del *transaction pooler* de Supabase |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Los de Supabase |
| `VAPI_WEBHOOK_SECRET` | `openssl rand -base64 32` (el mismo que pondrás en Vapi) |
| `CRON_SECRET` | `openssl rand -base64 32` |

   Opcionales: `ANTHROPIC_API_KEY` (simulador con Claude), `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, `RESEND_API_KEY` / `EMAIL_FROM`, `ALLOW_DEMO_LOGIN=true` (si quieres las cuentas demo visibles en tu despliegue de ventas).
3. **Deploy.**
4. **Dominio:** en **Settings → Domains** añade `app.volkra.es` y crea el registro CNAME que te indique Vercel en el DNS de volkra.es (SiteGround). Después pon `APP_URL=https://app.volkra.es` y vuelve a desplegar.
5. Comprueba `https://app.volkra.es/api/health`: debe devolver `"ok": true` y `"database": "postgres"`.

## Cambio de entrada.volkra.es a app.volkra.es

`entrada.volkra.es` sigue funcionando como dirección antigua. Sus páginas redirigen a `app.volkra.es` (lo hace `src/proxy.ts`), pero las APIs, el chat y el widget responden igual. Así no se rompen los webhooks de Meta, ElevenLabs, Vapi o Stripe ni los widgets ya instalados en webs de clientes.

Pasos, en este orden:
1. **SiteGround → DNS Zone Editor:** CNAME `app` apuntando al valor que indique Vercel. Normalmente es `cname.vercel-dns.com` o el mismo destino que el CNAME de `entrada`.
2. **Vercel → Settings → Domains:** añadir `app.volkra.es`. Mantener `entrada.volkra.es` asignado al proyecto, sin redirección en Vercel.
3. **Supabase → Authentication → URL Configuration:** Site URL `https://app.volkra.es`. Añadir `https://app.volkra.es/**` a las Redirect URLs y dejar la de entrada.
4. **Google Cloud → Credenciales → cliente OAuth:** añadir el URI de redirección `https://app.volkra.es/api/google/callback`, sin quitar el antiguo. En la pantalla de consentimiento, cambiar privacidad y condiciones a `https://app.volkra.es/...`.
5. **Vercel → Environment Variables:** `APP_URL=https://app.volkra.es` y redeploy. Desde ese momento, las páginas de entrada.volkra.es redirigen a la nueva dirección.
6. **Opcional:** en Meta, ElevenLabs y Stripe se pueden cambiar las URLs de webhook a `app.volkra.es`; las antiguas siguen funcionando.

Quien tenga la sesión abierta en entrada.volkra.es tendrá que volver a entrar una vez en app.volkra.es.

## Tareas programadas

`vercel.json` programa dos:
- `/api/cron/calendar-sync` (04:00 UTC): reintenta las citas que no se pudieron copiar a Google Calendar. Con el plan Pro puedes pasarla a cada 15 minutos (`*/15 * * * *`).
- `/api/cron/daily` (16:00 UTC, por la tarde en España): envía el recordatorio por email de las citas del día siguiente y, por RGPD, borra el texto de las conversaciones de chat web y WhatsApp ya terminadas y los ids de mensajes de WhatsApp de más de 8 días.

En el plan gratuito (Hobby), Vercel solo permite ejecutar tareas programadas **una vez al día**.

Vercel envía `CRON_SECRET` automáticamente como cabecera `Authorization`.

## Notas

- El webhook de Vapi responde en milisegundos, pero Vapi da como máximo **7,5 s** para `assistant-request`. Despliega en una región de la UE (**Settings → Functions → Region**, por ejemplo `fra1`) cerca de Supabase para reducir la latencia.

## Migraciones automáticas

Antes de cada build, `npm run build` ejecuta `scripts/vercel-migrate.ts` (script `prebuild`). En los despliegues de **producción** de Vercel aplica las migraciones pendientes de `supabase/migrations` con la `DATABASE_URL` del proyecto. Así el código nuevo nunca llega antes que su esquema.
- Si una migración falla, el despliegue falla y Vercel sigue sirviendo la versión anterior. El motivo aparece en el log del build (líneas `[migraciones]`).
- En previews, en local o sin `DATABASE_URL` no hace nada.
