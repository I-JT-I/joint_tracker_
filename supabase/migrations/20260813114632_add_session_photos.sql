alter table public.smokes add column photo_path text;

-- Ogni utente puo' gestire solo i file nella propria cartella (path: {user_id}/...)
create policy "Users can view their own session photos"
  on storage.objects for select
  using (bucket_id = 'session-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users can upload their own session photos"
  on storage.objects for insert
  with check (bucket_id = 'session-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users can update their own session photos"
  on storage.objects for update
  using (bucket_id = 'session-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users can delete their own session photos"
  on storage.objects for delete
  using (bucket_id = 'session-photos' and (storage.foldername(name))[1] = auth.uid()::text);
