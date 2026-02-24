-- Memoflix DB Schema (Akun + Komentar + Like + Secret Message Sender)
-- Jalankan di Supabase SQL Editor.

create extension if not exists pgcrypto;

-- 1) Secret messages (existing-safe)
create table if not exists public.secret_messages (
  id uuid primary key default gen_random_uuid(),
  to_name text not null,
  title text not null,
  from_name text,
  music_url text,
  message_text text not null,
  sender_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '3 months')
);

alter table public.secret_messages
add column if not exists sender_user_id uuid references auth.users(id) on delete set null;

alter table public.secret_messages
add column if not exists expires_at timestamptz;

update public.secret_messages
set expires_at = coalesce(expires_at, created_at + interval '3 months');

alter table public.secret_messages
alter column expires_at set not null;

-- 2) Profile user (1:1 dengan auth.users)
create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  username text,
  is_admin boolean not null default false,
  email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_profiles
add column if not exists username text;

alter table public.user_profiles
add column if not exists is_admin boolean not null default false;

alter table public.user_profiles
add column if not exists is_suspended boolean not null default false;

alter table public.user_profiles
add column if not exists suspended_reason text;

alter table public.user_profiles
add column if not exists suspended_until timestamptz;

alter table public.user_profiles
add column if not exists suspended_at timestamptz;

alter table public.user_profiles
add column if not exists suspended_by uuid references auth.users(id) on delete set null;

update public.user_profiles
set username = lower(regexp_replace(split_part(email, '@', 1), '[^a-z0-9_.]', '', 'g'))
where username is null or btrim(username) = '';

update public.user_profiles
set username = 'user_' || substr(replace(user_id::text, '-', ''), 1, 8)
where username is null or btrim(username) = '';

update public.user_profiles
set is_suspended = coalesce(is_suspended, false);

with duplicates as (
  select username, min(user_id::text)::uuid as keep_user_id
  from public.user_profiles
  group by username
  having count(*) > 1
)
update public.user_profiles p
set username = p.username || '_' || substr(replace(p.user_id::text, '-', ''), 1, 4)
from duplicates d
where p.username = d.username
  and p.user_id <> d.keep_user_id;

alter table public.user_profiles
alter column username set not null;

create unique index if not exists uq_user_profiles_username_lower
on public.user_profiles (lower(username));

create index if not exists idx_user_profiles_is_suspended
on public.user_profiles(is_suspended);

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_profiles (user_id, display_name, username, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1), new.email),
    coalesce(
      nullif(lower(regexp_replace(new.raw_user_meta_data ->> 'username', '[^a-z0-9_.]', '', 'g')), ''),
      lower(regexp_replace(split_part(new.email, '@', 1), '[^a-z0-9_.]', '', 'g')),
      'user_' || substr(replace(new.id::text, '-', ''), 1, 8)
    ),
    new.email
  )
  on conflict (user_id) do update
  set
    display_name = excluded.display_name,
    username = excluded.username,
    email = excluded.email,
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_user_profiles_updated_at on public.user_profiles;
create trigger trg_user_profiles_updated_at
before update on public.user_profiles
for each row execute function public.set_updated_at();

-- 3) Komentar memorial
create table if not exists public.memorial_comments (
  id uuid primary key default gen_random_uuid(),
  memorial_key text not null,
  content text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  user_name text not null,
  reply_to_comment_id uuid references public.memorial_comments(id) on delete set null,
  reply_to_user_id uuid references auth.users(id) on delete set null,
  reply_to_user_name text,
  created_at timestamptz not null default now()
);

alter table public.memorial_comments
add column if not exists reply_to_comment_id uuid references public.memorial_comments(id) on delete set null;

alter table public.memorial_comments
add column if not exists reply_to_user_id uuid references auth.users(id) on delete set null;

alter table public.memorial_comments
add column if not exists reply_to_user_name text;

-- 4) Like memorial (1 user 1 like per memorial)
create table if not exists public.memorial_likes (
  id uuid primary key default gen_random_uuid(),
  memorial_key text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (memorial_key, user_id)
);

-- 4.1) Like komentar memorial (1 user 1 like per komentar)
create table if not exists public.memorial_comment_likes (
  id uuid primary key default gen_random_uuid(),
  memorial_key text not null,
  comment_id uuid not null references public.memorial_comments(id) on delete cascade,
  comment_owner_user_id uuid references auth.users(id) on delete set null,
  comment_owner_user_name text,
  comment_excerpt text,
  user_id uuid not null references auth.users(id) on delete cascade,
  user_name text,
  created_at timestamptz not null default now(),
  unique (comment_id, user_id)
);

alter table public.memorial_comment_likes
add column if not exists comment_owner_user_id uuid references auth.users(id) on delete set null;

alter table public.memorial_comment_likes
add column if not exists comment_owner_user_name text;

alter table public.memorial_comment_likes
add column if not exists comment_excerpt text;

-- 4.2) System announcements (chat notif update website dari admin)
create table if not exists public.system_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'Update Website',
  section text,
  message text not null,
  created_by text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_memorial_comments_memorial_key on public.memorial_comments(memorial_key);
create index if not exists idx_memorial_comments_user_id on public.memorial_comments(user_id);
create index if not exists idx_memorial_comments_reply_to_user_id on public.memorial_comments(reply_to_user_id);
create index if not exists idx_memorial_likes_memorial_key on public.memorial_likes(memorial_key);
create index if not exists idx_memorial_likes_user_id on public.memorial_likes(user_id);
create index if not exists idx_memorial_comment_likes_memorial_key on public.memorial_comment_likes(memorial_key);
create index if not exists idx_memorial_comment_likes_comment_owner_user_id on public.memorial_comment_likes(comment_owner_user_id);
create index if not exists idx_memorial_comment_likes_user_id on public.memorial_comment_likes(user_id);
create index if not exists idx_secret_messages_sender_user_id on public.secret_messages(sender_user_id);
create index if not exists idx_system_announcements_created_at on public.system_announcements(created_at desc);

-- ======================
-- RLS + POLICY
-- ======================
alter table public.secret_messages enable row level security;
alter table public.user_profiles enable row level security;
alter table public.memorial_comments enable row level security;
alter table public.memorial_likes enable row level security;
alter table public.memorial_comment_likes enable row level security;
alter table public.system_announcements enable row level security;

-- secret_messages
drop policy if exists "allow public read secret_messages" on public.secret_messages;
drop policy if exists "allow auth insert secret_messages" on public.secret_messages;
drop policy if exists "allow public delete expired secret_messages" on public.secret_messages;

create policy "allow public read secret_messages"
on public.secret_messages
for select
to anon, authenticated
using (true);

create policy "allow auth insert secret_messages"
on public.secret_messages
for insert
to authenticated
with check (auth.uid() = sender_user_id or sender_user_id is null);

create policy "allow public delete expired secret_messages"
on public.secret_messages
for delete
to anon, authenticated
using (expires_at < now());

-- user_profiles
drop policy if exists "allow own profile read" on public.user_profiles;
drop policy if exists "allow admin read all profiles" on public.user_profiles;
drop policy if exists "allow own profile insert" on public.user_profiles;
drop policy if exists "allow own profile update" on public.user_profiles;
drop policy if exists "allow admin update all profiles" on public.user_profiles;

create policy "allow own profile read"
on public.user_profiles
for select
to authenticated
using (auth.uid() = user_id);

create policy "allow admin read all profiles"
on public.user_profiles
for select
to authenticated
using (
  exists (
    select 1
    from public.user_profiles p
    where p.user_id = auth.uid()
      and p.is_admin = true
  )
);

create policy "allow own profile insert"
on public.user_profiles
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "allow own profile update"
on public.user_profiles
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "allow admin update all profiles"
on public.user_profiles
for update
to authenticated
using (
  exists (
    select 1
    from public.user_profiles p
    where p.user_id = auth.uid()
      and p.is_admin = true
  )
)
with check (
  exists (
    select 1
    from public.user_profiles p
    where p.user_id = auth.uid()
      and p.is_admin = true
  )
);

-- memorial_comments
drop policy if exists "allow public read memorial_comments" on public.memorial_comments;
drop policy if exists "allow auth insert memorial_comments" on public.memorial_comments;
drop policy if exists "allow own delete memorial_comments" on public.memorial_comments;

create policy "allow public read memorial_comments"
on public.memorial_comments
for select
to anon, authenticated
using (true);

create policy "allow auth insert memorial_comments"
on public.memorial_comments
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "allow own delete memorial_comments"
on public.memorial_comments
for delete
to authenticated
using (auth.uid() = user_id);

-- memorial_likes
drop policy if exists "allow public read memorial_likes" on public.memorial_likes;
drop policy if exists "allow auth insert memorial_likes" on public.memorial_likes;
drop policy if exists "allow own delete memorial_likes" on public.memorial_likes;

create policy "allow public read memorial_likes"
on public.memorial_likes
for select
to anon, authenticated
using (true);

create policy "allow auth insert memorial_likes"
on public.memorial_likes
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "allow own delete memorial_likes"
on public.memorial_likes
for delete
to authenticated
using (auth.uid() = user_id);

-- memorial_comment_likes
drop policy if exists "allow public read memorial_comment_likes" on public.memorial_comment_likes;
drop policy if exists "allow auth insert memorial_comment_likes" on public.memorial_comment_likes;
drop policy if exists "allow own delete memorial_comment_likes" on public.memorial_comment_likes;

create policy "allow public read memorial_comment_likes"
on public.memorial_comment_likes
for select
to anon, authenticated
using (true);

create policy "allow auth insert memorial_comment_likes"
on public.memorial_comment_likes
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "allow own delete memorial_comment_likes"
on public.memorial_comment_likes
for delete
to authenticated
using (auth.uid() = user_id);

-- system_announcements
drop policy if exists "allow public read system_announcements" on public.system_announcements;
drop policy if exists "allow admin insert system_announcements" on public.system_announcements;
drop policy if exists "allow admin update system_announcements" on public.system_announcements;
drop policy if exists "allow admin delete system_announcements" on public.system_announcements;

create policy "allow public read system_announcements"
on public.system_announcements
for select
to anon, authenticated
using (true);

create policy "allow admin insert system_announcements"
on public.system_announcements
for insert
to authenticated
with check (
  exists (
    select 1
    from public.user_profiles p
    where p.user_id = auth.uid()
      and p.is_admin = true
  )
);

create policy "allow admin update system_announcements"
on public.system_announcements
for update
to authenticated
using (
  exists (
    select 1
    from public.user_profiles p
    where p.user_id = auth.uid()
      and p.is_admin = true
  )
)
with check (
  exists (
    select 1
    from public.user_profiles p
    where p.user_id = auth.uid()
      and p.is_admin = true
  )
);

create policy "allow admin delete system_announcements"
on public.system_announcements
for delete
to authenticated
using (
  exists (
    select 1
    from public.user_profiles p
    where p.user_id = auth.uid()
      and p.is_admin = true
  )
);

-- 5) View statistik profile
create or replace view public.user_profile_stats as
select
  u.id as user_id,
  coalesce(p.display_name, u.email) as display_name,
  p.username as username,
  p.is_admin as is_admin,
  u.email as email,
  (
    select count(*)::int
    from public.memorial_comments c
    where c.user_id = u.id
  ) as total_comments,
  (
    select count(*)::int
    from public.memorial_likes l
    where l.user_id = u.id
  ) as total_likes,
  (
    select count(*)::int
    from public.secret_messages s
    where s.sender_user_id = u.id
  ) as total_secret_messages
from auth.users u
left join public.user_profiles p on p.user_id = u.id;

create or replace view public.my_profile_stats as
select *
from public.user_profile_stats
where user_id = auth.uid();

grant select on public.user_profile_stats to authenticated;
grant select on public.my_profile_stats to authenticated;

-- 6) Public username checker (untuk validasi username unik saat register)
create or replace view public.usernames_public as
select lower(username) as username
from public.user_profiles;

grant select on public.usernames_public to anon, authenticated;
grant select on public.memorial_comment_likes to anon, authenticated;
grant insert, delete on public.memorial_comment_likes to authenticated;
grant select on public.system_announcements to anon, authenticated;
grant insert, update, delete on public.system_announcements to authenticated;

-- 7) Memorial catalog (admin-managed data source for Home)
create table if not exists public.memorial_catalog (
  id text primary key default ('m_' || replace(gen_random_uuid()::text, '-', '')),
  title text not null,
  year text not null,
  short text not null,
  cover text not null,
  story text not null,
  gallery jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_memorial_catalog_updated_at on public.memorial_catalog;
create trigger trg_memorial_catalog_updated_at
before update on public.memorial_catalog
for each row execute function public.set_updated_at();

create index if not exists idx_memorial_catalog_active_created_at
on public.memorial_catalog(is_active, created_at desc);

alter table public.memorial_catalog enable row level security;

drop policy if exists "allow public read memorial_catalog" on public.memorial_catalog;
drop policy if exists "allow admin insert memorial_catalog" on public.memorial_catalog;
drop policy if exists "allow admin update memorial_catalog" on public.memorial_catalog;
drop policy if exists "allow admin delete memorial_catalog" on public.memorial_catalog;

create policy "allow public read memorial_catalog"
on public.memorial_catalog
for select
to anon, authenticated
using (is_active = true);

create policy "allow admin insert memorial_catalog"
on public.memorial_catalog
for insert
to authenticated
with check (
  exists (
    select 1
    from public.user_profiles p
    where p.user_id = auth.uid()
      and p.is_admin = true
  )
);

create policy "allow admin update memorial_catalog"
on public.memorial_catalog
for update
to authenticated
using (
  exists (
    select 1
    from public.user_profiles p
    where p.user_id = auth.uid()
      and p.is_admin = true
  )
)
with check (
  exists (
    select 1
    from public.user_profiles p
    where p.user_id = auth.uid()
      and p.is_admin = true
  )
);

create policy "allow admin delete memorial_catalog"
on public.memorial_catalog
for delete
to authenticated
using (
  exists (
    select 1
    from public.user_profiles p
    where p.user_id = auth.uid()
      and p.is_admin = true
  )
);

grant select on public.memorial_catalog to anon, authenticated;
grant insert, update, delete on public.memorial_catalog to authenticated;

-- 8) Friend requests (permanent social graph)
create table if not exists public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  sender_user_id uuid not null references auth.users(id) on delete cascade,
  sender_username text not null,
  receiver_user_id uuid references auth.users(id) on delete set null,
  receiver_username text not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_friend_requests_sender on public.friend_requests(sender_user_id, created_at desc);
create index if not exists idx_friend_requests_receiver on public.friend_requests(receiver_user_id, created_at desc);
create index if not exists idx_friend_requests_sender_username on public.friend_requests(lower(sender_username));
create index if not exists idx_friend_requests_receiver_username on public.friend_requests(lower(receiver_username));
create index if not exists idx_friend_requests_status on public.friend_requests(status);

drop trigger if exists trg_friend_requests_updated_at on public.friend_requests;
create trigger trg_friend_requests_updated_at
before update on public.friend_requests
for each row execute function public.set_updated_at();

alter table public.friend_requests enable row level security;

drop policy if exists "allow own read friend_requests" on public.friend_requests;
drop policy if exists "allow admin read all friend_requests" on public.friend_requests;
drop policy if exists "allow own insert friend_requests" on public.friend_requests;
drop policy if exists "allow receiver update friend_requests" on public.friend_requests;
drop policy if exists "allow sender delete friend_requests" on public.friend_requests;

create policy "allow own read friend_requests"
on public.friend_requests
for select
to authenticated
using (
  auth.uid() = sender_user_id
  or auth.uid() = receiver_user_id
  or lower(sender_username) = lower(coalesce(
    (select p.username from public.user_profiles p where p.user_id = auth.uid()),
    ''
  ))
  or lower(receiver_username) = lower(coalesce(
    (select p.username from public.user_profiles p where p.user_id = auth.uid()),
    ''
  ))
);

create policy "allow admin read all friend_requests"
on public.friend_requests
for select
to authenticated
using (
  exists (
    select 1
    from public.user_profiles p
    where p.user_id = auth.uid()
      and p.is_admin = true
  )
);

create policy "allow own insert friend_requests"
on public.friend_requests
for insert
to authenticated
with check (
  auth.uid() = sender_user_id
  and lower(sender_username) = lower(coalesce(
    (select p.username from public.user_profiles p where p.user_id = auth.uid()),
    sender_username
  ))
);

create policy "allow receiver update friend_requests"
on public.friend_requests
for update
to authenticated
using (
  auth.uid() = receiver_user_id
  or lower(receiver_username) = lower(coalesce(
    (select p.username from public.user_profiles p where p.user_id = auth.uid()),
    ''
  ))
)
with check (
  auth.uid() = receiver_user_id
  or lower(receiver_username) = lower(coalesce(
    (select p.username from public.user_profiles p where p.user_id = auth.uid()),
    ''
  ))
);

create policy "allow sender delete friend_requests"
on public.friend_requests
for delete
to authenticated
using (auth.uid() = sender_user_id);

grant select, insert, update, delete on public.friend_requests to authenticated;

-- Ensure friend request user_ids are always resolved from usernames when possible.
create or replace function public.hydrate_friend_request_user_ids()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  sender_profile_id uuid;
  receiver_profile_id uuid;
begin
  if new.sender_user_id is null and coalesce(new.sender_username, '') <> '' then
    select p.user_id
    into sender_profile_id
    from public.user_profiles p
    where lower(p.username) = lower(new.sender_username)
    limit 1;
    new.sender_user_id := coalesce(new.sender_user_id, sender_profile_id);
  end if;

  if new.receiver_user_id is null and coalesce(new.receiver_username, '') <> '' then
    select p.user_id
    into receiver_profile_id
    from public.user_profiles p
    where lower(p.username) = lower(new.receiver_username)
    limit 1;
    new.receiver_user_id := coalesce(new.receiver_user_id, receiver_profile_id);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_hydrate_friend_request_user_ids on public.friend_requests;
create trigger trg_hydrate_friend_request_user_ids
before insert or update on public.friend_requests
for each row execute function public.hydrate_friend_request_user_ids();

-- 9) Direct messages (permanent user-to-user chat)
create table if not exists public.direct_messages (
  id uuid primary key default gen_random_uuid(),
  sender_user_id uuid not null references auth.users(id) on delete cascade,
  sender_username text not null,
  recipient_user_id uuid references auth.users(id) on delete set null,
  recipient_username text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_direct_messages_sender on public.direct_messages(sender_user_id, created_at desc);
create index if not exists idx_direct_messages_recipient on public.direct_messages(recipient_user_id, created_at desc);
create index if not exists idx_direct_messages_sender_username on public.direct_messages(lower(sender_username));
create index if not exists idx_direct_messages_recipient_username on public.direct_messages(lower(recipient_username));
create index if not exists idx_direct_messages_created_at on public.direct_messages(created_at desc);

alter table public.direct_messages enable row level security;

drop policy if exists "allow own read direct_messages" on public.direct_messages;
drop policy if exists "allow admin read all direct_messages" on public.direct_messages;
drop policy if exists "allow own insert direct_messages" on public.direct_messages;
drop policy if exists "allow own delete direct_messages" on public.direct_messages;

create policy "allow own read direct_messages"
on public.direct_messages
for select
to authenticated
using (
  auth.uid() = sender_user_id
  or auth.uid() = recipient_user_id
  or lower(sender_username) = lower(coalesce(
    (select p.username from public.user_profiles p where p.user_id = auth.uid()),
    ''
  ))
  or lower(recipient_username) = lower(coalesce(
    (select p.username from public.user_profiles p where p.user_id = auth.uid()),
    ''
  ))
);

create policy "allow admin read all direct_messages"
on public.direct_messages
for select
to authenticated
using (
  exists (
    select 1
    from public.user_profiles p
    where p.user_id = auth.uid()
      and p.is_admin = true
  )
);

create policy "allow own insert direct_messages"
on public.direct_messages
for insert
to authenticated
with check (
  auth.uid() = sender_user_id
  and lower(sender_username) = lower(coalesce(
    (select p.username from public.user_profiles p where p.user_id = auth.uid()),
    sender_username
  ))
);

create policy "allow own delete direct_messages"
on public.direct_messages
for delete
to authenticated
using (auth.uid() = sender_user_id);

grant select, insert, delete on public.direct_messages to authenticated;

-- 10) Permanent friendships (materialized friend list)
create table if not exists public.user_friendships (
  user_id uuid not null references auth.users(id) on delete cascade,
  friend_user_id uuid not null references auth.users(id) on delete cascade,
  user_username text not null,
  friend_username text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, friend_user_id),
  check (user_id <> friend_user_id)
);

create index if not exists idx_user_friendships_user_id on public.user_friendships(user_id, created_at desc);
create index if not exists idx_user_friendships_friend_id on public.user_friendships(friend_user_id, created_at desc);
create index if not exists idx_user_friendships_user_username on public.user_friendships(lower(user_username));
create index if not exists idx_user_friendships_friend_username on public.user_friendships(lower(friend_username));

alter table public.user_friendships enable row level security;

drop policy if exists "allow own read user_friendships" on public.user_friendships;
drop policy if exists "allow own insert user_friendships" on public.user_friendships;
drop policy if exists "allow own delete user_friendships" on public.user_friendships;

create policy "allow own read user_friendships"
on public.user_friendships
for select
to authenticated
using (
  auth.uid() = user_id
  or auth.uid() = friend_user_id
  or lower(user_username) = lower(coalesce(
    (select p.username from public.user_profiles p where p.user_id = auth.uid()),
    ''
  ))
  or lower(friend_username) = lower(coalesce(
    (select p.username from public.user_profiles p where p.user_id = auth.uid()),
    ''
  ))
);

create policy "allow own insert user_friendships"
on public.user_friendships
for insert
to authenticated
with check (
  auth.uid() = user_id
  or lower(user_username) = lower(coalesce(
    (select p.username from public.user_profiles p where p.user_id = auth.uid()),
    ''
  ))
);

create policy "allow own delete user_friendships"
on public.user_friendships
for delete
to authenticated
using (
  auth.uid() = user_id
  or auth.uid() = friend_user_id
);

grant select, insert, delete on public.user_friendships to authenticated;

-- Sync friendships whenever friend request becomes accepted.
create or replace function public.sync_friendships_from_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  sender_id uuid;
  receiver_id uuid;
begin
  if new.status <> 'accepted' then
    return new;
  end if;

  sender_id := new.sender_user_id;
  receiver_id := new.receiver_user_id;

  if sender_id is null and coalesce(new.sender_username, '') <> '' then
    select p.user_id
    into sender_id
    from public.user_profiles p
    where lower(p.username) = lower(new.sender_username)
    limit 1;
  end if;

  if receiver_id is null and coalesce(new.receiver_username, '') <> '' then
    select p.user_id
    into receiver_id
    from public.user_profiles p
    where lower(p.username) = lower(new.receiver_username)
    limit 1;
  end if;

  if sender_id is null or receiver_id is null then
    return new;
  end if;

  insert into public.user_friendships (user_id, friend_user_id, user_username, friend_username)
  values (sender_id, receiver_id, lower(new.sender_username), lower(new.receiver_username))
  on conflict (user_id, friend_user_id) do update
  set
    user_username = excluded.user_username,
    friend_username = excluded.friend_username;

  insert into public.user_friendships (user_id, friend_user_id, user_username, friend_username)
  values (receiver_id, sender_id, lower(new.receiver_username), lower(new.sender_username))
  on conflict (user_id, friend_user_id) do update
  set
    user_username = excluded.user_username,
    friend_username = excluded.friend_username;

  return new;
end;
$$;

drop trigger if exists trg_sync_friendships_from_request on public.friend_requests;
create trigger trg_sync_friendships_from_request
after insert or update on public.friend_requests
for each row execute function public.sync_friendships_from_request();

-- Backfill existing accepted requests.
insert into public.user_friendships (user_id, friend_user_id, user_username, friend_username)
select
  fr.sender_user_id,
  fr.receiver_user_id,
  lower(fr.sender_username),
  lower(fr.receiver_username)
from public.friend_requests fr
where fr.status = 'accepted'
  and fr.sender_user_id is not null
  and fr.receiver_user_id is not null
on conflict (user_id, friend_user_id) do nothing;

-- Backfill request rows that still miss user_id references.
update public.friend_requests fr
set
  sender_user_id = coalesce(fr.sender_user_id, p_sender.user_id),
  receiver_user_id = coalesce(fr.receiver_user_id, p_receiver.user_id)
from public.user_profiles p_sender
join public.user_profiles p_receiver on true
where lower(p_sender.username) = lower(fr.sender_username)
  and lower(p_receiver.username) = lower(fr.receiver_username)
  and (fr.sender_user_id is null or fr.receiver_user_id is null);

insert into public.user_friendships (user_id, friend_user_id, user_username, friend_username)
select
  fr.receiver_user_id,
  fr.sender_user_id,
  lower(fr.receiver_username),
  lower(fr.sender_username)
from public.friend_requests fr
where fr.status = 'accepted'
  and fr.sender_user_id is not null
  and fr.receiver_user_id is not null
on conflict (user_id, friend_user_id) do nothing;

-- Backfill tambahan untuk request lama yang user_id belum terisi (resolve lewat username)
insert into public.user_friendships (user_id, friend_user_id, user_username, friend_username)
select
  p_sender.user_id,
  p_receiver.user_id,
  lower(fr.sender_username),
  lower(fr.receiver_username)
from public.friend_requests fr
join public.user_profiles p_sender on lower(p_sender.username) = lower(fr.sender_username)
join public.user_profiles p_receiver on lower(p_receiver.username) = lower(fr.receiver_username)
where fr.status = 'accepted'
  and lower(fr.sender_username) <> lower(fr.receiver_username)
on conflict (user_id, friend_user_id) do nothing;

insert into public.user_friendships (user_id, friend_user_id, user_username, friend_username)
select
  p_receiver.user_id,
  p_sender.user_id,
  lower(fr.receiver_username),
  lower(fr.sender_username)
from public.friend_requests fr
join public.user_profiles p_sender on lower(p_sender.username) = lower(fr.sender_username)
join public.user_profiles p_receiver on lower(p_receiver.username) = lower(fr.receiver_username)
where fr.status = 'accepted'
  and lower(fr.sender_username) <> lower(fr.receiver_username)
on conflict (user_id, friend_user_id) do nothing;
