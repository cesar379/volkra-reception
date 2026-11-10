-- Repara valores jsonb guardados como texto JSON (doble serialización del driver postgres.js,
-- corregida en src/server/db/client.ts). En bases sin el problema no cambia nada.
update public.call_events set detail = (detail #>> '{}')::jsonb where jsonb_typeof(detail) = 'string';
update public.special_days set hours = (hours #>> '{}')::jsonb where jsonb_typeof(hours) = 'string';
update public.webhook_events set response = (response #>> '{}')::jsonb where jsonb_typeof(response) = 'string';
update public.simulator_sessions set messages = (messages #>> '{}')::jsonb where jsonb_typeof(messages) = 'string';
update public.simulator_sessions set state = (state #>> '{}')::jsonb where jsonb_typeof(state) = 'string';
