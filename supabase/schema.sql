-- Schéma Supabase du site Batiste Masson (mesure d'audience sans cookie + réponses au questionnaire).
-- À coller une seule fois dans Supabase → SQL Editor → Run, après relecture.
-- Principes :
--   * RLS activé sur toutes les tables, aucun droit pour le public (anon) : le site écrit seulement
--     par l'endpoint /api/collect (Cloudflare), qui utilise la clé secrète côté serveur.
--   * Lecture réservée aux comptes listés dans public.admins (adresse mail confirmée).
--   * Aucune adresse IP stockée : seulement une empreinte avec un sel aléatoire qui change chaque jour
--     et qui est effacé le lendemain.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- Administrateurs
create table public.admins (
  email text primary key check (email = lower(email))
);
alter table public.admins enable row level security;
revoke all on public.admins from anon, authenticated;
insert into public.admins (email) values ('batiste.masson76@orange.fr');

-- Vrai seulement pour un utilisateur connecté dont l'adresse (confirmée) est dans la liste.
create or replace function public.est_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from auth.users u
    join public.admins a on a.email = lower(u.email)
    where u.id = auth.uid() and u.email_confirmed_at is not null
  );
$$;
revoke execute on function public.est_admin() from public, anon;
grant execute on function public.est_admin() to authenticated;

-- ---------------------------------------------------------------- Événements (mesure d'audience)
create table public.evenements (
  id bigint generated always as identity primary key,
  cree_le timestamptz not null default now(),
  site text not null check (site in ('prod', 'apercu', 'local')),
  type text not null check (type in ('vue', 'clic', 'questionnaire_debut', 'questionnaire_envoye', 'fiche_envoyee')),
  page text not null check (char_length(page) between 1 and 200),
  cible text check (char_length(cible) <= 60),
  source text check (char_length(source) <= 100),
  appareil text check (appareil in ('mobile', 'tablette', 'ordinateur')),
  prospect text check (char_length(prospect) <= 80),
  visiteur text check (visiteur ~ '^[0-9a-f]{16}$')
);
create index evenements_cree_le on public.evenements (cree_le);
create index evenements_type_cree_le on public.evenements (type, cree_le);
alter table public.evenements enable row level security;
revoke all on public.evenements from anon, authenticated;
grant select on public.evenements to authenticated;
create policy "admin lit les evenements" on public.evenements
  for select to authenticated using (public.est_admin());

-- ---------------------------------------------------------------- Réponses au questionnaire
create table public.reponses (
  id uuid primary key,
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now(),
  site text not null check (site in ('prod', 'apercu', 'local')),
  entreprise text check (char_length(entreprise) <= 120),
  prenom text check (char_length(prenom) <= 80),
  email text check (char_length(email) <= 200),
  telephone text check (char_length(telephone) <= 40),
  metier text check (char_length(metier) <= 120),
  profil text check (char_length(profil) <= 120),
  prospect text check (char_length(prospect) <= 80),
  reponses jsonb not null default '{}'::jsonb check (pg_column_size(reponses) <= 40000),
  fiche text check (char_length(fiche) <= 20000),
  prompt_claude text check (char_length(prompt_claude) <= 30000),
  statut text not null default 'nouveau' check (statut in ('nouveau', 'contacte', 'devis', 'signe', 'perdu')),
  note text check (char_length(note) <= 2000)
);
create index reponses_cree_le on public.reponses (cree_le);
alter table public.reponses enable row level security;
revoke all on public.reponses from anon, authenticated;
grant select on public.reponses to authenticated;
grant update (statut, note, maj_le) on public.reponses to authenticated;
create policy "admin lit les reponses" on public.reponses
  for select to authenticated using (public.est_admin());
create policy "admin suit les reponses" on public.reponses
  for update to authenticated using (public.est_admin()) with check (public.est_admin());

-- ---------------------------------------------------------------- Limite de débit (utilisée par l'endpoint)
create table public.limites (
  cle text primary key,
  compte integer not null,
  fin timestamptz not null
);
alter table public.limites enable row level security;
revoke all on public.limites from anon, authenticated;

-- Renvoie vrai tant que la clé n'a pas dépassé p_max appels sur une fenêtre de p_secondes.
create or replace function public.prendre_jeton(p_cle text, p_max integer, p_secondes integer)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v integer;
begin
  insert into public.limites as l (cle, compte, fin)
  values (p_cle, 1, now() + make_interval(secs => p_secondes))
  on conflict (cle) do update set
    compte = case when l.fin < now() then 1 else l.compte + 1 end,
    fin    = case when l.fin < now() then now() + make_interval(secs => p_secondes) else l.fin end
  returning compte into v;
  return v <= p_max;
end;
$$;
revoke execute on function public.prendre_jeton(text, integer, integer) from public, anon, authenticated;
grant execute on function public.prendre_jeton(text, integer, integer) to service_role;

-- ---------------------------------------------------------------- Sel du jour (empreinte des visiteurs)
create table public.sels (
  jour date primary key,
  sel text not null
);
alter table public.sels enable row level security;
revoke all on public.sels from anon, authenticated;

-- Un sel aléatoire par jour (heure de Paris) ; les sels des jours passés sont effacés,
-- ce qui rend les empreintes d'hier impossibles à relier à une adresse IP.
create or replace function public.sel_du_jour()
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  j date := (now() at time zone 'Europe/Paris')::date;
  v text;
begin
  delete from public.sels where jour < j;
  delete from public.limites where fin < now() - interval '1 hour';
  insert into public.sels (jour, sel) values (j, encode(extensions.gen_random_bytes(32), 'hex'))
  on conflict (jour) do nothing;
  select sel into v from public.sels where jour = j;
  return v;
end;
$$;
revoke execute on function public.sel_du_jour() from public, anon, authenticated;
grant execute on function public.sel_du_jour() to service_role;

-- ---------------------------------------------------------------- Durées de conservation
-- Événements : 13 mois. Réponses sans suite (nouveau, contacté, perdu) : 12 mois après la dernière mise à jour.
create or replace function public.purger()
returns void
language sql security definer set search_path = ''
as $$
  delete from public.evenements where cree_le < now() - interval '13 months';
  delete from public.reponses where statut in ('nouveau', 'contacte', 'perdu') and maj_le < now() - interval '12 months';
$$;
revoke execute on function public.purger() from public, anon, authenticated;

-- ---------------------------------------------------------------- Droits du serveur (clé secrète)
-- Le projet n'ouvre pas automatiquement les nouvelles tables à l'API : on donne seulement ce dont l'endpoint a besoin.
grant select, insert on public.evenements to service_role;
grant select, insert, update on public.reponses to service_role;
grant select, insert, update, delete on public.limites, public.sels to service_role;

create extension if not exists pg_cron;
select cron.schedule('purge-quotidienne', '15 3 * * *', 'select public.purger()');
