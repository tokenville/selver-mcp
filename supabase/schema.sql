-- Selver Assistant — Supabase schema
-- Run this in your Supabase SQL editor to set up the database.

create table if not exists pantry_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  quantity numeric,
  unit text,
  category text,
  image text,
  created_at timestamptz default now()
);

create table if not exists config (
  key text primary key,
  data jsonb not null,
  updated_at timestamptz default now()
);

-- Enable Row Level Security (optional — disable if single-user)
-- alter table pantry_items enable row level security;
-- alter table config enable row level security;
