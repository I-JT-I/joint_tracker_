alter table public.smokes add column context_tag text;
alter table public.smokes add column mood_rating smallint check (mood_rating between 1 and 5);
