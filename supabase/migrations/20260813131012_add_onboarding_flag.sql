-- Gli utenti gia' esistenti hanno gia' capito come funziona l'app: non serve mostrargli
-- il tutorial la prossima volta che accedono.
alter table public.profiles add column onboarding_completed boolean not null default true;
alter table public.profiles alter column onboarding_completed set default false;
