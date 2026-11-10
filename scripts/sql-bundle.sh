#!/bin/sh
# Genera supabase/esquema-completo.sql: todas las migraciones en un solo bloque para pegar en el
# SQL Editor de Supabase (alternativa a `npm run db:migrate`). Registra las migraciones aplicadas.
cd "$(dirname "$0")/.." || exit 1
out=supabase/esquema-completo.sql
{
  echo "-- Volkra Recepción · esquema completo para el SQL Editor de Supabase (generado; no editar a mano)"
  for f in supabase/migrations/*.sql; do echo; echo "-- ===== $(basename "$f") ====="; cat "$f"; done
  echo
  echo "create table if not exists public._migrations (name text primary key, applied_at timestamptz not null default now());"
  for f in supabase/migrations/*.sql; do echo "insert into public._migrations(name) values ('$(basename "$f")') on conflict do nothing;"; done
  echo "select 'Volkra: esquema creado' as resultado;"
} > "$out"
echo "Generado $out"
