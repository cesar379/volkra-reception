# 1. Supabase: base de datos y acceso

En producción, la base de datos y el inicio de sesión son de Supabase. En local no hace falta: la app usa Postgres embebido.

## Crear el proyecto

1. Crea una cuenta en https://supabase.com y un proyecto nuevo.
   - **Región:** elige una de la UE, por ejemplo Frankfurt. Así los datos se quedan en la Unión Europea (RGPD).
   - Guarda la contraseña de la base de datos en tu gestor de contraseñas.
2. En **Project Settings → Data API** copia la *Project URL* y la clave *anon* (o *publishable*). Van a:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
3. En **Connect → Transaction pooler** copia la cadena de conexión (puerto **6543**) y pon tu contraseña. Va a `DATABASE_URL`.

## Crear las tablas

Desde tu ordenador, en la carpeta del proyecto:

```bash
DATABASE_URL="postgresql://postgres.xxxx:CONTRASEÑA@aws-0-eu-central-1.pooler.supabase.com:6543/postgres" npm run db:migrate
```

Alternativa sin terminal: copia `supabase/esquema-completo.sql` (generado con `npm run db:sql-bundle`) en el **SQL Editor** de Supabase y pulsa *Run*.

Aplica `supabase/migrations/*.sql`: tablas, restricción anti-solapes, Row Level Security y funciones. Si usas la CLI de Supabase, `supabase db push` lee la misma carpeta.

## Configurar el acceso

En **Authentication → URL Configuration**:
- **Site URL:** la URL de la app, por ejemplo `https://app.volkra.es`.
- **Redirect URLs:** añade la misma URL.

Por defecto Supabase pide confirmar el email al registrarse. Es lo recomendable.

### Recuperar la contraseña

«¿Has olvidado tu contraseña?» en `/login` envía un enlace que pasa por `/auth/confirm` y lleva a `/nueva-contrasena`. Con la plantilla por defecto de Supabase el enlace solo funciona en el navegador donde se pidió. Para que funcione en cualquiera (por ejemplo, pedirlo en el ordenador y abrirlo en el móvil), en **Authentication → Emails → Reset Password** cambia el enlace por:

```html
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/nueva-contrasena">Elegir una contraseña nueva</a>
```

## Primer usuario y primer negocio

1. Abre la app desplegada, pulsa **Crear cuenta** y confirma el email.
2. Te llevará a **Añadir un negocio**: elige nombre y sector. Se crea con un horario y servicios de partida que luego editas.

### Opcional: negocios de demostración en producción

Para enseñar la demo en tu despliegue, crea antes tu usuario y después ejecuta:

```bash
DATABASE_URL="..." npm run db:seed-demo -- tu-email@volkra.es
```

Esto te asigna la clínica y el taller ficticios, con todos sus datos marcados como simulados.

## Pendiente de comprobar en el primer despliegue

Las migraciones y la seguridad por empresa (RLS) están probadas con PGlite, que es PostgreSQL 17 real compilado a WASM, pero **todavía no contra un proyecto de Supabase real**. En el primer despliegue:
- Comprueba que `npm run db:migrate` termina sin errores.
- Entra con dos usuarios distintos y verifica que cada uno solo ve su negocio.
