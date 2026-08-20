-- Colonna mai referenziata da nessuna parte del codice: un'impostazione fantasma che
-- sembrerebbe fare qualcosa ma non ha alcun effetto e' peggio che non averla affatto.
alter table public.profiles drop column is_private;
