-- Defensa en profundidad: el rol anónimo de Supabase no necesita ningún acceso a estas tablas
-- (la app accede por el servidor). RLS ya lo bloquea; además quitamos los permisos por defecto.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon, public;
grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.create_business(text, text) to authenticated;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon, public;
