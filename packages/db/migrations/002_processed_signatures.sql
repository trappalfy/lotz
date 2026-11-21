-- Every program transaction the indexer has looked at (including failed ones and ones without events),
-- so polling can tell new signatures from old without relying on `getSignaturesForAddress(until)`.
create table processed_signatures (
  signature text primary key,
  at timestamptz not null default now()
);
insert into processed_signatures (signature) select distinct signature from events on conflict do nothing;
