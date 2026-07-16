-- ============================================================
-- 【本番デモ用】「Matchpoint Open Vol.1」完全データの再現 seed
-- ============================================================
-- ポートフォリオの本番環境で、観戦ビューから「完成した大会」を見せるためのデモ大会。
-- 予選総当たり→順位→決勝トーナメント→表彰台まで結果入力済みの状態を丸ごと再現する。
-- 全 id は生成元 DB の値をそのまま採用（FK 関係を保つ）。
--
-- 前提: マイグレーション 0001〜0037 適用済み・games に OVERWATCH が seed 済み。
--       主催者（あなた自身）が本番 auth.users に存在すること（＝本番で一度ログインしておく）。
--       下の v_org_id を、本番のあなたの user_id（public.users で確認）に書き換えてから実行する。
-- 冪等: 先頭で既存のデモイベントとデモユーザーを削除してから作り直す。
-- 使い方: Supabase SQL Editor に貼って実行。
-- ============================================================

-- 冪等クリーンアップ
delete from public.events where slug = 'event-mpvbcd';
delete from auth.users where email like 'demoseed_%@matchpoint.demo';

-- 1. 応募者 70 名の auth.users（handle_new_user トリガーが public.users を同 id で作る）
insert into auth.users (
  id, instance_id, aud, role, email,
  encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('93be5acd-fcd6-41f9-ab5a-f5bc1f855c3c', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demoseed_0@matchpoint.demo', '', now(),
   '{"provider":"dummy","providers":["dummy"]}'::jsonb,
   jsonb_build_object('full_name', 'FlickMaster', 'provider_id', 'demoseed_0'),
   now(), now()),
  ('a3cf3a26-fcab-4b97-b44d-4641d1d9468e', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demoseed_1@matchpoint.demo', '', now(),
   '{"provider":"dummy","providers":["dummy"]}'::jsonb,
   jsonb_build_object('full_name', 'Sana', 'provider_id', 'demoseed_1'),
   now(), now()),
  ('255729b5-8fd6-4e8e-a84a-52ba39017c82', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demoseed_2@matchpoint.demo', '', now(),
   '{"provider":"dummy","providers":["dummy"]}'::jsonb,
   jsonb_build_object('full_name', 'Frost', 'provider_id', 'demoseed_2'),
   now(), now()),
  ('5b75ba8c-2316-4f57-a34a-67c3718acd09', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demoseed_3@matchpoint.demo', '', now(),
   '{"provider":"dummy","providers":["dummy"]}'::jsonb,
   jsonb_build_object('full_name', 'Kazuki', 'provider_id', 'demoseed_3'),
   now(), now()),
  ('7cf6c483-31e3-4621-beeb-326a1d76cba3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demoseed_4@matchpoint.demo', '', now(),
   '{"provider":"dummy","providers":["dummy"]}'::jsonb,
   jsonb_build_object('full_name', 'Nova', 'provider_id', 'demoseed_4'),
   now(), now()),
  ('40e7e19e-011f-4d30-95d5-6aa43b741b08', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demoseed_5@matchpoint.demo', '', now(),
   '{"provider":"dummy","providers":["dummy"]}'::jsonb,
   jsonb_build_object('full_name', 'Echo', 'provider_id', 'demoseed_5'),
   now(), now()),
  ('b863f1af-32e8-494d-9852-dd9c696958cd', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demoseed_6@matchpoint.demo', '', now(),
   '{"provider":"dummy","providers":["dummy"]}'::jsonb,
   jsonb_build_object('full_name', 'Onyx', 'provider_id', 'demoseed_6'),
   now(), now()),
  ('f32c042f-2db6-463f-acc2-7d5e53f11579', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demoseed_7@matchpoint.demo', '', now(),
   '{"provider":"dummy","providers":["dummy"]}'::jsonb,
   jsonb_build_object('full_name', 'Yuki', 'provider_id', 'demoseed_7'),
   now(), now()),
  ('fe73b519-6941-4318-a841-2be5c8ece050', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demoseed_8@matchpoint.demo', '', now(),
   '{"provider":"dummy","providers":["dummy"]}'::jsonb,
   jsonb_build_object('full_name', 'Nao', 'provider_id', 'demoseed_8'),
   now(), now()),
  ('8bfc99c8-5153-4e60-8e86-28d171635840', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demoseed_9@matchpoint.demo', '', now(),
   '{"provider":"dummy","providers":["dummy"]}'::jsonb,
   jsonb_build_object('full_name', 'かえで', 'provider_id', 'demoseed_9'),
   now(), now()),
  ('6558e54e-e9c6-4da0-9bc9-ceeac15a97b0', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demoseed_10@matchpoint.demo', '', now(),
   '{"provider":"dummy","providers":["dummy"]}'::jsonb,
   jsonb_build_object('full_name', 'Kaito', 'provider_id', 'demoseed_10'),
   now(), now()),
  ('b521dc64-1a14-4b7c-bb4d-225274e5662f', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demoseed_11@matchpoint.demo', '', now(),
   '{"provider":"dummy","providers":["dummy"]}'::jsonb,
   jsonb_build_object('full_name', 'Sora', 'provider_id', 'demoseed_11'),
   now(), now()),
  ('a50cb551-3c34-4088-8bb7-067a59ac5ad4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demoseed_12@matchpoint.demo', '', now(),
   '{"provider":"dummy","providers":["dummy"]}'::jsonb,
   jsonb_build_object('full_name', 'Tsubasa', 'provider_id', 'demoseed_12'),
   now(), now()),
  ('e4bb479e-d751-4c4e-9a47-543f88b0b950', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demoseed_13@matchpoint.demo', '', now(),
   '{"provider":"dummy","providers":["dummy"]}'::jsonb,
   jsonb_build_object('full_name', 'Cipher', 'provider_id', 'demoseed_13'),
   now(), now()),
  ('32b8863d-3a2c-464f-b0d3-d442d70922f3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demoseed_14@matchpoint.demo', '', now(),
   '{"provider":"dummy","providers":["dummy"]}'::jsonb,
   jsonb_build_object('full_name', 'Diamond_Dust', 'provider_id', 'demoseed_14'),
   now(), now()),
  ('234fb8d6-5f53-444c-8b39-f7711a9ef4a8', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demoseed_15@matchpoint.demo', '', now(),
   '{"provider":"dummy","providers":["dummy"]}'::jsonb,
   jsonb_build_object('full_name', 'Aki', 'provider_id', 'demoseed_15'),
   now(), now()),
  ('5c79fadb-9f5f-45e1-a6e0-20b279ac2d76', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demoseed_16@matchpoint.demo', '', now(),
   '{"provider":"dummy","providers":["dummy"]}'::jsonb,
   jsonb_build_object('full_name', 'xX_Sniper_Xx', 'provider_id', 'demoseed_16'),
   now(), now()),
  ('241f2ea4-a782-410d-a92f-d69074b6d211', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demoseed_17@matchpoint.demo', '', now(),
   '{"provider":"dummy","providers":["dummy"]}'::jsonb,
   jsonb_build_object('full_name', 'Rei', 'provider_id', 'demoseed_17'),
   now(), now()),
  ('a6548218-ef6a-4d67-8f2f-f4f6ce928c82', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demoseed_18@matchpoint.demo', '', now(),
   '{"provider":"dummy","providers":["dummy"]}'::jsonb,
   jsonb_build_object('full_name', 'Vortex', 'provider_id', 'demoseed_18'),
   now(), now()),
  ('84fd7b89-c0b4-4f25-816c-36c5a9aa5341', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demoseed_19@matchpoint.demo', '', now(),
   '{"provider":"dummy","providers":["dummy"]}'::jsonb,
   jsonb_build_object('full_name', 'Riku', 'provider_id', 'demoseed_19'),
   now(), now()),
  ('7c157096-8bd8-4c77-8ca2-8ea752c7a380', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demoseed_20@matchpoint.demo', '', now(),
   '{"provider":"dummy","providers":["dummy"]}'::jsonb,
   jsonb_build_object('full_name', 'つばき', 'provider_id', 'demoseed_20'),
   now(), now()),
  ('51ab11cb-d724-4d0f-9507-7639cc53ae46', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demoseed_21@matchpoint.demo', '', now(),
   '{"provider":"dummy","providers":["dummy"]}'::jsonb,
   jsonb_build_object('full_name', 'VoidWalker', 'provider_id', 'demoseed_21'),
   now(), now()),
  ('5be0fec2-d5e5-42e7-b3fd-e250f3107dda', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demoseed_22@matchpoint.demo', '', now(),
   '{"provider":"dummy","providers":["dummy"]}'::jsonb,
   jsonb_build_object('full_name', 'ShadowFox', 'provider_id', 'demoseed_22'),
   now(), now()),
  ('1c210e60-2105-4a6d-b442-5cd4cc8e83f4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demoseed_23@matchpoint.demo', '', now(),
   '{"provider":"dummy","providers":["dummy"]}'::jsonb,
   jsonb_build_object('full_name', 'Ghost_JP', 'provider_id', 'demoseed_23'),
   now(), now()),
  ('a6515b54-5f93-4cae-82ce-80e3c9748118', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demoseed_24@matchpoint.demo', '', now(),
   '{"provider":"dummy","providers":["dummy"]}'::jsonb,
   jsonb_build_object('full_name', 'Blaze', 'provider_id', 'demoseed_24'),
   now(), now()),
  ('7328858b-a956-46b5-9a4b-004cab29cbc8', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demoseed_25@matchpoint.demo', '', now(),
   '{"provider":"dummy","providers":["dummy"]}'::jsonb,
   jsonb_build_object('full_name', 'れん', 'provider_id', 'demoseed_25'),
   now(), now()),
  ('a95fbf1a-e01e-4393-8a36-89373e69567d', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demoseed_26@matchpoint.demo', '', now(),
   '{"provider":"dummy","providers":["dummy"]}'::jsonb,
   jsonb_build_object('full_name', 'TankLord', 'provider_id', 'demoseed_26'),
   now(), now()),
  ('7932df2a-76fe-453c-b04b-e326458f2692', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demoseed_27@matchpoint.demo', '', now(),
   '{"provider":"dummy","providers":["dummy"]}'::jsonb,
   jsonb_build_object('full_name', 'はやて', 'provider_id', 'demoseed_27'),
   now(), now()),
  ('9b1b0653-ebb7-4292-9647-2a32ef439362', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demoseed_28@matchpoint.demo', '', now(),
   '{"provider":"dummy","providers":["dummy"]}'::jsonb,
   jsonb_build_object('full_name', 'Kenji', 'provider_id', 'demoseed_28'),
   now(), now()),
  ('4a9e26be-da89-4a85-9d29-dd1fe08e1458', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demoseed_29@matchpoint.demo', '', now(),
   '{"provider":"dummy","providers":["dummy"]}'::jsonb,
   jsonb_build_object('full_name', 'Emi', 'provider_id', 'demoseed_29'),
   now(), now()),
  ('c1d60351-904a-4417-bad7-28764e754582', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demoseed_30@matchpoint.demo', '', now(),
   '{"provider":"dummy","providers":["dummy"]}'::jsonb,
   jsonb_build_object('full_name', 'Haruto', 'provider_id', 'demoseed_30'),
   now(), now()),
  ('72ccadc1-e18b-4a50-9899-9ae6da7e215f', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demoseed_31@matchpoint.demo', '', now(),
   '{"provider":"dummy","providers":["dummy"]}'::jsonb,
   jsonb_build_object('full_name', 'Shota', 'provider_id', 'demoseed_31'),
   now(), now()),
  ('9e50387e-017a-414b-945e-1d28f6f50fdf', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demoseed_32@matchpoint.demo', '', now(),
   '{"provider":"dummy","providers":["dummy"]}'::jsonb,
   jsonb_build_object('full_name', 'JadeDragon', 'provider_id', 'demoseed_32'),
   now(), now()),
  ('27adaa67-c251-4531-bc89-34680a5b5c38', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demoseed_33@matchpoint.demo', '', now(),
   '{"provider":"dummy","providers":["dummy"]}'::jsonb,
   jsonb_build_object('full_name', 'Subaru', 'provider_id', 'demoseed_33'),
   now(), now()),
  ('64d2afbc-9d4b-4d26-9602-ba941d900585', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demoseed_34@matchpoint.demo', '', now(),
   '{"provider":"dummy","providers":["dummy"]}'::jsonb,
   jsonb_build_object('full_name', 'みなと', 'provider_id', 'demoseed_34'),
   now(), now()),
  ('6577148a-8da9-492a-9f1b-3d1cf05cb27f', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demoseed_35@matchpoint.demo', '', now(),
   '{"provider":"dummy","providers":["dummy"]}'::jsonb,
   jsonb_build_object('full_name', 'Minato_JP', 'provider_id', 'demoseed_35'),
   now(), now()),
  ('db11dc00-8c99-40a4-9ad2-a24e08bd0bc8', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demoseed_36@matchpoint.demo', '', now(),
   '{"provider":"dummy","providers":["dummy"]}'::jsonb,
   jsonb_build_object('full_name', 'Reaper77', 'provider_id', 'demoseed_36'),
   now(), now()),
  ('c8959d4a-cb5a-4fdf-a008-1d7384c8697f', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demoseed_37@matchpoint.demo', '', now(),
   '{"provider":"dummy","providers":["dummy"]}'::jsonb,
   jsonb_build_object('full_name', 'Aim_God', 'provider_id', 'demoseed_37'),
   now(), now()),
  ('6de90e6b-cfea-4bbc-817b-49610bd371fa', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demoseed_38@matchpoint.demo', '', now(),
   '{"provider":"dummy","providers":["dummy"]}'::jsonb,
   jsonb_build_object('full_name', 'HealBot', 'provider_id', 'demoseed_38'),
   now(), now()),
  ('d5e664cc-513a-4667-9c1b-93e09922eb85', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demoseed_39@matchpoint.demo', '', now(),
   '{"provider":"dummy","providers":["dummy"]}'::jsonb,
   jsonb_build_object('full_name', 'そうた', 'provider_id', 'demoseed_39'),
   now(), now()),
  ('f13ed86c-80c3-43cf-8e39-ce703093714b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demoseed_40@matchpoint.demo', '', now(),
   '{"provider":"dummy","providers":["dummy"]}'::jsonb,
   jsonb_build_object('full_name', 'SilverWolf', 'provider_id', 'demoseed_40'),
   now(), now()),
  ('30a882db-a2a1-4606-b5e9-5f00f3677b6d', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demoseed_41@matchpoint.demo', '', now(),
   '{"provider":"dummy","providers":["dummy"]}'::jsonb,
   jsonb_build_object('full_name', 'Aoi', 'provider_id', 'demoseed_41'),
   now(), now()),
  ('049e134c-4bc9-4601-b7e4-374e0fa45cca', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demoseed_42@matchpoint.demo', '', now(),
   '{"provider":"dummy","providers":["dummy"]}'::jsonb,
   jsonb_build_object('full_name', 'Hinata_OW', 'provider_id', 'demoseed_42'),
   now(), now()),
  ('1ca7a7e6-34b7-4653-b8a4-a73bda8746da', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demoseed_43@matchpoint.demo', '', now(),
   '{"provider":"dummy","providers":["dummy"]}'::jsonb,
   jsonb_build_object('full_name', 'ProGamerJP', 'provider_id', 'demoseed_43'),
   now(), now()),
  ('5dec505a-0609-4340-85f4-a0297e4f5c59', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demoseed_44@matchpoint.demo', '', now(),
   '{"provider":"dummy","providers":["dummy"]}'::jsonb,
   jsonb_build_object('full_name', 'Luna', 'provider_id', 'demoseed_44'),
   now(), now()),
  ('b4c425ef-04ba-4544-a6dd-0245c227688f', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demoseed_45@matchpoint.demo', '', now(),
   '{"provider":"dummy","providers":["dummy"]}'::jsonb,
   jsonb_build_object('full_name', 'Daiki', 'provider_id', 'demoseed_45'),
   now(), now()),
  ('fba13afa-020d-424b-9a88-375eaab26276', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demoseed_46@matchpoint.demo', '', now(),
   '{"provider":"dummy","providers":["dummy"]}'::jsonb,
   jsonb_build_object('full_name', 'しずく', 'provider_id', 'demoseed_46'),
   now(), now()),
  ('f53d95b7-8896-49f3-a6f7-87f1eae27332', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demoseed_47@matchpoint.demo', '', now(),
   '{"provider":"dummy","providers":["dummy"]}'::jsonb,
   jsonb_build_object('full_name', 'ひなた', 'provider_id', 'demoseed_47'),
   now(), now()),
  ('e6c9f565-c2c0-455c-b3a7-8bb925cf4da4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demoseed_48@matchpoint.demo', '', now(),
   '{"provider":"dummy","providers":["dummy"]}'::jsonb,
   jsonb_build_object('full_name', 'GoldenEye', 'provider_id', 'demoseed_48'),
   now(), now()),
  ('75f72d96-4b08-4305-bf03-88649166c60e', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demoseed_49@matchpoint.demo', '', now(),
   '{"provider":"dummy","providers":["dummy"]}'::jsonb,
   jsonb_build_object('full_name', 'HeadshotHiro', 'provider_id', 'demoseed_49'),
   now(), now()),
  ('a3a4d63d-2338-41fc-bf05-4e41fa5a5c63', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demoseed_50@matchpoint.demo', '', now(),
   '{"provider":"dummy","providers":["dummy"]}'::jsonb,
   jsonb_build_object('full_name', 'Sena', 'provider_id', 'demoseed_50'),
   now(), now()),
  ('dd15da2a-f8bb-4f3b-9050-6d3fd45c00f7', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demoseed_51@matchpoint.demo', '', now(),
   '{"provider":"dummy","providers":["dummy"]}'::jsonb,
   jsonb_build_object('full_name', 'Rio', 'provider_id', 'demoseed_51'),
   now(), now()),
  ('18976b3c-0415-4a60-bc84-8e579c175076', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demoseed_52@matchpoint.demo', '', now(),
   '{"provider":"dummy","providers":["dummy"]}'::jsonb,
   jsonb_build_object('full_name', 'SmurfKiller', 'provider_id', 'demoseed_52'),
   now(), now()),
  ('2fdd3bd9-04f1-40fb-93b6-94802f5e3767', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demoseed_53@matchpoint.demo', '', now(),
   '{"provider":"dummy","providers":["dummy"]}'::jsonb,
   jsonb_build_object('full_name', 'CrimsonEdge', 'provider_id', 'demoseed_53'),
   now(), now()),
  ('5801aba8-a1f2-4a42-9215-afe0beadfdfe', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demoseed_54@matchpoint.demo', '', now(),
   '{"provider":"dummy","providers":["dummy"]}'::jsonb,
   jsonb_build_object('full_name', 'Ren', 'provider_id', 'demoseed_54'),
   now(), now()),
  ('336c9594-7c37-42ad-a547-eff2e65cb943', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demoseed_55@matchpoint.demo', '', now(),
   '{"provider":"dummy","providers":["dummy"]}'::jsonb,
   jsonb_build_object('full_name', 'ゆうき', 'provider_id', 'demoseed_55'),
   now(), now()),
  ('d48a6ec5-9c14-4cdc-9693-4e04795f7934', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demoseed_56@matchpoint.demo', '', now(),
   '{"provider":"dummy","providers":["dummy"]}'::jsonb,
   jsonb_build_object('full_name', 'Yuto', 'provider_id', 'demoseed_56'),
   now(), now()),
  ('0704ae38-a038-45d0-a29c-c0562725be36', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demoseed_57@matchpoint.demo', '', now(),
   '{"provider":"dummy","providers":["dummy"]}'::jsonb,
   jsonb_build_object('full_name', 'Ryota', 'provider_id', 'demoseed_57'),
   now(), now()),
  ('8953e988-0713-4e8a-91ac-19b0eee0f9ad', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demoseed_58@matchpoint.demo', '', now(),
   '{"provider":"dummy","providers":["dummy"]}'::jsonb,
   jsonb_build_object('full_name', 'NightRaven', 'provider_id', 'demoseed_58'),
   now(), now()),
  ('0b94b1b8-b746-4602-a882-3a0e2d6d73c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demoseed_59@matchpoint.demo', '', now(),
   '{"provider":"dummy","providers":["dummy"]}'::jsonb,
   jsonb_build_object('full_name', 'Zephyr', 'provider_id', 'demoseed_59'),
   now(), now()),
  ('b61aa3a0-075d-4bfb-b53f-68fc03d59088', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demoseed_60@matchpoint.demo', '', now(),
   '{"provider":"dummy","providers":["dummy"]}'::jsonb,
   jsonb_build_object('full_name', 'Takumi', 'provider_id', 'demoseed_60'),
   now(), now()),
  ('a46d6edb-29f9-45f0-8563-30771e7e45c6', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demoseed_61@matchpoint.demo', '', now(),
   '{"provider":"dummy","providers":["dummy"]}'::jsonb,
   jsonb_build_object('full_name', 'Haru', 'provider_id', 'demoseed_61'),
   now(), now()),
  ('073f6865-f8b3-42a7-94e3-c0637e90306b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demoseed_62@matchpoint.demo', '', now(),
   '{"provider":"dummy","providers":["dummy"]}'::jsonb,
   jsonb_build_object('full_name', 'AzureSky', 'provider_id', 'demoseed_62'),
   now(), now()),
  ('14bf7d31-36ca-433e-9c7d-0de500b441a0', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demoseed_63@matchpoint.demo', '', now(),
   '{"provider":"dummy","providers":["dummy"]}'::jsonb,
   jsonb_build_object('full_name', 'IronWill', 'provider_id', 'demoseed_63'),
   now(), now()),
  ('aa3f667e-3126-4700-af42-ac18cf868d8b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demoseed_64@matchpoint.demo', '', now(),
   '{"provider":"dummy","providers":["dummy"]}'::jsonb,
   jsonb_build_object('full_name', 'OneTrick', 'provider_id', 'demoseed_64'),
   now(), now()),
  ('5ea9c23b-b48c-4870-a4c3-07c8aaaa8f4c', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demoseed_65@matchpoint.demo', '', now(),
   '{"provider":"dummy","providers":["dummy"]}'::jsonb,
   jsonb_build_object('full_name', 'Mei', 'provider_id', 'demoseed_65'),
   now(), now()),
  ('adb42f9c-993c-436c-ad4e-f456ea0741b6', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demoseed_66@matchpoint.demo', '', now(),
   '{"provider":"dummy","providers":["dummy"]}'::jsonb,
   jsonb_build_object('full_name', 'Itsuki', 'provider_id', 'demoseed_66'),
   now(), now()),
  ('6b44582f-33bb-4068-8c4b-7a7a1467be86', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demoseed_67@matchpoint.demo', '', now(),
   '{"provider":"dummy","providers":["dummy"]}'::jsonb,
   jsonb_build_object('full_name', 'ClutchKing', 'provider_id', 'demoseed_67'),
   now(), now()),
  ('4a317b41-afc6-4271-bcb6-0b7a301d5a3e', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demoseed_68@matchpoint.demo', '', now(),
   '{"provider":"dummy","providers":["dummy"]}'::jsonb,
   jsonb_build_object('full_name', 'たける', 'provider_id', 'demoseed_68'),
   now(), now()),
  ('7605e2a4-c0c3-4e89-9fc8-694100009f84', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demoseed_69@matchpoint.demo', '', now(),
   '{"provider":"dummy","providers":["dummy"]}'::jsonb,
   jsonb_build_object('full_name', 'Kira', 'provider_id', 'demoseed_69'),
   now(), now())
on conflict (id) do nothing;

-- 2. public.users の battle_tag / discord_name を実データに揃える
update public.users set battle_tag = 'demo_001#0000', discord_name = 'FlickMaster' where id = '93be5acd-fcd6-41f9-ab5a-f5bc1f855c3c';
update public.users set battle_tag = 'demo_002#0000', discord_name = 'Sana' where id = 'a3cf3a26-fcab-4b97-b44d-4641d1d9468e';
update public.users set battle_tag = 'demo_003#0000', discord_name = 'Frost' where id = '255729b5-8fd6-4e8e-a84a-52ba39017c82';
update public.users set battle_tag = 'demo_004#0000', discord_name = 'Kazuki' where id = '5b75ba8c-2316-4f57-a34a-67c3718acd09';
update public.users set battle_tag = 'demo_005#0000', discord_name = 'Nova' where id = '7cf6c483-31e3-4621-beeb-326a1d76cba3';
update public.users set battle_tag = 'demo_006#0000', discord_name = 'Echo' where id = '40e7e19e-011f-4d30-95d5-6aa43b741b08';
update public.users set battle_tag = 'demo_007#0000', discord_name = 'Onyx' where id = 'b863f1af-32e8-494d-9852-dd9c696958cd';
update public.users set battle_tag = 'demo_008#0000', discord_name = 'Yuki' where id = 'f32c042f-2db6-463f-acc2-7d5e53f11579';
update public.users set battle_tag = 'demo_009#0000', discord_name = 'Nao' where id = 'fe73b519-6941-4318-a841-2be5c8ece050';
update public.users set battle_tag = 'demo_010#0000', discord_name = 'かえで' where id = '8bfc99c8-5153-4e60-8e86-28d171635840';
update public.users set battle_tag = 'demo_011#0000', discord_name = 'Kaito' where id = '6558e54e-e9c6-4da0-9bc9-ceeac15a97b0';
update public.users set battle_tag = 'demo_012#0000', discord_name = 'Sora' where id = 'b521dc64-1a14-4b7c-bb4d-225274e5662f';
update public.users set battle_tag = 'demo_013#0000', discord_name = 'Tsubasa' where id = 'a50cb551-3c34-4088-8bb7-067a59ac5ad4';
update public.users set battle_tag = 'demo_014#0000', discord_name = 'Cipher' where id = 'e4bb479e-d751-4c4e-9a47-543f88b0b950';
update public.users set battle_tag = 'demo_015#0000', discord_name = 'Diamond_Dust' where id = '32b8863d-3a2c-464f-b0d3-d442d70922f3';
update public.users set battle_tag = 'demo_016#0000', discord_name = 'Aki' where id = '234fb8d6-5f53-444c-8b39-f7711a9ef4a8';
update public.users set battle_tag = 'demo_017#0000', discord_name = 'xX_Sniper_Xx' where id = '5c79fadb-9f5f-45e1-a6e0-20b279ac2d76';
update public.users set battle_tag = 'demo_018#0000', discord_name = 'Rei' where id = '241f2ea4-a782-410d-a92f-d69074b6d211';
update public.users set battle_tag = 'demo_019#0000', discord_name = 'Vortex' where id = 'a6548218-ef6a-4d67-8f2f-f4f6ce928c82';
update public.users set battle_tag = 'demo_020#0000', discord_name = 'Riku' where id = '84fd7b89-c0b4-4f25-816c-36c5a9aa5341';
update public.users set battle_tag = 'demo_021#0000', discord_name = 'つばき' where id = '7c157096-8bd8-4c77-8ca2-8ea752c7a380';
update public.users set battle_tag = 'demo_022#0000', discord_name = 'VoidWalker' where id = '51ab11cb-d724-4d0f-9507-7639cc53ae46';
update public.users set battle_tag = 'demo_023#0000', discord_name = 'ShadowFox' where id = '5be0fec2-d5e5-42e7-b3fd-e250f3107dda';
update public.users set battle_tag = 'demo_024#0000', discord_name = 'Ghost_JP' where id = '1c210e60-2105-4a6d-b442-5cd4cc8e83f4';
update public.users set battle_tag = 'demo_025#0000', discord_name = 'Blaze' where id = 'a6515b54-5f93-4cae-82ce-80e3c9748118';
update public.users set battle_tag = 'demo_026#0000', discord_name = 'れん' where id = '7328858b-a956-46b5-9a4b-004cab29cbc8';
update public.users set battle_tag = 'demo_027#0000', discord_name = 'TankLord' where id = 'a95fbf1a-e01e-4393-8a36-89373e69567d';
update public.users set battle_tag = 'demo_028#0000', discord_name = 'はやて' where id = '7932df2a-76fe-453c-b04b-e326458f2692';
update public.users set battle_tag = 'demo_029#0000', discord_name = 'Kenji' where id = '9b1b0653-ebb7-4292-9647-2a32ef439362';
update public.users set battle_tag = 'demo_030#0000', discord_name = 'Emi' where id = '4a9e26be-da89-4a85-9d29-dd1fe08e1458';
update public.users set battle_tag = 'demo_031#0000', discord_name = 'Haruto' where id = 'c1d60351-904a-4417-bad7-28764e754582';
update public.users set battle_tag = 'demo_032#0000', discord_name = 'Shota' where id = '72ccadc1-e18b-4a50-9899-9ae6da7e215f';
update public.users set battle_tag = 'demo_033#0000', discord_name = 'JadeDragon' where id = '9e50387e-017a-414b-945e-1d28f6f50fdf';
update public.users set battle_tag = 'demo_034#0000', discord_name = 'Subaru' where id = '27adaa67-c251-4531-bc89-34680a5b5c38';
update public.users set battle_tag = 'demo_035#0000', discord_name = 'みなと' where id = '64d2afbc-9d4b-4d26-9602-ba941d900585';
update public.users set battle_tag = 'demo_036#0000', discord_name = 'Minato_JP' where id = '6577148a-8da9-492a-9f1b-3d1cf05cb27f';
update public.users set battle_tag = 'demo_037#0000', discord_name = 'Reaper77' where id = 'db11dc00-8c99-40a4-9ad2-a24e08bd0bc8';
update public.users set battle_tag = 'demo_038#0000', discord_name = 'Aim_God' where id = 'c8959d4a-cb5a-4fdf-a008-1d7384c8697f';
update public.users set battle_tag = 'demo_039#0000', discord_name = 'HealBot' where id = '6de90e6b-cfea-4bbc-817b-49610bd371fa';
update public.users set battle_tag = 'demo_040#0000', discord_name = 'そうた' where id = 'd5e664cc-513a-4667-9c1b-93e09922eb85';
update public.users set battle_tag = 'demo_041#0000', discord_name = 'SilverWolf' where id = 'f13ed86c-80c3-43cf-8e39-ce703093714b';
update public.users set battle_tag = 'demo_042#0000', discord_name = 'Aoi' where id = '30a882db-a2a1-4606-b5e9-5f00f3677b6d';
update public.users set battle_tag = 'demo_043#0000', discord_name = 'Hinata_OW' where id = '049e134c-4bc9-4601-b7e4-374e0fa45cca';
update public.users set battle_tag = 'demo_044#0000', discord_name = 'ProGamerJP' where id = '1ca7a7e6-34b7-4653-b8a4-a73bda8746da';
update public.users set battle_tag = 'demo_045#0000', discord_name = 'Luna' where id = '5dec505a-0609-4340-85f4-a0297e4f5c59';
update public.users set battle_tag = 'demo_046#0000', discord_name = 'Daiki' where id = 'b4c425ef-04ba-4544-a6dd-0245c227688f';
update public.users set battle_tag = 'demo_047#0000', discord_name = 'しずく' where id = 'fba13afa-020d-424b-9a88-375eaab26276';
update public.users set battle_tag = 'demo_048#0000', discord_name = 'ひなた' where id = 'f53d95b7-8896-49f3-a6f7-87f1eae27332';
update public.users set battle_tag = 'demo_049#0000', discord_name = 'GoldenEye' where id = 'e6c9f565-c2c0-455c-b3a7-8bb925cf4da4';
update public.users set battle_tag = 'demo_050#0000', discord_name = 'HeadshotHiro' where id = '75f72d96-4b08-4305-bf03-88649166c60e';
update public.users set battle_tag = 'demo_051#0000', discord_name = 'Sena' where id = 'a3a4d63d-2338-41fc-bf05-4e41fa5a5c63';
update public.users set battle_tag = 'demo_052#0000', discord_name = 'Rio' where id = 'dd15da2a-f8bb-4f3b-9050-6d3fd45c00f7';
update public.users set battle_tag = 'demo_053#0000', discord_name = 'SmurfKiller' where id = '18976b3c-0415-4a60-bc84-8e579c175076';
update public.users set battle_tag = 'demo_054#0000', discord_name = 'CrimsonEdge' where id = '2fdd3bd9-04f1-40fb-93b6-94802f5e3767';
update public.users set battle_tag = 'demo_055#0000', discord_name = 'Ren' where id = '5801aba8-a1f2-4a42-9215-afe0beadfdfe';
update public.users set battle_tag = 'demo_056#0000', discord_name = 'ゆうき' where id = '336c9594-7c37-42ad-a547-eff2e65cb943';
update public.users set battle_tag = 'demo_057#0000', discord_name = 'Yuto' where id = 'd48a6ec5-9c14-4cdc-9693-4e04795f7934';
update public.users set battle_tag = 'demo_058#0000', discord_name = 'Ryota' where id = '0704ae38-a038-45d0-a29c-c0562725be36';
update public.users set battle_tag = 'demo_059#0000', discord_name = 'NightRaven' where id = '8953e988-0713-4e8a-91ac-19b0eee0f9ad';
update public.users set battle_tag = 'demo_060#0000', discord_name = 'Zephyr' where id = '0b94b1b8-b746-4602-a882-3a0e2d6d73c1';
update public.users set battle_tag = 'demo_061#0000', discord_name = 'Takumi' where id = 'b61aa3a0-075d-4bfb-b53f-68fc03d59088';
update public.users set battle_tag = 'demo_062#0000', discord_name = 'Haru' where id = 'a46d6edb-29f9-45f0-8563-30771e7e45c6';
update public.users set battle_tag = 'demo_063#0000', discord_name = 'AzureSky' where id = '073f6865-f8b3-42a7-94e3-c0637e90306b';
update public.users set battle_tag = 'demo_064#0000', discord_name = 'IronWill' where id = '14bf7d31-36ca-433e-9c7d-0de500b441a0';
update public.users set battle_tag = 'demo_065#0000', discord_name = 'OneTrick' where id = 'aa3f667e-3126-4700-af42-ac18cf868d8b';
update public.users set battle_tag = 'demo_066#0000', discord_name = 'Mei' where id = '5ea9c23b-b48c-4870-a4c3-07c8aaaa8f4c';
update public.users set battle_tag = 'demo_067#0000', discord_name = 'Itsuki' where id = 'adb42f9c-993c-436c-ad4e-f456ea0741b6';
update public.users set battle_tag = 'demo_068#0000', discord_name = 'ClutchKing' where id = '6b44582f-33bb-4068-8c4b-7a7a1467be86';
update public.users set battle_tag = 'demo_069#0000', discord_name = 'たける' where id = '4a317b41-afc6-4271-bcb6-0b7a301d5a3e';
update public.users set battle_tag = 'demo_070#0000', discord_name = 'Kira' where id = '7605e2a4-c0c3-4e89-9fc8-694100009f84';

-- 3. イベント（game_id は OVERWATCH を名前引き・organizer_id は下の :organizer で解決）
do $$
declare
  v_game_id uuid := (select id from public.games where name = 'OVERWATCH' limit 1);
  v_org_id uuid := 'YOUR_ORGANIZER_USER_ID'; -- ★ 実行前に本番のあなたの user_id へ書き換える（public.users で確認）
begin
  if v_game_id is null then
    raise exception 'games に OVERWATCH がありません。先に seed.sql を実行してください。';
  end if;
  if not exists (select 1 from public.users where id = v_org_id) then
    raise exception '主催者 user_id % が存在しません。本番で一度ログインしてから、この id を v_org_id に設定してください。', v_org_id;
  end if;
  insert into public.events (id, series_id, game_id, organizer_id, title, description, slug, status, capacity, current_count, starts_at, recruit_deadline, entry_type, team_formation, allow_matching_choice, require_score, require_role, require_battle_tag, role_swap_allowed, declared_seasons, bonus_master, bonus_gm, bonus_champion, reserve_slots, team_score_cap, discord_webhook_url, auto_announce, ends_at, uncertified_handling, ranking_enabled, points_win, points_draw, points_loss, tiebreakers, group_best_of, tournament_advance_count, tournament_third_place, organizer_display_name, format)
  values (
    'e15d9961-38a7-4288-bf04-5e2c890f08b4', null, v_game_id, v_org_id, 'Matchpoint Open Vol.1', null, 'event-mpvbcd', 'published', 12, 12, '2026-07-29T06:32:00+00:00', '2026-07-22T06:32:00+00:00', 'individual', 'organizer', false, true, true, true, true, 3, 1, 2, 3, 0, 26, null, true, null, 'exclude', true, 3, 1, 0, array['head_to_head','map_diff','potg'], 3, 3, true, 'のり', 'round_robin_then_tournament'
  )
  on conflict (id) do nothing;
end $$;

-- 4. registrations（応募・スコア入り・approved）
insert into public.registrations (id, event_id, user_id, preferred_role, assigned_role, wants_matching, status, individual_score, final_score, score_breakdown, organizer_override_score, preferred_role_1, preferred_role_2, preferred_role_3, display_name) values
  ('e1ac1a87-670b-4489-ae02-c9a6df6c3a19', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '93be5acd-fcd6-41f9-ab5a-f5bc1f855c3c', 'tank', null, null, 'approved', 18, 18, '{"demo":true}'::jsonb, null, 'tank', 'dps', 'support', 'FlickMaster'),
  ('d9194055-4231-4fb1-a311-deddea787e07', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', 'a3cf3a26-fcab-4b97-b44d-4641d1d9468e', 'tank', null, null, 'approved', 23, 23, '{"demo":true}'::jsonb, null, 'tank', 'dps', 'support', 'Sana'),
  ('59ae8af0-bd10-480c-985a-59e693983857', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '255729b5-8fd6-4e8e-a84a-52ba39017c82', 'tank', null, null, 'approved', 25, 25, '{"demo":true}'::jsonb, null, 'tank', 'dps', 'support', 'Frost'),
  ('d32fd8f5-5bfd-40a7-b41f-a4916de600ca', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '5b75ba8c-2316-4f57-a34a-67c3718acd09', 'tank', null, null, 'approved', 25, 25, '{"demo":true}'::jsonb, null, 'tank', 'dps', 'support', 'Kazuki'),
  ('d8d3b374-ffe2-4ef7-bea2-81d3a299bfbb', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '7cf6c483-31e3-4621-beeb-326a1d76cba3', 'tank', null, null, 'approved', 24, 24, '{"demo":true}'::jsonb, null, 'tank', 'dps', 'support', 'Nova'),
  ('3ba9bd6a-0424-4afd-ab45-66d0241269ca', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '40e7e19e-011f-4d30-95d5-6aa43b741b08', 'tank', null, null, 'approved', 17, 17, '{"demo":true}'::jsonb, null, 'tank', 'dps', 'support', 'Echo'),
  ('16220459-7021-4f19-aba9-d9c40edaf6bc', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', 'b863f1af-32e8-494d-9852-dd9c696958cd', 'tank', null, null, 'approved', 22, 22, '{"demo":true}'::jsonb, null, 'tank', 'dps', 'support', 'Onyx'),
  ('e522f120-1d67-4677-8638-91ff2426b844', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', 'f32c042f-2db6-463f-acc2-7d5e53f11579', 'tank', null, null, 'approved', 18, 18, '{"demo":true}'::jsonb, null, 'tank', 'dps', 'support', 'Yuki'),
  ('2d01c829-3c0d-4ad3-8a89-658ba864cd63', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', 'fe73b519-6941-4318-a841-2be5c8ece050', 'tank', null, null, 'approved', 21, 21, '{"demo":true}'::jsonb, null, 'tank', 'dps', 'support', 'Nao'),
  ('e974bc75-0757-4180-9933-11b2a5b2e54f', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '8bfc99c8-5153-4e60-8e86-28d171635840', 'tank', null, null, 'approved', 23, 23, '{"demo":true}'::jsonb, null, 'tank', 'dps', 'support', 'かえで'),
  ('c7b62221-3c7d-4d97-b655-83d759b13af7', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '6558e54e-e9c6-4da0-9bc9-ceeac15a97b0', 'tank', null, null, 'approved', 21, 21, '{"demo":true}'::jsonb, null, 'tank', 'dps', 'support', 'Kaito'),
  ('04e29c2f-14a9-4107-a441-8a9a5b6e7adf', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', 'b521dc64-1a14-4b7c-bb4d-225274e5662f', 'tank', null, null, 'approved', 22, 22, '{"demo":true}'::jsonb, null, 'tank', 'dps', 'support', 'Sora'),
  ('4a91553e-f41a-4434-8d27-4bfb19146d55', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', 'a50cb551-3c34-4088-8bb7-067a59ac5ad4', 'tank', null, null, 'approved', 21, 21, '{"demo":true}'::jsonb, null, 'tank', 'dps', 'support', 'Tsubasa'),
  ('d11e94f6-4f9c-4a28-9a7f-cbe94b86451b', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', 'e4bb479e-d751-4c4e-9a47-543f88b0b950', 'tank', null, null, 'approved', 20, 20, '{"demo":true}'::jsonb, null, 'tank', 'dps', 'support', 'Cipher'),
  ('2bd348e4-6296-4b64-b09e-390fd383a8e2', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '32b8863d-3a2c-464f-b0d3-d442d70922f3', 'dps', null, null, 'approved', 15, 15, '{"demo":true}'::jsonb, null, 'dps', 'support', 'tank', 'Diamond_Dust'),
  ('3a7cf469-7dd7-4abd-ab2f-0fdcd357dda4', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '234fb8d6-5f53-444c-8b39-f7711a9ef4a8', 'dps', null, null, 'approved', 23, 23, '{"demo":true}'::jsonb, null, 'dps', 'support', 'tank', 'Aki'),
  ('92858b87-e4d9-45ce-8da5-bdea6ae40acd', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '5c79fadb-9f5f-45e1-a6e0-20b279ac2d76', 'dps', null, null, 'approved', 25, 25, '{"demo":true}'::jsonb, null, 'dps', 'support', 'tank', 'xX_Sniper_Xx'),
  ('4227fda8-ba8c-42e4-9957-18f5e4704f64', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '241f2ea4-a782-410d-a92f-d69074b6d211', 'dps', null, null, 'approved', 22, 22, '{"demo":true}'::jsonb, null, 'dps', 'support', 'tank', 'Rei'),
  ('ee208d0b-b7d0-4fd7-97b6-25b84f01beb5', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', 'a6548218-ef6a-4d67-8f2f-f4f6ce928c82', 'dps', null, null, 'approved', 20, 20, '{"demo":true}'::jsonb, null, 'dps', 'support', 'tank', 'Vortex'),
  ('a5048aaf-b733-4c9b-833d-96d9976d564c', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '84fd7b89-c0b4-4f25-816c-36c5a9aa5341', 'dps', null, null, 'approved', 26, 26, '{"demo":true}'::jsonb, null, 'dps', 'support', 'tank', 'Riku'),
  ('6643f330-cc58-4171-be5a-0ce49cf8c8f1', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '7c157096-8bd8-4c77-8ca2-8ea752c7a380', 'dps', null, null, 'approved', 21, 21, '{"demo":true}'::jsonb, null, 'dps', 'support', 'tank', 'つばき'),
  ('f40d1231-2de1-4098-894a-e60d7b662343', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '51ab11cb-d724-4d0f-9507-7639cc53ae46', 'dps', null, null, 'approved', 23, 23, '{"demo":true}'::jsonb, null, 'dps', 'support', 'tank', 'VoidWalker'),
  ('58f3bf94-068b-4d2e-b560-97b1257ea10c', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '5be0fec2-d5e5-42e7-b3fd-e250f3107dda', 'dps', null, null, 'approved', 25, 25, '{"demo":true}'::jsonb, null, 'dps', 'support', 'tank', 'ShadowFox'),
  ('9eaafe6f-b515-4a35-bc55-7672b187f6ff', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '1c210e60-2105-4a6d-b442-5cd4cc8e83f4', 'dps', null, null, 'approved', 20, 20, '{"demo":true}'::jsonb, null, 'dps', 'support', 'tank', 'Ghost_JP'),
  ('b01578ca-e7d5-4364-975b-ba88c542a506', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', 'a6515b54-5f93-4cae-82ce-80e3c9748118', 'dps', null, null, 'approved', 23, 23, '{"demo":true}'::jsonb, null, 'dps', 'support', 'tank', 'Blaze'),
  ('594189ac-47fb-4b9a-8ecf-b17e7a47eeb7', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '7328858b-a956-46b5-9a4b-004cab29cbc8', 'dps', null, null, 'approved', 21, 21, '{"demo":true}'::jsonb, null, 'dps', 'support', 'tank', 'れん'),
  ('ae34a973-92fd-4713-b5a5-2d94d049368c', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', 'a95fbf1a-e01e-4393-8a36-89373e69567d', 'dps', null, null, 'approved', 21, 21, '{"demo":true}'::jsonb, null, 'dps', 'support', 'tank', 'TankLord'),
  ('662707fe-a210-4f03-9107-a40e228860e3', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '7932df2a-76fe-453c-b04b-e326458f2692', 'dps', null, null, 'approved', 27, 27, '{"demo":true}'::jsonb, null, 'dps', 'support', 'tank', 'はやて'),
  ('22beb0b3-8926-432c-94fa-5c3dcd9e622b', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '9b1b0653-ebb7-4292-9647-2a32ef439362', 'dps', null, null, 'approved', 17, 17, '{"demo":true}'::jsonb, null, 'dps', 'support', 'tank', 'Kenji'),
  ('475ad81a-f138-4d3b-9a07-0ff4046dd9dc', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '4a9e26be-da89-4a85-9d29-dd1fe08e1458', 'dps', null, null, 'approved', 29, 29, '{"demo":true}'::jsonb, null, 'dps', 'support', 'tank', 'Emi'),
  ('5a75802e-f00c-4b45-8c24-9c51580e09e4', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', 'c1d60351-904a-4417-bad7-28764e754582', 'dps', null, null, 'approved', 22, 22, '{"demo":true}'::jsonb, null, 'dps', 'support', 'tank', 'Haruto'),
  ('ba192bde-11df-4475-9652-c65131091de6', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '72ccadc1-e18b-4a50-9899-9ae6da7e215f', 'dps', null, null, 'approved', 24, 24, '{"demo":true}'::jsonb, null, 'dps', 'support', 'tank', 'Shota'),
  ('08eae947-e986-45b2-b6eb-7715da7692ed', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '9e50387e-017a-414b-945e-1d28f6f50fdf', 'dps', null, null, 'approved', 24, 24, '{"demo":true}'::jsonb, null, 'dps', 'support', 'tank', 'JadeDragon'),
  ('d6f2dd69-3117-491a-835d-f7ad9166b278', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '27adaa67-c251-4531-bc89-34680a5b5c38', 'dps', null, null, 'approved', 15, 15, '{"demo":true}'::jsonb, null, 'dps', 'support', 'tank', 'Subaru'),
  ('2d7f061c-c757-4855-b24b-62a4391c2c6d', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '64d2afbc-9d4b-4d26-9602-ba941d900585', 'dps', null, null, 'approved', 26, 26, '{"demo":true}'::jsonb, null, 'dps', 'support', 'tank', 'みなと'),
  ('bd1832c3-d5bd-4e97-a579-8a3790dfda7e', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '6577148a-8da9-492a-9f1b-3d1cf05cb27f', 'dps', null, null, 'approved', 29, 29, '{"demo":true}'::jsonb, null, 'dps', 'support', 'tank', 'Minato_JP'),
  ('85ab19af-659b-4742-91d2-135b27ade674', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', 'db11dc00-8c99-40a4-9ad2-a24e08bd0bc8', 'dps', null, null, 'approved', 20, 20, '{"demo":true}'::jsonb, null, 'dps', 'support', 'tank', 'Reaper77'),
  ('e42765f0-4739-4f67-ada2-dc1d7564b5f5', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', 'c8959d4a-cb5a-4fdf-a008-1d7384c8697f', 'dps', null, null, 'approved', 27, 27, '{"demo":true}'::jsonb, null, 'dps', 'support', 'tank', 'Aim_God'),
  ('7b930a2f-d51e-4186-9b1f-474384ae60bc', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '6de90e6b-cfea-4bbc-817b-49610bd371fa', 'dps', null, null, 'approved', 23, 23, '{"demo":true}'::jsonb, null, 'dps', 'support', 'tank', 'HealBot'),
  ('e64efb85-6b16-4a99-951c-b94c427f0e3b', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', 'd5e664cc-513a-4667-9c1b-93e09922eb85', 'dps', null, null, 'approved', 28, 28, '{"demo":true}'::jsonb, null, 'dps', 'support', 'tank', 'そうた'),
  ('4a28c8c9-a059-4690-b97e-fdae52b0821c', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', 'f13ed86c-80c3-43cf-8e39-ce703093714b', 'dps', null, null, 'approved', 19, 19, '{"demo":true}'::jsonb, null, 'dps', 'support', 'tank', 'SilverWolf'),
  ('e20a2eef-d042-4fad-b83b-57043dece8db', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '30a882db-a2a1-4606-b5e9-5f00f3677b6d', 'dps', null, null, 'approved', 22, 22, '{"demo":true}'::jsonb, null, 'dps', 'support', 'tank', 'Aoi'),
  ('c3430d0f-38db-4554-b33f-ff243b198360', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '049e134c-4bc9-4601-b7e4-374e0fa45cca', 'support', null, null, 'approved', 20, 20, '{"demo":true}'::jsonb, null, 'support', 'tank', 'dps', 'Hinata_OW'),
  ('93df5f2a-06d6-4e52-9951-5971c46d5e09', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '1ca7a7e6-34b7-4653-b8a4-a73bda8746da', 'support', null, null, 'approved', 30, 30, '{"demo":true}'::jsonb, null, 'support', 'tank', 'dps', 'ProGamerJP'),
  ('c5c2de52-9c84-4d6e-8317-c4f0755e8d92', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '5dec505a-0609-4340-85f4-a0297e4f5c59', 'support', null, null, 'approved', 28, 28, '{"demo":true}'::jsonb, null, 'support', 'tank', 'dps', 'Luna'),
  ('82f6f550-7eb0-475f-98f4-a7217a42f528', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', 'b4c425ef-04ba-4544-a6dd-0245c227688f', 'support', null, null, 'approved', 30, 30, '{"demo":true}'::jsonb, null, 'support', 'tank', 'dps', 'Daiki'),
  ('0397b1fa-2a9f-49b1-8d96-77a124537f3d', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', 'fba13afa-020d-424b-9a88-375eaab26276', 'support', null, null, 'approved', 18, 18, '{"demo":true}'::jsonb, null, 'support', 'tank', 'dps', 'しずく'),
  ('745f9c47-e88f-4d28-a1c0-5933608ba7a7', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', 'f53d95b7-8896-49f3-a6f7-87f1eae27332', 'support', null, null, 'approved', 15, 15, '{"demo":true}'::jsonb, null, 'support', 'tank', 'dps', 'ひなた'),
  ('1c0c8383-ee41-4d4f-bd4a-7810609cbb4a', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', 'e6c9f565-c2c0-455c-b3a7-8bb925cf4da4', 'support', null, null, 'approved', 24, 24, '{"demo":true}'::jsonb, null, 'support', 'tank', 'dps', 'GoldenEye'),
  ('4cb84fc5-d94d-46ef-8c73-23bbe3358ca3', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '75f72d96-4b08-4305-bf03-88649166c60e', 'support', null, null, 'approved', 30, 30, '{"demo":true}'::jsonb, null, 'support', 'tank', 'dps', 'HeadshotHiro'),
  ('ebb318f5-607b-430d-8bf9-08b06e026af2', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', 'a3a4d63d-2338-41fc-bf05-4e41fa5a5c63', 'support', null, null, 'approved', 27, 27, '{"demo":true}'::jsonb, null, 'support', 'tank', 'dps', 'Sena'),
  ('616ad475-c9ba-4749-bbd2-a60e0faa19cc', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', 'dd15da2a-f8bb-4f3b-9050-6d3fd45c00f7', 'support', null, null, 'approved', 26, 26, '{"demo":true}'::jsonb, null, 'support', 'tank', 'dps', 'Rio'),
  ('644d64db-6ad2-4ae2-9c10-ae22aecb0727', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '18976b3c-0415-4a60-bc84-8e579c175076', 'support', null, null, 'approved', 17, 17, '{"demo":true}'::jsonb, null, 'support', 'tank', 'dps', 'SmurfKiller'),
  ('c106ddcc-47e8-4a56-9dc8-1d75436d5650', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '2fdd3bd9-04f1-40fb-93b6-94802f5e3767', 'support', null, null, 'approved', 20, 20, '{"demo":true}'::jsonb, null, 'support', 'tank', 'dps', 'CrimsonEdge'),
  ('1a92835c-ad36-4395-9512-964c1691aa13', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '5801aba8-a1f2-4a42-9215-afe0beadfdfe', 'support', null, null, 'approved', 24, 24, '{"demo":true}'::jsonb, null, 'support', 'tank', 'dps', 'Ren'),
  ('542be131-ab40-4a85-b859-de7c33c9747e', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '336c9594-7c37-42ad-a547-eff2e65cb943', 'support', null, null, 'approved', 28, 28, '{"demo":true}'::jsonb, null, 'support', 'tank', 'dps', 'ゆうき'),
  ('3d9fa47c-e3ac-4c09-9669-ed8d2e959e7e', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', 'd48a6ec5-9c14-4cdc-9693-4e04795f7934', 'support', null, null, 'approved', 25, 25, '{"demo":true}'::jsonb, null, 'support', 'tank', 'dps', 'Yuto'),
  ('eaa49d04-5f39-4be0-ae53-e718bc84a4c7', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '0704ae38-a038-45d0-a29c-c0562725be36', 'support', null, null, 'approved', 26, 26, '{"demo":true}'::jsonb, null, 'support', 'tank', 'dps', 'Ryota'),
  ('7264ed69-e7f9-4292-aefa-47b1415849ed', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '8953e988-0713-4e8a-91ac-19b0eee0f9ad', 'support', null, null, 'approved', 23, 23, '{"demo":true}'::jsonb, null, 'support', 'tank', 'dps', 'NightRaven'),
  ('0d8a26fb-ea9d-41af-a39c-135511167cb7', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '0b94b1b8-b746-4602-a882-3a0e2d6d73c1', 'support', null, null, 'approved', 26, 26, '{"demo":true}'::jsonb, null, 'support', 'tank', 'dps', 'Zephyr'),
  ('8b304a34-5bde-4f55-953f-87206ccb558b', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', 'b61aa3a0-075d-4bfb-b53f-68fc03d59088', 'support', null, null, 'approved', 24, 24, '{"demo":true}'::jsonb, null, 'support', 'tank', 'dps', 'Takumi'),
  ('2d88a498-7fc3-47cd-bf10-754187e906de', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', 'a46d6edb-29f9-45f0-8563-30771e7e45c6', 'support', null, null, 'approved', 19, 19, '{"demo":true}'::jsonb, null, 'support', 'tank', 'dps', 'Haru'),
  ('925f327e-b0fd-4131-a4c1-d41fec0f45d3', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '073f6865-f8b3-42a7-94e3-c0637e90306b', 'support', null, null, 'approved', 22, 22, '{"demo":true}'::jsonb, null, 'support', 'tank', 'dps', 'AzureSky'),
  ('7c48e26e-8ba8-43b4-80cd-f23ff03c3754', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '14bf7d31-36ca-433e-9c7d-0de500b441a0', 'support', null, null, 'approved', 23, 23, '{"demo":true}'::jsonb, null, 'support', 'tank', 'dps', 'IronWill'),
  ('6e4142b7-adfc-4176-811f-23f8158d80eb', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', 'aa3f667e-3126-4700-af42-ac18cf868d8b', 'support', null, null, 'approved', 29, 29, '{"demo":true}'::jsonb, null, 'support', 'tank', 'dps', 'OneTrick'),
  ('cb392b35-bfed-4ad7-88da-8550db7b4e39', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '5ea9c23b-b48c-4870-a4c3-07c8aaaa8f4c', 'support', null, null, 'approved', 19, 19, '{"demo":true}'::jsonb, null, 'support', 'tank', 'dps', 'Mei'),
  ('44b8a39e-22c4-49ed-abb3-65dd331456fe', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', 'adb42f9c-993c-436c-ad4e-f456ea0741b6', 'support', null, null, 'approved', 15, 15, '{"demo":true}'::jsonb, null, 'support', 'tank', 'dps', 'Itsuki'),
  ('c056d716-f4f0-4304-9610-055f88a49d6a', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '6b44582f-33bb-4068-8c4b-7a7a1467be86', 'support', null, null, 'approved', 25, 25, '{"demo":true}'::jsonb, null, 'support', 'tank', 'dps', 'ClutchKing'),
  ('513e15ee-96ed-4b8a-84d3-4c43a33156e0', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '4a317b41-afc6-4271-bcb6-0b7a301d5a3e', 'support', null, null, 'approved', 23, 23, '{"demo":true}'::jsonb, null, 'support', 'tank', 'dps', 'たける'),
  ('14fc9f5f-a8eb-410a-bda2-104ab18eda00', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '7605e2a4-c0c3-4e89-9fc8-694100009f84', 'support', null, null, 'approved', 26, 26, '{"demo":true}'::jsonb, null, 'support', 'tank', 'dps', 'Kira')
on conflict (id) do nothing;

-- 5. teams（チーム）
insert into public.teams (id, event_id, name, status, captain_registration_id) values
  ('5465739b-bdc2-4ce6-98ce-89d9f904b5cf', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', 'Nova Vanguard', 'approved', '16220459-7021-4f19-aba9-d9c40edaf6bc'),
  ('bc5be56f-a910-4d9f-bb33-f3dbb48453bc', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', 'Crimson Talon', 'approved', '58f3bf94-068b-4d2e-b560-97b1257ea10c'),
  ('8167a302-5704-4296-94fc-53c3c9e7c4db', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', 'Azure Phantom', 'approved', 'e974bc75-0757-4180-9933-11b2a5b2e54f'),
  ('44d5ab77-3023-45fb-b967-0ec8c3e99a45', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', 'Iron Sentinels', 'approved', '59ae8af0-bd10-480c-985a-59e693983857'),
  ('d2fea073-7dba-4f0f-9d4b-a75909343f80', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', 'Phoenix Rising', 'approved', '2d01c829-3c0d-4ad3-8a89-658ba864cd63'),
  ('ea768940-fe64-454e-98e1-7c84e73924e2', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', 'Void Runners', 'approved', '616ad475-c9ba-4749-bbd2-a60e0faa19cc'),
  ('5edeb7af-35a4-4eba-95d2-aee5452a0165', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', 'Stormbreakers', 'approved', '92858b87-e4d9-45ce-8da5-bdea6ae40acd'),
  ('4453e121-74bc-4b6b-aeb2-405dd1135479', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', 'Golden Aegis', 'approved', '6e4142b7-adfc-4176-811f-23f8158d80eb'),
  ('2ea3a03c-9af2-43aa-9a29-7113445f3e6f', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', 'Shadow Syndicate', 'approved', '08eae947-e986-45b2-b6eb-7715da7692ed'),
  ('e26ad003-f36a-4f45-9292-c64f39be36fb', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', 'Frost Wolves', 'approved', 'd11e94f6-4f9c-4a28-9a7f-cbe94b86451b'),
  ('3f201e68-5edb-4d27-8316-f1e6b1db85bc', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', 'Radiant Order', 'approved', 'e1ac1a87-670b-4489-ae02-c9a6df6c3a19'),
  ('db3efebf-2a6c-4554-8eb1-33f0b009c16b', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', 'Echo Protocol', 'approved', 'eaa49d04-5f39-4be0-ae53-e718bc84a4c7')
on conflict (id) do nothing;

-- 6. team_members（所属）
insert into public.team_members (id, team_id, registration_id, role, position, is_representative) values
  ('f10de7f8-2775-4a3b-9690-e39787aa7b56', 'bc5be56f-a910-4d9f-bb33-f3dbb48453bc', '4a91553e-f41a-4434-8d27-4bfb19146d55', 'tank', 'regular', false),
  ('8ab4f2c9-739a-4beb-a7e9-27fa41d331c6', 'bc5be56f-a910-4d9f-bb33-f3dbb48453bc', '58f3bf94-068b-4d2e-b560-97b1257ea10c', 'dps', 'regular', true),
  ('f42f28f6-e082-4fbc-80af-0af556600788', 'bc5be56f-a910-4d9f-bb33-f3dbb48453bc', '3a7cf469-7dd7-4abd-ab2f-0fdcd357dda4', 'dps', 'regular', false),
  ('7deec0f8-b275-464f-8115-5411a2015c11', 'bc5be56f-a910-4d9f-bb33-f3dbb48453bc', '4cb84fc5-d94d-46ef-8c73-23bbe3358ca3', 'support', 'regular', false),
  ('bbd683dc-0e80-4a4c-bab7-785916bf7f26', 'bc5be56f-a910-4d9f-bb33-f3dbb48453bc', '3d9fa47c-e3ac-4c09-9669-ed8d2e959e7e', 'support', 'regular', false),
  ('bc581010-a146-4db6-af8c-2fa99ff45a3c', '8167a302-5704-4296-94fc-53c3c9e7c4db', '644d64db-6ad2-4ae2-9c10-ae22aecb0727', 'support', 'regular', false),
  ('111fd22e-7547-47de-964e-f1b6f44fd48f', '8167a302-5704-4296-94fc-53c3c9e7c4db', '2bd348e4-6296-4b64-b09e-390fd383a8e2', 'dps', 'regular', false),
  ('205592db-8707-471a-b6a3-3ecb68557dae', '8167a302-5704-4296-94fc-53c3c9e7c4db', 'e974bc75-0757-4180-9933-11b2a5b2e54f', 'tank', 'regular', true),
  ('900d5043-acfc-4c59-ae23-947158d535c0', '8167a302-5704-4296-94fc-53c3c9e7c4db', '4227fda8-ba8c-42e4-9957-18f5e4704f64', 'dps', 'regular', false),
  ('23bba70e-4e61-48c4-a127-a5a2824428eb', '5465739b-bdc2-4ce6-98ce-89d9f904b5cf', '93df5f2a-06d6-4e52-9951-5971c46d5e09', 'support', 'reserve', false),
  ('9df1d121-ee85-4b3b-85e4-83334eb27e5b', '44d5ab77-3023-45fb-b967-0ec8c3e99a45', '542be131-ab40-4a85-b859-de7c33c9747e', 'support', 'regular', false),
  ('cbfcf4af-7312-4aeb-884d-9f73f4b72528', '44d5ab77-3023-45fb-b967-0ec8c3e99a45', '59ae8af0-bd10-480c-985a-59e693983857', 'tank', 'regular', true),
  ('1cb14a06-fa17-417d-9acf-a20e82a8a1b1', '44d5ab77-3023-45fb-b967-0ec8c3e99a45', 'c7b62221-3c7d-4d97-b655-83d759b13af7', 'tank', 'regular', false),
  ('6f021fc8-56b9-4989-803b-9ce66f93889a', '44d5ab77-3023-45fb-b967-0ec8c3e99a45', '9eaafe6f-b515-4a35-bc55-7672b187f6ff', 'dps', 'regular', false),
  ('bdcda6df-3010-49c9-b651-924c79fad620', '44d5ab77-3023-45fb-b967-0ec8c3e99a45', '44b8a39e-22c4-49ed-abb3-65dd331456fe', 'support', 'regular', false),
  ('42536fcf-5907-43ad-9416-243f7bbd7f8b', 'd2fea073-7dba-4f0f-9d4b-a75909343f80', 'ae34a973-92fd-4713-b5a5-2d94d049368c', 'dps', 'regular', false),
  ('b22fd7d8-f0ce-41aa-9d00-02e5d7c14e7d', 'd2fea073-7dba-4f0f-9d4b-a75909343f80', '2d01c829-3c0d-4ad3-8a89-658ba864cd63', 'tank', 'regular', true),
  ('e0a931d6-6b80-4ef2-afd5-fc94c6f0d175', 'd2fea073-7dba-4f0f-9d4b-a75909343f80', 'f40d1231-2de1-4098-894a-e60d7b662343', 'dps', 'regular', false),
  ('af3dec61-926d-44e3-a8d6-e90a3ada2a90', 'd2fea073-7dba-4f0f-9d4b-a75909343f80', '1a92835c-ad36-4395-9512-964c1691aa13', 'support', 'regular', false),
  ('cbec183f-4ba6-4f9a-bb08-6a8b18078e54', 'd2fea073-7dba-4f0f-9d4b-a75909343f80', '7c48e26e-8ba8-43b4-80cd-f23ff03c3754', 'support', 'regular', false),
  ('d50a8aee-ea3e-4fe4-b9f0-9533f6cdf1eb', 'ea768940-fe64-454e-98e1-7c84e73924e2', '513e15ee-96ed-4b8a-84d3-4c43a33156e0', 'support', 'regular', false),
  ('d3660859-a976-432b-87e3-4f1c50aa4f53', 'ea768940-fe64-454e-98e1-7c84e73924e2', '04e29c2f-14a9-4107-a441-8a9a5b6e7adf', 'tank', 'regular', false),
  ('41597de9-1d3e-4f58-b060-946eb33c0e4f', 'ea768940-fe64-454e-98e1-7c84e73924e2', 'bd1832c3-d5bd-4e97-a579-8a3790dfda7e', 'dps', 'reserve', false),
  ('c9448260-9d32-460f-a363-b33672871180', 'ea768940-fe64-454e-98e1-7c84e73924e2', '616ad475-c9ba-4749-bbd2-a60e0faa19cc', 'support', 'regular', true),
  ('ed78b4ce-7db1-4453-8e82-b7a96cd22e11', 'ea768940-fe64-454e-98e1-7c84e73924e2', 'ee208d0b-b7d0-4fd7-97b6-25b84f01beb5', 'dps', 'regular', false),
  ('d559ec53-a13d-43ba-bd4c-5ba6e801aab5', '5edeb7af-35a4-4eba-95d2-aee5452a0165', '0397b1fa-2a9f-49b1-8d96-77a124537f3d', 'support', 'regular', false),
  ('db088645-f0c0-4d02-935b-bb3a13bca3d4', '5edeb7af-35a4-4eba-95d2-aee5452a0165', '92858b87-e4d9-45ce-8da5-bdea6ae40acd', 'dps', 'regular', true),
  ('47b39340-f808-43be-8e81-44168b4bc6b9', '5edeb7af-35a4-4eba-95d2-aee5452a0165', 'a5048aaf-b733-4c9b-833d-96d9976d564c', 'dps', 'regular', false),
  ('2efb7ac3-d5fc-449c-b44c-4ce32dc2a79d', '5edeb7af-35a4-4eba-95d2-aee5452a0165', 'd8d3b374-ffe2-4ef7-bea2-81d3a299bfbb', 'tank', 'regular', false),
  ('a8b5fe7c-2c06-4eb9-92d5-2839e750d3ea', '5edeb7af-35a4-4eba-95d2-aee5452a0165', '925f327e-b0fd-4131-a4c1-d41fec0f45d3', 'support', 'regular', false),
  ('3c030fbd-413c-431a-ade4-4a7ecfef880b', '4453e121-74bc-4b6b-aeb2-405dd1135479', '5a75802e-f00c-4b45-8c24-9c51580e09e4', 'dps', 'regular', false),
  ('76dbe2f2-c881-4697-8087-a15812b8f47f', '4453e121-74bc-4b6b-aeb2-405dd1135479', 'e20a2eef-d042-4fad-b83b-57043dece8db', 'dps', 'regular', false),
  ('e54b4737-4237-464f-98b5-09e3c7bc8011', '4453e121-74bc-4b6b-aeb2-405dd1135479', '594189ac-47fb-4b9a-8ecf-b17e7a47eeb7', 'dps', 'regular', false),
  ('3068bc6c-d7b8-46fd-b041-734178578ac0', '4453e121-74bc-4b6b-aeb2-405dd1135479', 'e522f120-1d67-4677-8638-91ff2426b844', 'tank', 'regular', false),
  ('6a98ac13-4d59-4c5a-b6bb-ccd67f7c5ec8', '4453e121-74bc-4b6b-aeb2-405dd1135479', '6e4142b7-adfc-4176-811f-23f8158d80eb', 'support', 'regular', true),
  ('c21a7ed4-c52b-43af-8741-9bbc2a6204d3', '2ea3a03c-9af2-43aa-9a29-7113445f3e6f', 'd32fd8f5-5bfd-40a7-b41f-a4916de600ca', 'tank', 'regular', false),
  ('852e02f1-b4f8-4af6-8ca1-22c6d723e4ff', '2ea3a03c-9af2-43aa-9a29-7113445f3e6f', '08eae947-e986-45b2-b6eb-7715da7692ed', 'dps', 'regular', true),
  ('402d3b02-7588-4a99-b638-cd749472788c', '2ea3a03c-9af2-43aa-9a29-7113445f3e6f', '6643f330-cc58-4171-be5a-0ce49cf8c8f1', 'dps', 'regular', false),
  ('a51bbfb8-9c33-48b9-a7f6-dd0aa548be7f', '2ea3a03c-9af2-43aa-9a29-7113445f3e6f', 'cb392b35-bfed-4ad7-88da-8550db7b4e39', 'support', 'regular', false),
  ('f1f8dd65-c910-4656-8320-a77d2a5c4b91', '2ea3a03c-9af2-43aa-9a29-7113445f3e6f', '14fc9f5f-a8eb-410a-bda2-104ab18eda00', 'support', 'regular', false),
  ('7da5b2a0-6cd6-4ead-b0fb-c711ece0e492', 'e26ad003-f36a-4f45-9292-c64f39be36fb', 'd11e94f6-4f9c-4a28-9a7f-cbe94b86451b', 'tank', 'regular', true),
  ('5959b25e-f977-43f8-9705-f44e5b0136a9', 'e26ad003-f36a-4f45-9292-c64f39be36fb', '4a28c8c9-a059-4690-b97e-fdae52b0821c', 'dps', 'regular', false),
  ('8ac7277d-583b-4193-9304-1c0cf8daf26e', 'e26ad003-f36a-4f45-9292-c64f39be36fb', '662707fe-a210-4f03-9107-a40e228860e3', 'dps', 'regular', false),
  ('e29f0a68-fe09-4605-a2f1-63b562d2facb', 'e26ad003-f36a-4f45-9292-c64f39be36fb', 'ebb318f5-607b-430d-8bf9-08b06e026af2', 'support', 'regular', false),
  ('40c3e9e9-3cba-4c0c-a940-47b678c1b284', 'e26ad003-f36a-4f45-9292-c64f39be36fb', '745f9c47-e88f-4d28-a1c0-5933608ba7a7', 'support', 'regular', false),
  ('20905f95-60e1-45f5-a1f6-2d67e87bc66c', '3f201e68-5edb-4d27-8316-f1e6b1db85bc', 'ba192bde-11df-4475-9652-c65131091de6', 'dps', 'regular', false),
  ('ac849fcc-4f27-4cdf-8271-f40361db66d9', '3f201e68-5edb-4d27-8316-f1e6b1db85bc', '7b930a2f-d51e-4186-9b1f-474384ae60bc', 'dps', 'regular', false),
  ('de6ff9b0-8933-42cf-94db-e4a13e01aef3', '3f201e68-5edb-4d27-8316-f1e6b1db85bc', 'e1ac1a87-670b-4489-ae02-c9a6df6c3a19', 'tank', 'regular', true),
  ('aea5d30e-42a4-43ca-a0ee-58aed1869c4f', '3f201e68-5edb-4d27-8316-f1e6b1db85bc', '0d8a26fb-ea9d-41af-a39c-135511167cb7', 'support', 'regular', false),
  ('e61286e1-2d43-4905-94fc-a26f7ea3074d', '3f201e68-5edb-4d27-8316-f1e6b1db85bc', '82f6f550-7eb0-475f-98f4-a7217a42f528', 'support', 'regular', false),
  ('9efb3022-a455-4489-ad62-cb582e1d4a10', 'db3efebf-2a6c-4554-8eb1-33f0b009c16b', 'd9194055-4231-4fb1-a311-deddea787e07', 'tank', 'regular', false),
  ('6e1cf1dc-7310-4afa-ae14-bada1a0724b7', 'db3efebf-2a6c-4554-8eb1-33f0b009c16b', 'd6f2dd69-3117-491a-835d-f7ad9166b278', 'dps', 'regular', false),
  ('9c23efcb-8739-43d7-b512-e0c05556710d', 'db3efebf-2a6c-4554-8eb1-33f0b009c16b', 'e64efb85-6b16-4a99-951c-b94c427f0e3b', 'dps', 'regular', false),
  ('289cc2be-bfa7-46c6-bed7-b8a3b65064db', 'db3efebf-2a6c-4554-8eb1-33f0b009c16b', 'eaa49d04-5f39-4be0-ae53-e718bc84a4c7', 'support', 'regular', true),
  ('66872be5-c02e-4d84-b7bb-94f544f3922a', 'db3efebf-2a6c-4554-8eb1-33f0b009c16b', '2d88a498-7fc3-47cd-bf10-754187e906de', 'support', 'regular', false),
  ('721a853c-3a6f-4d05-bfa2-c2311a57c6ed', 'bc5be56f-a910-4d9f-bb33-f3dbb48453bc', '85ab19af-659b-4742-91d2-135b27ade674', 'dps', 'reserve', false),
  ('8c7e04e9-5b94-45f8-a6dd-8aabc21530da', '8167a302-5704-4296-94fc-53c3c9e7c4db', 'c106ddcc-47e8-4a56-9dc8-1d75436d5650', 'support', 'reserve', false),
  ('c489f153-6182-4c6c-89b7-3042d412e71a', '44d5ab77-3023-45fb-b967-0ec8c3e99a45', '3ba9bd6a-0424-4afd-ab45-66d0241269ca', 'tank', 'reserve', false),
  ('356bfac5-ef81-4082-8d99-f8255cc27ebf', '8167a302-5704-4296-94fc-53c3c9e7c4db', '16220459-7021-4f19-aba9-d9c40edaf6bc', 'tank', 'regular', false),
  ('9beda38d-5420-46ab-8643-0b0c54a398b8', '5465739b-bdc2-4ce6-98ce-89d9f904b5cf', '2d7f061c-c757-4855-b24b-62a4391c2c6d', 'dps', 'regular', false),
  ('8ca443a5-0538-47df-9010-86c1386ca733', '5465739b-bdc2-4ce6-98ce-89d9f904b5cf', 'e42765f0-4739-4f67-ada2-dc1d7564b5f5', 'dps', 'regular', false),
  ('ceb33a22-7a50-4589-a550-5a57dd2d9a75', '5465739b-bdc2-4ce6-98ce-89d9f904b5cf', 'c5c2de52-9c84-4d6e-8317-c4f0755e8d92', 'support', 'regular', false),
  ('b66d5931-3e2c-4265-9814-d22cc3a2a221', '5465739b-bdc2-4ce6-98ce-89d9f904b5cf', '1c0c8383-ee41-4d4f-bd4a-7810609cbb4a', 'support', 'regular', false),
  ('3cd1d34e-069b-42fe-a615-afda696256f8', '5465739b-bdc2-4ce6-98ce-89d9f904b5cf', 'b01578ca-e7d5-4364-975b-ba88c542a506', 'dps', 'regular', false)
on conflict (id) do nothing;

-- 7. groups（予選ブロック）
insert into public.groups (id, event_id, name) values
  ('81116d6f-edc6-4861-9ec7-0e74443cf677', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', 'A'),
  ('9722a452-fa31-4730-a8c3-6010f2b745fb', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', 'B')
on conflict (id) do nothing;

-- 8. group_teams（ブロック↔チーム）※ 複合PK
insert into public.group_teams (group_id, team_id) values
  ('81116d6f-edc6-4861-9ec7-0e74443cf677', '5465739b-bdc2-4ce6-98ce-89d9f904b5cf'),
  ('81116d6f-edc6-4861-9ec7-0e74443cf677', '2ea3a03c-9af2-43aa-9a29-7113445f3e6f'),
  ('81116d6f-edc6-4861-9ec7-0e74443cf677', '5edeb7af-35a4-4eba-95d2-aee5452a0165'),
  ('81116d6f-edc6-4861-9ec7-0e74443cf677', 'd2fea073-7dba-4f0f-9d4b-a75909343f80'),
  ('81116d6f-edc6-4861-9ec7-0e74443cf677', 'db3efebf-2a6c-4554-8eb1-33f0b009c16b'),
  ('81116d6f-edc6-4861-9ec7-0e74443cf677', '8167a302-5704-4296-94fc-53c3c9e7c4db'),
  ('9722a452-fa31-4730-a8c3-6010f2b745fb', 'bc5be56f-a910-4d9f-bb33-f3dbb48453bc'),
  ('9722a452-fa31-4730-a8c3-6010f2b745fb', '3f201e68-5edb-4d27-8316-f1e6b1db85bc'),
  ('9722a452-fa31-4730-a8c3-6010f2b745fb', 'ea768940-fe64-454e-98e1-7c84e73924e2'),
  ('9722a452-fa31-4730-a8c3-6010f2b745fb', '4453e121-74bc-4b6b-aeb2-405dd1135479'),
  ('9722a452-fa31-4730-a8c3-6010f2b745fb', '44d5ab77-3023-45fb-b967-0ec8c3e99a45'),
  ('9722a452-fa31-4730-a8c3-6010f2b745fb', 'e26ad003-f36a-4f45-9292-c64f39be36fb')
on conflict do nothing;

-- 9. matches（予選＋決勝T）
insert into public.matches (id, event_id, group_id, phase, round, bracket_position, team_a_id, team_b_id, best_of, scheduled_at, stream_url, streamer_name, replay_code, notified_at) values
  ('959e60a6-092a-43c4-8220-fa9d25b24901', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '81116d6f-edc6-4861-9ec7-0e74443cf677', 'group', null, null, '2ea3a03c-9af2-43aa-9a29-7113445f3e6f', '5edeb7af-35a4-4eba-95d2-aee5452a0165', 3, null, null, null, null, null),
  ('94e4d79b-6295-445c-8f55-8be0590d6e34', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '81116d6f-edc6-4861-9ec7-0e74443cf677', 'group', null, null, '2ea3a03c-9af2-43aa-9a29-7113445f3e6f', '8167a302-5704-4296-94fc-53c3c9e7c4db', 3, null, null, null, null, null),
  ('ace36428-aaab-4c5b-9128-f405fa4e2098', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '81116d6f-edc6-4861-9ec7-0e74443cf677', 'group', null, null, '2ea3a03c-9af2-43aa-9a29-7113445f3e6f', 'd2fea073-7dba-4f0f-9d4b-a75909343f80', 3, null, null, null, null, null),
  ('384316ae-1257-4eb4-ab7b-2aaf614937dd', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '81116d6f-edc6-4861-9ec7-0e74443cf677', 'group', null, null, '2ea3a03c-9af2-43aa-9a29-7113445f3e6f', 'db3efebf-2a6c-4554-8eb1-33f0b009c16b', 3, null, null, null, null, null),
  ('e43c0335-a1c6-4c96-805a-9d79bc346698', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '81116d6f-edc6-4861-9ec7-0e74443cf677', 'group', null, null, '5465739b-bdc2-4ce6-98ce-89d9f904b5cf', '5edeb7af-35a4-4eba-95d2-aee5452a0165', 3, null, null, null, null, null),
  ('b291ac99-51bb-4c65-93c7-d4f5355a2d17', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '81116d6f-edc6-4861-9ec7-0e74443cf677', 'group', null, null, '5465739b-bdc2-4ce6-98ce-89d9f904b5cf', '8167a302-5704-4296-94fc-53c3c9e7c4db', 3, null, null, null, null, null),
  ('4ea68973-62de-44af-8ae9-85a51bc397e6', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '81116d6f-edc6-4861-9ec7-0e74443cf677', 'group', null, null, '5465739b-bdc2-4ce6-98ce-89d9f904b5cf', 'd2fea073-7dba-4f0f-9d4b-a75909343f80', 3, null, null, null, null, null),
  ('ac6cc2dd-330f-4dc4-82c7-c0e8ced5d05e', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '81116d6f-edc6-4861-9ec7-0e74443cf677', 'group', null, null, '5465739b-bdc2-4ce6-98ce-89d9f904b5cf', 'db3efebf-2a6c-4554-8eb1-33f0b009c16b', 3, null, null, null, null, null),
  ('8d90566c-2909-44c7-9aab-79db52a96493', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '81116d6f-edc6-4861-9ec7-0e74443cf677', 'group', null, null, '5edeb7af-35a4-4eba-95d2-aee5452a0165', '8167a302-5704-4296-94fc-53c3c9e7c4db', 3, null, null, null, null, null),
  ('a397f59f-d413-474d-817b-aa3030f20df3', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '81116d6f-edc6-4861-9ec7-0e74443cf677', 'group', null, null, '5edeb7af-35a4-4eba-95d2-aee5452a0165', 'd2fea073-7dba-4f0f-9d4b-a75909343f80', 3, null, null, null, null, null),
  ('74ed896d-bfab-4436-abde-1e600c2e4a2f', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '81116d6f-edc6-4861-9ec7-0e74443cf677', 'group', null, null, '5edeb7af-35a4-4eba-95d2-aee5452a0165', 'db3efebf-2a6c-4554-8eb1-33f0b009c16b', 3, null, null, null, null, null),
  ('588ae922-416a-4a8c-80f4-d04e77742d74', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '81116d6f-edc6-4861-9ec7-0e74443cf677', 'group', null, null, '8167a302-5704-4296-94fc-53c3c9e7c4db', 'd2fea073-7dba-4f0f-9d4b-a75909343f80', 3, null, null, null, null, null),
  ('41a05c4e-caf3-44cc-b7bb-a1f95d360781', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '81116d6f-edc6-4861-9ec7-0e74443cf677', 'group', null, null, '8167a302-5704-4296-94fc-53c3c9e7c4db', 'db3efebf-2a6c-4554-8eb1-33f0b009c16b', 3, null, null, null, null, null),
  ('74b2332a-de61-48ab-bd00-084ee73791fe', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '81116d6f-edc6-4861-9ec7-0e74443cf677', 'group', null, null, 'd2fea073-7dba-4f0f-9d4b-a75909343f80', 'db3efebf-2a6c-4554-8eb1-33f0b009c16b', 3, null, null, null, null, null),
  ('7a7d26be-bf77-4edd-8d6e-bbb7f52d61d0', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '81116d6f-edc6-4861-9ec7-0e74443cf677', 'group', null, null, '2ea3a03c-9af2-43aa-9a29-7113445f3e6f', '5465739b-bdc2-4ce6-98ce-89d9f904b5cf', 3, '2026-07-15T07:28:00+00:00', null, null, null, null),
  ('e65d08aa-cd46-405e-a065-e4dba91d6ff1', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '9722a452-fa31-4730-a8c3-6010f2b745fb', 'group', null, null, '3f201e68-5edb-4d27-8316-f1e6b1db85bc', '4453e121-74bc-4b6b-aeb2-405dd1135479', 3, null, null, null, null, null),
  ('2b5c9949-0c21-4443-8dca-1e76b48a5063', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '9722a452-fa31-4730-a8c3-6010f2b745fb', 'group', null, null, '3f201e68-5edb-4d27-8316-f1e6b1db85bc', '44d5ab77-3023-45fb-b967-0ec8c3e99a45', 3, null, null, null, null, null),
  ('65a9f1ed-3e93-4a39-a85e-99d997020c65', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '9722a452-fa31-4730-a8c3-6010f2b745fb', 'group', null, null, '3f201e68-5edb-4d27-8316-f1e6b1db85bc', 'bc5be56f-a910-4d9f-bb33-f3dbb48453bc', 3, null, null, null, null, null),
  ('9089ea8e-3fd5-449b-af64-2af18c07f9f2', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '9722a452-fa31-4730-a8c3-6010f2b745fb', 'group', null, null, '3f201e68-5edb-4d27-8316-f1e6b1db85bc', 'e26ad003-f36a-4f45-9292-c64f39be36fb', 3, null, null, null, null, null),
  ('b55d5849-d3a4-4d10-a1b9-7e9d0793b408', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '9722a452-fa31-4730-a8c3-6010f2b745fb', 'group', null, null, '3f201e68-5edb-4d27-8316-f1e6b1db85bc', 'ea768940-fe64-454e-98e1-7c84e73924e2', 3, null, null, null, null, null),
  ('7bdcbf6d-aa5a-4272-886f-c5454afdab78', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '9722a452-fa31-4730-a8c3-6010f2b745fb', 'group', null, null, '4453e121-74bc-4b6b-aeb2-405dd1135479', '44d5ab77-3023-45fb-b967-0ec8c3e99a45', 3, null, null, null, null, null),
  ('1ef0493b-2a49-4a5c-ad97-638d3fc80db2', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '9722a452-fa31-4730-a8c3-6010f2b745fb', 'group', null, null, '4453e121-74bc-4b6b-aeb2-405dd1135479', 'bc5be56f-a910-4d9f-bb33-f3dbb48453bc', 3, null, null, null, null, null),
  ('c69aa4b9-5eb7-480b-917b-2be1ca43005e', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '9722a452-fa31-4730-a8c3-6010f2b745fb', 'group', null, null, '4453e121-74bc-4b6b-aeb2-405dd1135479', 'e26ad003-f36a-4f45-9292-c64f39be36fb', 3, null, null, null, null, null),
  ('5e159186-d57e-4abf-af82-9c5f2702b246', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '9722a452-fa31-4730-a8c3-6010f2b745fb', 'group', null, null, '4453e121-74bc-4b6b-aeb2-405dd1135479', 'ea768940-fe64-454e-98e1-7c84e73924e2', 3, null, null, null, null, null),
  ('b1fd3145-b782-4d44-9af9-553b7a3f537b', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '9722a452-fa31-4730-a8c3-6010f2b745fb', 'group', null, null, '44d5ab77-3023-45fb-b967-0ec8c3e99a45', 'bc5be56f-a910-4d9f-bb33-f3dbb48453bc', 3, null, null, null, null, null),
  ('1ec40460-6d8c-402a-b13e-c829a6aaad67', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '9722a452-fa31-4730-a8c3-6010f2b745fb', 'group', null, null, '44d5ab77-3023-45fb-b967-0ec8c3e99a45', 'e26ad003-f36a-4f45-9292-c64f39be36fb', 3, null, null, null, null, null),
  ('e4ae80da-107b-4ac6-96c6-d4883c1b4f54', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '9722a452-fa31-4730-a8c3-6010f2b745fb', 'group', null, null, '44d5ab77-3023-45fb-b967-0ec8c3e99a45', 'ea768940-fe64-454e-98e1-7c84e73924e2', 3, null, null, null, null, null),
  ('158dfaee-9c2c-4079-9a26-1b263644b1c9', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '9722a452-fa31-4730-a8c3-6010f2b745fb', 'group', null, null, 'bc5be56f-a910-4d9f-bb33-f3dbb48453bc', 'e26ad003-f36a-4f45-9292-c64f39be36fb', 3, null, null, null, null, null),
  ('ea374574-9c09-4581-945c-03bd2f12a4f4', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '9722a452-fa31-4730-a8c3-6010f2b745fb', 'group', null, null, 'bc5be56f-a910-4d9f-bb33-f3dbb48453bc', 'ea768940-fe64-454e-98e1-7c84e73924e2', 3, null, null, null, null, null),
  ('ba6ca877-f56e-4e56-a7c1-d1b272117e73', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', '9722a452-fa31-4730-a8c3-6010f2b745fb', 'group', null, null, 'e26ad003-f36a-4f45-9292-c64f39be36fb', 'ea768940-fe64-454e-98e1-7c84e73924e2', 3, null, null, null, null, null),
  ('1c3d7266-e937-4d39-9161-887eff357a7d', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', null, 'tournament', 1, 0, '3f201e68-5edb-4d27-8316-f1e6b1db85bc', null, 3, null, null, null, null, null),
  ('f2c5dcbb-0385-4b75-8c82-dc38f048a71c', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', null, 'tournament', 1, 1, '4453e121-74bc-4b6b-aeb2-405dd1135479', 'db3efebf-2a6c-4554-8eb1-33f0b009c16b', 3, null, null, null, null, null),
  ('038acf8e-eefd-4c2b-9874-83cea73299fa', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', null, 'tournament', 1, 2, '2ea3a03c-9af2-43aa-9a29-7113445f3e6f', null, 3, null, null, null, null, null),
  ('2804699d-4fb0-46fa-b845-5c117911f279', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', null, 'tournament', 1, 3, '5465739b-bdc2-4ce6-98ce-89d9f904b5cf', '44d5ab77-3023-45fb-b967-0ec8c3e99a45', 3, null, null, null, null, null),
  ('d4c71719-9cce-4e24-b351-7dce786e658f', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', null, 'tournament', 2, 0, '3f201e68-5edb-4d27-8316-f1e6b1db85bc', '4453e121-74bc-4b6b-aeb2-405dd1135479', 5, null, null, null, null, null),
  ('1c496be0-47c8-44d6-bf40-d2911edb2e4e', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', null, 'tournament', 2, 1, '2ea3a03c-9af2-43aa-9a29-7113445f3e6f', '5465739b-bdc2-4ce6-98ce-89d9f904b5cf', 5, null, null, null, null, null),
  ('adec26ad-3700-49ed-bede-1a83e6e562e8', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', null, 'tournament', 3, 0, '3f201e68-5edb-4d27-8316-f1e6b1db85bc', '2ea3a03c-9af2-43aa-9a29-7113445f3e6f', 7, '2026-08-16T12:00:00+00:00', null, null, null, null),
  ('95e7735c-e852-43c0-ab29-6ebf1c04a4ac', 'e15d9961-38a7-4288-bf04-5e2c890f08b4', null, 'tournament', 3, 1, '4453e121-74bc-4b6b-aeb2-405dd1135479', '5465739b-bdc2-4ce6-98ce-89d9f904b5cf', 5, '2026-08-15T12:00:00+00:00', null, null, null, null)
on conflict (id) do nothing;

-- 10. match_results（結果）※ match_id が PK
insert into public.match_results (match_id, team_a_score, team_b_score, winner_team_id, reported_by, potg_a, potg_b, replay_codes) values
  ('7a7d26be-bf77-4edd-8d6e-bbb7f52d61d0', 2, 1, '2ea3a03c-9af2-43aa-9a29-7113445f3e6f', null, 0, 3, array['','','']),
  ('e43c0335-a1c6-4c96-805a-9d79bc346698', 2, 1, '5465739b-bdc2-4ce6-98ce-89d9f904b5cf', null, 0, 3, array['','','']),
  ('b291ac99-51bb-4c65-93c7-d4f5355a2d17', 2, 0, '5465739b-bdc2-4ce6-98ce-89d9f904b5cf', null, 1, 1, array['','']),
  ('94e4d79b-6295-445c-8f55-8be0590d6e34', 2, 0, '2ea3a03c-9af2-43aa-9a29-7113445f3e6f', null, 2, 0, array['','']),
  ('a397f59f-d413-474d-817b-aa3030f20df3', 2, 1, '5edeb7af-35a4-4eba-95d2-aee5452a0165', null, 0, 3, array['','','']),
  ('ace36428-aaab-4c5b-9128-f405fa4e2098', 2, 1, '2ea3a03c-9af2-43aa-9a29-7113445f3e6f', null, 3, 0, array['','','']),
  ('74b2332a-de61-48ab-bd00-084ee73791fe', 1, 2, 'db3efebf-2a6c-4554-8eb1-33f0b009c16b', null, 0, 3, array['','','']),
  ('41a05c4e-caf3-44cc-b7bb-a1f95d360781', 1, 2, 'db3efebf-2a6c-4554-8eb1-33f0b009c16b', null, 1, 2, array['','','']),
  ('384316ae-1257-4eb4-ab7b-2aaf614937dd', 2, 0, '2ea3a03c-9af2-43aa-9a29-7113445f3e6f', null, 1, 1, array['','']),
  ('ac6cc2dd-330f-4dc4-82c7-c0e8ced5d05e', 2, 0, '5465739b-bdc2-4ce6-98ce-89d9f904b5cf', null, 0, 2, array['','']),
  ('4ea68973-62de-44af-8ae9-85a51bc397e6', 0, 2, 'd2fea073-7dba-4f0f-9d4b-a75909343f80', null, 2, 0, array['','']),
  ('959e60a6-092a-43c4-8220-fa9d25b24901', 1, 2, '5edeb7af-35a4-4eba-95d2-aee5452a0165', null, 2, 1, array['','','']),
  ('588ae922-416a-4a8c-80f4-d04e77742d74', 1, 2, 'd2fea073-7dba-4f0f-9d4b-a75909343f80', null, 1, 2, array['','','']),
  ('8d90566c-2909-44c7-9aab-79db52a96493', 1, 2, '8167a302-5704-4296-94fc-53c3c9e7c4db', null, 0, 3, array['','','']),
  ('74ed896d-bfab-4436-abde-1e600c2e4a2f', 1, 2, 'db3efebf-2a6c-4554-8eb1-33f0b009c16b', null, 1, 2, array['','','']),
  ('e65d08aa-cd46-405e-a065-e4dba91d6ff1', 1, 2, '4453e121-74bc-4b6b-aeb2-405dd1135479', null, 3, 0, array['','','']),
  ('2b5c9949-0c21-4443-8dca-1e76b48a5063', 2, 1, '3f201e68-5edb-4d27-8316-f1e6b1db85bc', null, 1, 2, array['','','']),
  ('7bdcbf6d-aa5a-4272-886f-c5454afdab78', 2, 1, '4453e121-74bc-4b6b-aeb2-405dd1135479', null, 0, 3, array['','','']),
  ('65a9f1ed-3e93-4a39-a85e-99d997020c65', 2, 1, '3f201e68-5edb-4d27-8316-f1e6b1db85bc', null, 3, 0, array['','','']),
  ('b1fd3145-b782-4d44-9af9-553b7a3f537b', 2, 0, '44d5ab77-3023-45fb-b967-0ec8c3e99a45', null, 0, 2, array['','']),
  ('1ef0493b-2a49-4a5c-ad97-638d3fc80db2', 1, 2, 'bc5be56f-a910-4d9f-bb33-f3dbb48453bc', null, 3, 0, array['','','']),
  ('1ec40460-6d8c-402a-b13e-c829a6aaad67', 2, 1, '44d5ab77-3023-45fb-b967-0ec8c3e99a45', null, 1, 2, array['','','']),
  ('c69aa4b9-5eb7-480b-917b-2be1ca43005e', 2, 0, '4453e121-74bc-4b6b-aeb2-405dd1135479', null, 0, 2, array['','']),
  ('9089ea8e-3fd5-449b-af64-2af18c07f9f2', 2, 0, '3f201e68-5edb-4d27-8316-f1e6b1db85bc', null, 2, 0, array['','']),
  ('b55d5849-d3a4-4d10-a1b9-7e9d0793b408', 2, 0, '3f201e68-5edb-4d27-8316-f1e6b1db85bc', null, 1, 1, array['','']),
  ('ea374574-9c09-4581-945c-03bd2f12a4f4', 2, 1, 'bc5be56f-a910-4d9f-bb33-f3dbb48453bc', null, 2, 1, array['','','']),
  ('158dfaee-9c2c-4079-9a26-1b263644b1c9', 1, 2, 'e26ad003-f36a-4f45-9292-c64f39be36fb', null, 1, 2, array['','','']),
  ('e4ae80da-107b-4ac6-96c6-d4883c1b4f54', 0, 2, 'ea768940-fe64-454e-98e1-7c84e73924e2', null, 0, 2, array['','']),
  ('5e159186-d57e-4abf-af82-9c5f2702b246', 1, 2, 'ea768940-fe64-454e-98e1-7c84e73924e2', null, 1, 2, array['','','']),
  ('ba6ca877-f56e-4e56-a7c1-d1b272117e73', 2, 1, 'e26ad003-f36a-4f45-9292-c64f39be36fb', null, 3, 0, array['','','']),
  ('f2c5dcbb-0385-4b75-8c82-dc38f048a71c', 2, 0, '4453e121-74bc-4b6b-aeb2-405dd1135479', null, 1, 1, array['','']),
  ('2804699d-4fb0-46fa-b845-5c117911f279', 2, 0, '5465739b-bdc2-4ce6-98ce-89d9f904b5cf', null, 0, 2, array['','']),
  ('d4c71719-9cce-4e24-b351-7dce786e658f', 3, 0, '3f201e68-5edb-4d27-8316-f1e6b1db85bc', null, 2, 1, array['','','']),
  ('1c496be0-47c8-44d6-bf40-d2911edb2e4e', 3, 2, '2ea3a03c-9af2-43aa-9a29-7113445f3e6f', null, 3, 2, array['','','','','']),
  ('adec26ad-3700-49ed-bede-1a83e6e562e8', 4, 2, '3f201e68-5edb-4d27-8316-f1e6b1db85bc', null, 3, 3, array['','','','','','']),
  ('95e7735c-e852-43c0-ab29-6ebf1c04a4ac', 3, 1, '4453e121-74bc-4b6b-aeb2-405dd1135479', null, 2, 2, array['','','',''])
on conflict (match_id) do nothing;

-- 11. current_count を実チーム数に合わせる（承認済みチーム数）
update public.events set current_count = 12 where id = 'e15d9961-38a7-4288-bf04-5e2c890f08b4';

-- 完了。観戦ビュー: /events/event-mpvbcd/watch
