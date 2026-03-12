-- Create table for shared instructions.
-- Run in Supabase SQL editor (or via migrations).

create table if not exists public.instructions (
  id text primary key,
  title text not null,
  region text not null,
  program text not null,
  due_date text not null,
  is_expired_override boolean not null default false,
  content_html text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists instructions_updated_at_idx on public.instructions (updated_at desc);

