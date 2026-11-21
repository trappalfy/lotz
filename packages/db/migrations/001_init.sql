-- Lotz indexer schema. Token amounts are numeric(20,0) (u64 base units). Times are timestamptz.

-- One row: the on-chain config as last read, plus deployment facts the site shows.
create table chain_config (
  id               int primary key default 1 check (id = 1),
  program_id       text not null,
  admin            text not null,
  token_mint       text not null,
  token_program    text not null,
  token_decimals   int not null,
  treasury         text not null,
  base_price       numeric(20,0) not null,
  tier_size        int not null,
  tier_mult_bps    int not null,
  takeover_mult_bps int not null,
  max_rect         int not null,
  lock_period      bigint not null,
  epoch_len        bigint not null,
  launch_ts        bigint not null,
  lots_sold        int not null,
  takeovers        bigint not null,
  total_locked     numeric(20,0) not null,
  total_released   numeric(20,0) not null,
  next_ad_id       bigint not null,
  paused           boolean not null,
  upgrade_authority text,            -- null = immutable
  lock_vault       text not null,
  refund_vault     text not null,
  updated_at       timestamptz not null default now()
);

create table ads (
  ad_id         bigint primary key,
  address       text not null unique,
  owner         text not null,
  nonce         numeric(20,0) not null,
  x             smallint not null,
  y             smallint not null,
  w             smallint not null,
  h             smallint not null,
  image_hash    text not null,          -- hex sha256
  image_uri     text not null,
  link          text not null,
  link_domain   text,                   -- null if not a valid https URL
  title         text not null,
  paid_total    numeric(20,0) not null,
  lots_alive    int not null,
  refund_due    numeric(20,0) not null default 0,
  closed        boolean not null default false,
  created_at    timestamptz not null,
  created_slot  bigint,
  signature     text,
  -- moderation (site only; the ad stays on-chain)
  hidden        boolean not null default false,
  hidden_reason text,                   -- 'admin' | 'blocked_domain' | 'hash_mismatch' | 'bad_image'
  hidden_by     text,
  hidden_at     timestamptz,
  -- our copy of the image: verified against image_hash, normalized to w*40 x h*40
  image_status  text not null default 'pending', -- 'pending' | 'ok' | 'mismatch' | 'error'
  image_key     text,
  image_error   text
);
create index ads_owner on ads (owner);
create index ads_created on ads (created_at desc);
create index ads_domain on ads (link_domain);

-- 10,000 rows, one per lot (lot = ly*100 + lx). Mirrors the shards.
create table lots (
  lot          int primary key check (lot >= 0 and lot < 10000),
  ad_id        bigint not null default 0,
  last_price   numeric(20,0) not null default 0,
  takeovers    int not null default 0,
  first_price  numeric(20,0),
  first_sold_at timestamptz
);
insert into lots (lot) select g from generate_series(0, 9999) g;
create index lots_ad on lots (ad_id);
create index lots_takeovers on lots (takeovers desc);

-- Every decoded event, in chain order. The activity feed and lot histories come from here.
create table events (
  id           bigserial primary key,
  signature    text not null,
  event_index  int not null,
  slot         bigint not null,
  block_time   timestamptz not null,
  name         text not null,
  ad_id        bigint,
  actor        text,
  x smallint, y smallint, w smallint, h smallint,
  data         jsonb not null,
  unique (signature, event_index)
);
create index events_name_time on events (name, block_time desc);
create index events_ad on events (ad_id);

create table lock_epochs (
  epoch        int primary key,
  address      text not null,
  amount       numeric(20,0) not null,
  unlock_at    timestamptz not null,
  released     boolean not null default false,
  released_at  timestamptz,
  release_signature text
);

create table blocked_domains (
  domain     text primary key,
  note       text,
  added_by   text,
  added_at   timestamptz not null default now()
);

-- Uploaded images (before they are on-chain).
create table uploads (
  hash        text primary key,
  key         text not null,
  width       int not null,
  height      int not null,
  bytes       int not null,
  created_at  timestamptz not null default now()
);

-- Indexer cursor and small facts (board version, tile versions, last OG render).
create table kv (
  key    text primary key,
  value  jsonb not null,
  updated_at timestamptz not null default now()
);

-- Admin moderation log.
create table moderation_log (
  id        bigserial primary key,
  at        timestamptz not null default now(),
  admin     text not null,
  action    text not null,
  target    text not null,
  note      text
);
