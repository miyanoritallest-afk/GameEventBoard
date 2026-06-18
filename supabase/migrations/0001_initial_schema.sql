-- GameEventBoard 初期スキーマ
-- 対応: docs/DB設計書.md / docs/ER図.md
-- DBMS: PostgreSQL (Supabase)
-- 注意: Supabase Auth の auth.users と users.id を 1:1 で対応させる。

-- =========================================================
-- 0. 拡張
-- =========================================================
create extension if not exists "pgcrypto";       -- gen_random_uuid()
create extension if not exists "pg_trgm";         -- 将来の全文/部分一致検索用

-- =========================================================
-- 1. ENUM 型
-- =========================================================
create type role            as enum ('tank', 'dps', 'support');
create type member_position as enum ('regular', 'reserve');
create type reg_status      as enum ('pending', 'approved', 'rejected', 'withdrawn');
create type event_status    as enum ('draft', 'published', 'recruiting', 'closed', 'ongoing', 'finished');
create type match_phase     as enum ('group', 'tournament');
create type peak_tier       as enum ('none', 'master', 'gm', 'champion');
create type follow_target   as enum ('series', 'event', 'user');
create type entry_type      as enum ('individual', 'team', 'mixed');
create type team_formation  as enum ('self', 'organizer', 'none');
create type team_status      as enum ('pending', 'approved', 'rejected');
create type field_type      as enum ('text', 'textarea', 'select', 'url', 'number');
create type series_role     as enum ('owner', 'admin');
create type member_state    as enum ('invited', 'active');

-- =========================================================
-- 2. ユーザー & ランク
-- =========================================================

-- 2.1 users（プロフィール。id = auth.users.id）
create table users (
  id                 uuid primary key references auth.users(id) on delete cascade,
  discord_id         text unique not null,
  discord_name       text not null,
  discord_avatar_url text,
  battle_tag         text not null,
  is_admin           boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- 2.4 games（ゲームタイトル・マスタ）※ ranks より先に必要
create table games (
  id         uuid primary key default gen_random_uuid(),
  name       text unique not null,
  roles      role[] not null,
  team_size  int not null,
  created_at timestamptz not null default now()
);

-- 2.5 rank_definitions（ランク↔スコア対応表・マスタ）
create table rank_definitions (
  id         uuid primary key default gen_random_uuid(),
  game_id    uuid not null references games(id) on delete cascade,
  tier       text not null,
  division   int,
  label      text not null,
  score      numeric not null,
  sort_order int not null,
  unique (game_id, label)
);

-- 2.2 user_season_ranks（シーズン×ロールのランク履歴）
create table user_season_ranks (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references users(id) on delete cascade,
  game_id            uuid not null references games(id) on delete cascade,
  season_label       text not null,
  season_order       int not null,
  role               role not null,
  rank_definition_id uuid not null references rank_definitions(id),
  created_at         timestamptz not null default now(),
  unique (user_id, game_id, season_label, role)
);

-- 2.3 user_peak_achievement（高ランク到達経験・人単位）
create table user_peak_achievement (
  user_id    uuid not null references users(id) on delete cascade,
  game_id    uuid not null references games(id) on delete cascade,
  peak_tier  peak_tier not null default 'none',
  updated_at timestamptz not null default now(),
  primary key (user_id, game_id)
);

-- =========================================================
-- 3. タグ & シリーズ
-- =========================================================

-- 3.6 tags（タグ・マスタ）
create table tags (
  id         uuid primary key default gen_random_uuid(),
  name       text unique not null,
  category   text,
  created_at timestamptz not null default now()
);

-- 3.6.1 event_series（シリーズ＝継続する企画）
create table event_series (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  logo_url    text,
  created_by  uuid not null references users(id),
  created_at  timestamptz not null default now()
);

-- 3.6.2 series_members（シリーズの共同運営）
create table series_members (
  id         uuid primary key default gen_random_uuid(),
  series_id  uuid not null references event_series(id) on delete cascade,
  user_id    uuid not null references users(id) on delete cascade,
  role       series_role not null default 'admin',
  status     member_state not null default 'invited',
  invited_by uuid references users(id),
  invited_at timestamptz not null default now(),
  joined_at  timestamptz,
  unique (series_id, user_id)
);

-- 3.6.3 series_invites（招待リンク・将来用）
create table series_invites (
  id         uuid primary key default gen_random_uuid(),
  series_id  uuid not null references event_series(id) on delete cascade,
  token      text unique not null,
  role       series_role not null default 'admin',
  expires_at timestamptz,
  max_uses   int,
  used_count int not null default 0,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

-- =========================================================
-- 4. イベント & 応募
-- =========================================================

-- 3.7 events（イベント本体＝開催回）
create table events (
  id                    uuid primary key default gen_random_uuid(),
  series_id             uuid references event_series(id) on delete set null,
  game_id               uuid not null references games(id),
  organizer_id          uuid not null references users(id),
  title                 text not null,
  description           text,
  slug                  text unique,
  status                event_status not null default 'draft',
  capacity              int,                       -- 定員＝チーム数
  current_count         int not null default 0,    -- 成立チーム数（排他制御対象）
  starts_at             timestamptz,
  recruit_deadline      timestamptz,
  -- 応募フロー設定
  entry_type            entry_type not null default 'individual',
  team_formation        team_formation not null default 'organizer',
  allow_matching_choice boolean not null default false,
  -- 募集フォーム設定（構造化項目トグル）
  require_score         boolean not null default true,
  require_role          boolean not null default true,
  require_battle_tag    boolean not null default true,
  -- スコアリング設定
  role_swap_allowed     boolean not null default true,
  declared_seasons      int not null default 3,
  bonus_master          numeric not null default 0,
  bonus_gm              numeric not null default 0,
  bonus_champion        numeric not null default 0,
  -- チーム構成・上限設定
  reserve_slots         int not null default 0,    -- リザーブ上限
  team_score_cap        numeric,                   -- 出場メンバーの final_score 平均の上限
  -- 排他制御
  version               int not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint events_count_nonneg check (current_count >= 0),
  constraint events_count_cap    check (capacity is null or current_count <= capacity)
);
create index idx_events_series on events(series_id);
create index idx_events_status on events(status);

-- 3.8 event_tags（イベント↔タグ 多対多）
create table event_tags (
  event_id uuid not null references events(id) on delete cascade,
  tag_id   uuid not null references tags(id) on delete cascade,
  primary key (event_id, tag_id)
);

-- 3.8.1 event_form_fields（募集フォームのカスタム質問）
create table event_form_fields (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references events(id) on delete cascade,
  label       text not null,
  field_type  field_type not null,
  options     jsonb,
  is_required boolean not null default false,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

-- 3.9 registrations（参加応募）
create table registrations (
  id                       uuid primary key default gen_random_uuid(),
  event_id                 uuid not null references events(id) on delete cascade,
  user_id                  uuid not null references users(id) on delete cascade,
  preferred_role           role,
  assigned_role            role,
  wants_matching           boolean,
  status                   reg_status not null default 'pending',
  -- スコアのスナップショット
  individual_score         numeric,   -- ①基礎
  final_score              numeric,   -- ②=①+到達ボーナス（チームスコア計算に使う）
  score_breakdown          jsonb,
  organizer_override_score numeric,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (event_id, user_id)
);
create index idx_registrations_event on registrations(event_id);

-- 3.9.1 registration_answers（カスタム質問への回答）
create table registration_answers (
  id              uuid primary key default gen_random_uuid(),
  registration_id uuid not null references registrations(id) on delete cascade,
  field_id        uuid not null references event_form_fields(id) on delete cascade,
  value           text,
  unique (registration_id, field_id)
);

-- =========================================================
-- 5. チーム & 予選グループ
-- =========================================================

-- 3.10 teams（チーム）
create table teams (
  id                      uuid primary key default gen_random_uuid(),
  event_id                uuid not null references events(id) on delete cascade,
  name                    text not null,
  status                  team_status not null default 'approved',
  captain_registration_id uuid references registrations(id) on delete set null,
  version                 int not null default 0,
  created_at              timestamptz not null default now(),
  unique (event_id, name)
);

-- 3.11 team_members（チーム所属）
create table team_members (
  id                uuid primary key default gen_random_uuid(),
  team_id           uuid not null references teams(id) on delete cascade,
  registration_id   uuid not null references registrations(id) on delete cascade,
  role              role not null,
  position          member_position not null default 'regular',
  is_representative  boolean not null default false,
  created_at        timestamptz not null default now(),
  unique (registration_id)   -- 1応募は1チームのみ
);
create index idx_team_members_team on team_members(team_id);

-- 3.12 groups（予選グループ）
create table groups (
  id       uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  name     text not null,
  unique (event_id, name)
);

-- 3.13 group_teams（グループ↔チーム）
create table group_teams (
  group_id uuid not null references groups(id) on delete cascade,
  team_id  uuid not null references teams(id) on delete cascade,
  primary key (group_id, team_id)
);

-- =========================================================
-- 6. 試合 & 結果 & 順位
-- =========================================================

-- 3.14 matches（試合）
create table matches (
  id               uuid primary key default gen_random_uuid(),
  event_id         uuid not null references events(id) on delete cascade,
  phase            match_phase not null,
  group_id         uuid references groups(id) on delete set null,
  round            int,
  bracket_position int,
  team_a_id        uuid references teams(id) on delete set null,
  team_b_id        uuid references teams(id) on delete set null,
  scheduled_at     timestamptz,
  replay_code      text,
  stream_url       text,
  streamer_name    text,
  notified_at      timestamptz,
  created_at       timestamptz not null default now()
);
create index idx_matches_event on matches(event_id);

-- 3.15 match_results（試合結果）
create table match_results (
  match_id       uuid primary key references matches(id) on delete cascade,
  team_a_score   int not null,
  team_b_score   int not null,
  winner_team_id uuid references teams(id) on delete set null,
  reported_by    uuid references users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- 3.15.1 match_lineups（試合ごとの出場メンバー・Phase2任意）
create table match_lineups (
  id             uuid primary key default gen_random_uuid(),
  match_id       uuid not null references matches(id) on delete cascade,
  team_id        uuid not null references teams(id) on delete cascade,
  team_member_id uuid not null references team_members(id) on delete cascade,
  created_at     timestamptz not null default now(),
  unique (match_id, team_member_id)
);

-- 3.16 standings（順位表）
create table standings (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references events(id) on delete cascade,
  group_id   uuid references groups(id) on delete cascade,
  team_id    uuid not null references teams(id) on delete cascade,
  wins       int default 0,
  losses     int default 0,
  draws      int default 0,
  points     int default 0,
  rank       int,
  updated_at timestamptz not null default now(),
  unique (event_id, group_id, team_id)
);

-- =========================================================
-- 7. SNS（フォロー & 通知）
-- =========================================================

-- 3.17 follows（フォロー）
-- target_id はポリモーフィック参照（series/event/user）。FK制約はアプリ層で担保。
create table follows (
  id          uuid primary key default gen_random_uuid(),
  follower_id uuid not null references users(id) on delete cascade,
  target_type follow_target not null,
  target_id   uuid not null,
  created_at  timestamptz not null default now(),
  unique (follower_id, target_type, target_id)
);

-- 3.18 notification_events（通知の発生源＝出来事）
create table notification_events (
  id          uuid primary key default gen_random_uuid(),
  type        text not null,
  source_type follow_target not null,
  source_id   uuid not null,
  payload     jsonb,
  created_at  timestamptz not null default now()
);

-- 3.19 notifications（各ユーザーへの実配信）
create table notifications (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id) on delete cascade,
  source_event_id uuid not null references notification_events(id) on delete cascade,
  title           text not null,
  body            text,
  link_url        text,
  is_read         boolean not null default false,
  created_at      timestamptz not null default now(),
  unique (user_id, source_event_id)   -- 同一出来事から同一ユーザーへの二重通知を防ぐ
);
create index idx_notifications_user on notifications(user_id);

-- =========================================================
-- 8. RLS（Row Level Security）有効化
-- ポリシーの本体は 0002 以降で定義する。まずは全テーブルで RLS を ON にし、
-- デフォルト拒否（ポリシー未定義＝アクセス不可）の安全側に倒す。
-- =========================================================
alter table users                 enable row level security;
alter table games                 enable row level security;
alter table rank_definitions       enable row level security;
alter table user_season_ranks      enable row level security;
alter table user_peak_achievement  enable row level security;
alter table tags                  enable row level security;
alter table event_series          enable row level security;
alter table series_members        enable row level security;
alter table series_invites        enable row level security;
alter table events                enable row level security;
alter table event_tags            enable row level security;
alter table event_form_fields     enable row level security;
alter table registrations         enable row level security;
alter table registration_answers  enable row level security;
alter table teams                 enable row level security;
alter table team_members          enable row level security;
alter table groups                enable row level security;
alter table group_teams           enable row level security;
alter table matches               enable row level security;
alter table match_results         enable row level security;
alter table match_lineups         enable row level security;
alter table standings             enable row level security;
alter table follows               enable row level security;
alter table notification_events   enable row level security;
alter table notifications         enable row level security;
