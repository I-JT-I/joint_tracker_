-- Adds a language preference column to profiles, used by the new i18n
-- feature (locales/it.json, locales/en.json, i18n.js) to remember the
-- user's chosen app language across devices.
--
-- NOT applied automatically - review and run this yourself (e.g. via the
-- Supabase SQL editor or `supabase db push`) before deploying the i18n
-- changes that read/write profiles.language.
--
-- No RLS policy changes should be needed: this is a new column on the
-- existing `profiles` table, and RLS is row-level, not column-level - the
-- app already reads/writes other columns on this same row
-- (e.g. profiles.username via updateProfile()) under the current policies.

alter table public.profiles
  add column if not exists language text not null default 'it';

alter table public.profiles
  add constraint profiles_language_check check (language in ('it', 'en'));

comment on column public.profiles.language is
  'UI language preference (''it'' or ''en''). Set from the client when the user picks a language in Impostazioni, or on first login if a browser-detected/localStorage preference exists.';
