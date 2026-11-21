-- Fixed-window request counters shared by every server instance (serverless hosts run many).
create table if not exists rate_limits (
  key          text not null,
  window_start timestamptz not null,
  hits         integer not null default 0,
  primary key (key, window_start)
);
