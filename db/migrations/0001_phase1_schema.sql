-- Source: client-files/基本設計書/DB/jancube_phase1.sql (v0.2, 2026-10-01)
-- Change: removed ck_store_business_hours_5 CHECK (weekday IN (0,1)) (tracker #19). ck_store_business_hours_1 keeps 0-6.

-- 雀CUBE Phase 1 DB設計案 v0.2 議事録反映 / 2026-10-01
-- MySQL 8.4 / InnoDB / UTC / JPY
-- 確定仕様: 電話不要LINE予約 / 店舗鍵 / 部屋料金 / 活動記録 / 予約変更履歴
-- 時刻による変更禁止・氏名変更権限・通知/領収書の発行契機はアプリ実装契約。
-- 詳細・未決事項は同版のテーブル定義書「確認事項」「設計ルール」を参照。
-- 新規の空スキーマに適用。既存DBへの移行・ALTER差分ではない。
-- 必ず選択中のDBを確認し、検証環境で実行する。自動DROPは含まない。
SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- 店舗 / C-01,A-18
CREATE TABLE `stores` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部ID',
  `code` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '店舗コード',
  `name` VARCHAR(100) NOT NULL COMMENT '店舗名',
  `address` VARCHAR(500) NOT NULL COMMENT '店舗住所',
  `phone` VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT '店舗電話番号',
  `access_text` VARCHAR(1000) NULL COMMENT 'アクセス案内',
  `notice_text` TEXT NULL COMMENT '注意事項',
  `map_url` VARCHAR(1000) NULL COMMENT '地図URL',
  `entry_guide_url` VARCHAR(1000) NULL COMMENT '入室案内画像URL',
  `entry_guide_text` TEXT NULL COMMENT '入室手順',
  `timezone` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'Asia/Tokyo' COMMENT 'タイムゾーン',
  `booking_open_date` DATE NOT NULL COMMENT '新システム受付開始日',
  `booking_horizon_days` SMALLINT UNSIGNED NOT NULL COMMENT '何日先まで予約受付',
  `hold_minutes` SMALLINT UNSIGNED NOT NULL COMMENT '顧客仮押さえ時間',
  `proxy_hold_minutes` SMALLINT UNSIGNED NOT NULL COMMENT '代理予約仮押さえ時間',
  `cleaning_buffer_minutes` SMALLINT UNSIGNED NOT NULL COMMENT '予約間清掃バッファ',
  `room_finalize_minutes` SMALLINT UNSIGNED NULL COMMENT '開始前最終確定の目安',
  `key_before_minutes` SMALLINT UNSIGNED NOT NULL COMMENT '開始前の鍵有効時間',
  `key_after_minutes` SMALLINT UNSIGNED NOT NULL COMMENT '終了後の鍵有効時間',
  `status` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'preparing' COMMENT '営業状態',
  `is_active` TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '公開・有効',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '作成日時(UTC)',
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新日時(UTC)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_stores_1` (`code`),
  CONSTRAINT `ck_stores_1` CHECK (booking_horizon_days > 0),
  CONSTRAINT `ck_stores_2` CHECK (hold_minutes > 0),
  CONSTRAINT `ck_stores_3` CHECK (proxy_hold_minutes > 0),
  CONSTRAINT `ck_stores_4` CHECK (status IN ('preparing','open','closed')),
  CONSTRAINT `ck_stores_5` CHECK (is_active IN (0,1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='店舗';

-- 店舗の通常営業時間 / C-02,A-18
CREATE TABLE `store_business_hours` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部ID',
  `store_id` BIGINT UNSIGNED NOT NULL COMMENT '店舗ID',
  `weekday` TINYINT UNSIGNED NOT NULL COMMENT '曜日',
  `opens_minute` SMALLINT UNSIGNED NOT NULL COMMENT '営業開始(分)',
  `closes_minute` SMALLINT UNSIGNED NOT NULL COMMENT '営業終了(分)',
  `is_closed` TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '定休日',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '作成日時(UTC)',
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新日時(UTC)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_store_business_hours_1` (`store_id`, `weekday`),
  CONSTRAINT `ck_store_business_hours_1` CHECK (weekday BETWEEN 0 AND 6),
  CONSTRAINT `ck_store_business_hours_2` CHECK (opens_minute <= 1440),
  CONSTRAINT `ck_store_business_hours_3` CHECK (closes_minute <= 2880),
  CONSTRAINT `ck_store_business_hours_4` CHECK (is_closed = 1 OR closes_minute > opens_minute),
  CONSTRAINT `ck_store_business_hours_6` CHECK (is_closed IN (0,1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='店舗の通常営業時間';

-- 店舗休業日・特別営業時間 / C-02,A-18,A-22
CREATE TABLE `store_calendar_days` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部ID',
  `store_id` BIGINT UNSIGNED NOT NULL COMMENT '店舗ID',
  `business_date` DATE NOT NULL COMMENT '営業日',
  `is_closed` TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '休業日',
  `is_holiday` TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '料金計算上の祝日',
  `opens_minute` SMALLINT UNSIGNED NULL COMMENT '特別営業開始',
  `closes_minute` SMALLINT UNSIGNED NULL COMMENT '特別営業終了',
  `reason` VARCHAR(500) NULL COMMENT '設定理由',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '作成日時(UTC)',
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新日時(UTC)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_store_calendar_days_1` (`store_id`, `business_date`),
  CONSTRAINT `ck_store_calendar_days_1` CHECK ((opens_minute IS NULL AND closes_minute IS NULL) OR (opens_minute IS NOT NULL AND closes_minute IS NOT NULL AND closes_minute > opens_minute AND closes_minute <= 2880)),
  CONSTRAINT `ck_store_calendar_days_2` CHECK (is_closed IN (0,1)),
  CONSTRAINT `ck_store_calendar_days_3` CHECK (is_holiday IN (0,1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='店舗休業日・特別営業時間';

-- 部屋タイプ / C-03,A-19
CREATE TABLE `room_types` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部ID',
  `code` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'タイプコード',
  `name` VARCHAR(100) NOT NULL COMMENT '4麻/3麻/コンセプト/VIP',
  `capacity` SMALLINT UNSIGNED NOT NULL COMMENT '利用人数上限',
  `is_active` TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '有効',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '作成日時(UTC)',
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新日時(UTC)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_room_types_1` (`code`),
  CONSTRAINT `ck_room_types_1` CHECK (capacity > 0),
  CONSTRAINT `ck_room_types_2` CHECK (is_active IN (0,1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='部屋タイプ';

-- 予約・在庫グループ / C-03,A-19
CREATE TABLE `room_groups` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部ID',
  `store_id` BIGINT UNSIGNED NOT NULL COMMENT '店舗ID',
  `room_type_id` BIGINT UNSIGNED NOT NULL COMMENT '部屋タイプID',
  `code` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'グループコード',
  `name` VARCHAR(100) NOT NULL COMMENT 'グループ名',
  `booking_mode` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'group' COMMENT '選択方式',
  `sort_order` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '表示順',
  `is_active` TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '有効',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '作成日時(UTC)',
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新日時(UTC)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_room_groups_1` (`store_id`, `code`),
  UNIQUE KEY `uq_room_groups_2` (`id`, `store_id`),
  UNIQUE KEY `uq_room_groups_3` (`id`, `store_id`, `room_type_id`),
  KEY `ix_room_groups_1` (`room_type_id`),
  CONSTRAINT `ck_room_groups_1` CHECK (booking_mode IN ('group','named')),
  CONSTRAINT `ck_room_groups_2` CHECK (is_active IN (0,1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='予約・在庫グループ';

-- 部屋 / C-03,A-19
CREATE TABLE `rooms` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部ID',
  `store_id` BIGINT UNSIGNED NOT NULL COMMENT '店舗ID',
  `room_group_id` BIGINT UNSIGNED NOT NULL COMMENT '在庫グループID',
  `room_type_id` BIGINT UNSIGNED NOT NULL COMMENT '部屋タイプID',
  `code` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '部屋番号',
  `name` VARCHAR(100) NOT NULL COMMENT '表示名',
  `description` TEXT NULL COMMENT '紹介文',
  `operating_status` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'active' COMMENT '稼働状態',
  `cleaning_status` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'dirty' COMMENT '現在の清掃状態',
  `last_cleaned_at` DATETIME(6) NULL COMMENT '最終清掃完了日時',
  `is_named_booking` TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '指名対象',
  `is_vip_candidate` TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'VIP候補',
  `sort_order` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '表示順',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '作成日時(UTC)',
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新日時(UTC)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_rooms_1` (`store_id`, `code`),
  UNIQUE KEY `uq_rooms_2` (`id`, `store_id`),
  UNIQUE KEY `uq_rooms_3` (`id`, `store_id`, `room_group_id`),
  KEY `ix_rooms_1` (`room_group_id`, `store_id`, `room_type_id`),
  CONSTRAINT `ck_rooms_1` CHECK (operating_status IN ('active','paused','broken')),
  CONSTRAINT `ck_rooms_2` CHECK (cleaning_status IN ('dirty','clean')),
  CONSTRAINT `ck_rooms_3` CHECK (is_named_booking IN (0,1)),
  CONSTRAINT `ck_rooms_4` CHECK (is_vip_candidate IN (0,1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='部屋';

-- 部屋写真 / C-03,A-19
CREATE TABLE `room_photos` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部ID',
  `room_id` BIGINT UNSIGNED NOT NULL COMMENT '部屋ID',
  `asset_url` VARCHAR(1000) NOT NULL COMMENT '写真URL',
  `alt_text` VARCHAR(250) NULL COMMENT '写真説明',
  `sort_order` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '表示順',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '作成日時(UTC)',
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新日時(UTC)',
  PRIMARY KEY (`id`),
  KEY `ix_room_photos_1` (`room_id`, `sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='部屋写真';

-- 運営スタッフ / A-01,A-23,K-01
CREATE TABLE `staff` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部ID',
  `email_normalized` VARCHAR(254) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'ログインメール',
  `name` VARCHAR(100) NOT NULL COMMENT '氏名',
  `password_hash` VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT 'パスワードハッシュ',
  `status` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'invited' COMMENT '状態',
  `last_login_at` DATETIME(6) NULL COMMENT '最終ログイン',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '作成日時(UTC)',
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新日時(UTC)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_staff_1` (`email_normalized`),
  CONSTRAINT `ck_staff_1` CHECK (status IN ('invited','active','disabled'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='運営スタッフ';

-- 運営ロール / A-23,K-01
CREATE TABLE `roles` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部ID',
  `code` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'ロールコード',
  `name` VARCHAR(100) NOT NULL COMMENT 'ロール名（種類は未確定）',
  `allow_global_scope` TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '全店権限付与可',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '作成日時(UTC)',
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新日時(UTC)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_roles_1` (`code`),
  CONSTRAINT `ck_roles_1` CHECK (allow_global_scope IN (0,1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='運営ロール';

-- 操作権限 / A-23
CREATE TABLE `permissions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部ID',
  `code` VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '権限コード',
  `name` VARCHAR(200) NOT NULL COMMENT '権限名',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '作成日時(UTC)',
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新日時(UTC)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_permissions_1` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='操作権限';

-- ロール別権限 / A-23
CREATE TABLE `role_permissions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部ID',
  `role_id` BIGINT UNSIGNED NOT NULL COMMENT 'ロールID',
  `permission_id` BIGINT UNSIGNED NOT NULL COMMENT '権限ID',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '作成日時(UTC)',
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新日時(UTC)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_role_permissions_1` (`role_id`, `permission_id`),
  KEY `ix_role_permissions_1` (`permission_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='ロール別権限';

-- スタッフのロール・店舗権限 / A-23,K-01
CREATE TABLE `staff_role_grants` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部ID',
  `staff_id` BIGINT UNSIGNED NOT NULL COMMENT 'スタッフID',
  `role_id` BIGINT UNSIGNED NOT NULL COMMENT 'ロールID',
  `store_id` BIGINT UNSIGNED NULL COMMENT '店舗ID',
  `scope_store_key` BIGINT UNSIGNED GENERATED ALWAYS AS (COALESCE(store_id,0)) STORED COMMENT '一意制約用店舗キー',
  `granted_by` BIGINT UNSIGNED NULL COMMENT '付与者',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '作成日時(UTC)',
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新日時(UTC)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_staff_role_grants_1` (`staff_id`, `role_id`, `scope_store_key`),
  KEY `ix_staff_role_grants_1` (`role_id`),
  KEY `ix_staff_role_grants_2` (`store_id`),
  KEY `ix_staff_role_grants_3` (`granted_by`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='スタッフのロール・店舗権限';

-- スタッフ招待・パスワード再設定 / A-01,A-23,A-30
CREATE TABLE `staff_auth_tokens` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部ID',
  `staff_id` BIGINT UNSIGNED NOT NULL COMMENT '対象スタッフ',
  `purpose` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '用途',
  `token_hash` BINARY(32) NOT NULL COMMENT 'トークンのハッシュ',
  `expires_at` DATETIME(6) NOT NULL COMMENT '有効期限',
  `used_at` DATETIME(6) NULL COMMENT '利用済日時',
  `attempt_count` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '試行数',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '作成日時(UTC)',
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新日時(UTC)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_staff_auth_tokens_1` (`token_hash`),
  KEY `ix_staff_auth_tokens_1` (`expires_at`),
  KEY `ix_staff_auth_tokens_2` (`staff_id`),
  CONSTRAINT `ck_staff_auth_tokens_1` CHECK (expires_at > created_at),
  CONSTRAINT `ck_staff_auth_tokens_2` CHECK (purpose IN ('invite','password_reset'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='スタッフ招待・パスワード再設定';

-- 会員 / C-05,C-07,C-17,A-11,A-12
CREATE TABLE `members` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部ID',
  `member_code` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '会員コード',
  `phone_e164` VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT '携帯電話番号(E.164)',
  `phone_verified_at` DATETIME(6) NULL COMMENT '電話番号認証日時',
  `family_name` VARCHAR(100) NULL COMMENT '姓',
  `given_name` VARCHAR(100) NULL COMMENT '名',
  `email_normalized` VARCHAR(254) NULL COMMENT 'メール(任意)',
  `email_verified_at` DATETIME(6) NULL COMMENT 'メール認証日時',
  `status` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'active' COMMENT '状態',
  `registration_source` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT '登録時流入元',
  `withdrawn_at` DATETIME(6) NULL COMMENT '退会日時',
  `anonymized_at` DATETIME(6) NULL COMMENT '匿名化日時',
  `identity_kind` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'phone' COMMENT '本人確認の基準',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '作成日時(UTC)',
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新日時(UTC)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_members_1` (`member_code`),
  UNIQUE KEY `uq_members_2` (`phone_e164`),
  KEY `ix_members_1` (`email_normalized`),
  KEY `ix_members_2` (`status`, `created_at`),
  CONSTRAINT `ck_members_1` CHECK (status = 'withdrawn' OR (family_name IS NOT NULL AND given_name IS NOT NULL AND (identity_kind = 'line' OR (phone_e164 IS NOT NULL AND phone_verified_at IS NOT NULL)))),
  CONSTRAINT `ck_members_2` CHECK (status IN ('active','caution','suspended','withdrawn')),
  CONSTRAINT `ck_members_3` CHECK (identity_kind IN ('phone','line'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='会員';

-- 顧客認証チャレンジ / C-05,C-06,C-08,C-22,L-03
CREATE TABLE `auth_challenges` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部ID',
  `public_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '公開チャレンジID',
  `member_id` BIGINT UNSIGNED NULL COMMENT '会員ID',
  `purpose` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '用途',
  `phone_e164` VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT '認証電話番号',
  `email_normalized` VARCHAR(254) NULL COMMENT '認証メール',
  `secret_hash` BINARY(32) NOT NULL COMMENT 'OTP/リンクの検証ハッシュ',
  `status` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'pending' COMMENT '状態',
  `expires_at` DATETIME(6) NOT NULL COMMENT '期限',
  `verified_at` DATETIME(6) NULL COMMENT '成功日時',
  `attempt_count` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '失敗回数',
  `max_attempts` INT UNSIGNED NOT NULL COMMENT '最大試行回数',
  `resend_after` DATETIME(6) NOT NULL COMMENT '再送可能日時',
  `provider_request_id` VARCHAR(191) NULL COMMENT 'SMS事業者要求ID',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '作成日時(UTC)',
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新日時(UTC)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_auth_challenges_1` (`public_id`),
  KEY `ix_auth_challenges_1` (`phone_e164`, `created_at`),
  KEY `ix_auth_challenges_2` (`expires_at`, `status`),
  KEY `ix_auth_challenges_3` (`member_id`),
  CONSTRAINT `ck_auth_challenges_1` CHECK (max_attempts > 0),
  CONSTRAINT `ck_auth_challenges_2` CHECK (attempt_count <= max_attempts),
  CONSTRAINT `ck_auth_challenges_3` CHECK (expires_at > created_at),
  CONSTRAINT `ck_auth_challenges_4` CHECK (purpose IN ('sms_login','phone_change','email_verify','legacy_verify')),
  CONSTRAINT `ck_auth_challenges_5` CHECK (status IN ('pending','verified','expired','locked'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='顧客認証チャレンジ';

-- 有効なLINE連携 / C-17,L-02,L-03
CREATE TABLE `member_line_links` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部ID',
  `member_id` BIGINT UNSIGNED NOT NULL COMMENT '会員ID',
  `provider_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'LINE provider ID',
  `line_user_id` VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'LINE user ID',
  `friend_status` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'unknown' COMMENT '友だち状態',
  `linked_at` DATETIME(6) NOT NULL COMMENT '連携日時',
  `status_checked_at` DATETIME(6) NULL COMMENT '友だち状態確認',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '作成日時(UTC)',
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新日時(UTC)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_member_line_links_1` (`member_id`),
  UNIQUE KEY `uq_member_line_links_2` (`provider_id`, `line_user_id`),
  CONSTRAINT `ck_member_line_links_1` CHECK (friend_status IN ('unknown','friend','blocked'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='有効なLINE連携';

-- 規約・ポリシーの版 / C-07,C-20
CREATE TABLE `legal_documents` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部ID',
  `document_type` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '種別',
  `version` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '版番号',
  `title` VARCHAR(200) NOT NULL COMMENT '文書名',
  `content_url` VARCHAR(1000) NOT NULL COMMENT '本文参照URL',
  `content_sha256` BINARY(32) NOT NULL COMMENT '本文ハッシュ',
  `published_at` DATETIME(6) NOT NULL COMMENT '公開日時',
  `effective_at` DATETIME(6) NOT NULL COMMENT '適用日時',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '作成日時(UTC)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_legal_documents_1` (`document_type`, `version`),
  CONSTRAINT `ck_legal_documents_1` CHECK (document_type IN ('terms','privacy','cancellation_policy','age_declaration'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='規約・ポリシーの版';

-- 会員同意履歴 / C-07,C-20
CREATE TABLE `member_consents` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部ID',
  `member_id` BIGINT UNSIGNED NOT NULL COMMENT '会員ID',
  `legal_document_id` BIGINT UNSIGNED NOT NULL COMMENT '同意文書版ID',
  `agreed_at` DATETIME(6) NOT NULL COMMENT '同意日時',
  `channel` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '同意経路',
  `request_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT '要求追跡ID',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '作成日時(UTC)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_member_consents_1` (`member_id`, `legal_document_id`),
  KEY `ix_member_consents_1` (`legal_document_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='会員同意履歴';

-- CS対応記録 / A-12
CREATE TABLE `member_notes` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部ID',
  `member_id` BIGINT UNSIGNED NOT NULL COMMENT '会員ID',
  `booking_id` BIGINT UNSIGNED NULL COMMENT '関連予約',
  `staff_id` BIGINT UNSIGNED NOT NULL COMMENT '担当者',
  `body` TEXT NOT NULL COMMENT '対応内容',
  `occurred_at` DATETIME(6) NOT NULL COMMENT '対応日時',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '作成日時(UTC)',
  PRIMARY KEY (`id`),
  KEY `ix_member_notes_1` (`member_id`, `occurred_at`),
  KEY `ix_member_notes_2` (`booking_id`),
  KEY `ix_member_notes_3` (`staff_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='CS対応記録';

-- 料金プロファイル / A-16
CREATE TABLE `price_profiles` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部ID',
  `code` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '料金コード',
  `name` VARCHAR(200) NOT NULL COMMENT 'パターン名',
  `is_active` TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '有効',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '作成日時(UTC)',
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新日時(UTC)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_price_profiles_1` (`code`),
  CONSTRAINT `ck_price_profiles_1` CHECK (is_active IN (0,1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='料金プロファイル';

-- 料金プロファイル版 / A-16
CREATE TABLE `price_profile_versions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部ID',
  `price_profile_id` BIGINT UNSIGNED NOT NULL COMMENT '料金プロファイル',
  `version_no` INT UNSIGNED NOT NULL COMMENT '版番号',
  `status` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'draft' COMMENT '公開状態',
  `hourly_amount` BIGINT NOT NULL COMMENT '時間単価',
  `minimum_minutes` SMALLINT UNSIGNED NOT NULL COMMENT '最低利用時間(分)',
  `valid_from` DATETIME(6) NOT NULL COMMENT '適用開始',
  `valid_to` DATETIME(6) NULL COMMENT '適用終了',
  `tax_rate` DECIMAL(5,2) NOT NULL COMMENT '消費税率(%)',
  `published_by` BIGINT UNSIGNED NULL COMMENT '公開者',
  `published_at` DATETIME(6) NULL COMMENT '公開日時',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '作成日時(UTC)',
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新日時(UTC)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_price_profile_versions_1` (`price_profile_id`, `version_no`),
  KEY `ix_price_profile_versions_1` (`published_by`),
  CONSTRAINT `ck_price_profile_versions_1` CHECK (version_no > 0),
  CONSTRAINT `ck_price_profile_versions_2` CHECK (minimum_minutes > 0 AND MOD(minimum_minutes,30)=0),
  CONSTRAINT `ck_price_profile_versions_3` CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT `ck_price_profile_versions_4` CHECK (tax_rate BETWEEN 0 AND 100),
  CONSTRAINT `ck_price_profile_versions_5` CHECK (status IN ('draft','published','retired')),
  CONSTRAINT `ck_price_profile_versions_6` CHECK (hourly_amount >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='料金プロファイル版';

-- 曜日・時間帯料金ルール / A-16,C-03
CREATE TABLE `price_time_rules` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部ID',
  `price_version_id` BIGINT UNSIGNED NOT NULL COMMENT '料金版ID',
  `weekday_mask` TINYINT UNSIGNED NOT NULL COMMENT '曜日ビット',
  `holiday_mode` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'any' COMMENT '祝日適用',
  `start_minute` SMALLINT UNSIGNED NULL COMMENT '開始時刻条件(分)',
  `end_minute` SMALLINT UNSIGNED NULL COMMENT '終了時刻条件(分)',
  `hourly_discount_amount` BIGINT NOT NULL DEFAULT 0 COMMENT '1時間当たり値引',
  `priority` INT UNSIGNED NOT NULL COMMENT '適用優先順位',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '作成日時(UTC)',
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新日時(UTC)',
  PRIMARY KEY (`id`),
  KEY `ix_price_time_rules_1` (`price_version_id`),
  CONSTRAINT `ck_price_time_rules_1` CHECK (weekday_mask BETWEEN 1 AND 127),
  CONSTRAINT `ck_price_time_rules_2` CHECK ((start_minute IS NULL AND end_minute IS NULL) OR (start_minute IS NOT NULL AND end_minute IS NOT NULL AND end_minute > start_minute AND end_minute <= 2880)),
  CONSTRAINT `ck_price_time_rules_3` CHECK (holiday_mode IN ('any','only','exclude')),
  CONSTRAINT `ck_price_time_rules_4` CHECK (hourly_discount_amount >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='曜日・時間帯料金ルール';

-- 時間パック料金 / A-16,C-03
CREATE TABLE `price_packages` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部ID',
  `price_version_id` BIGINT UNSIGNED NOT NULL COMMENT '料金版ID',
  `duration_minutes` SMALLINT UNSIGNED NOT NULL COMMENT 'パック利用時間(分)',
  `package_amount` BIGINT NOT NULL COMMENT 'パック料金',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '作成日時(UTC)',
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新日時(UTC)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_price_packages_1` (`price_version_id`, `duration_minutes`),
  CONSTRAINT `ck_price_packages_1` CHECK (duration_minutes > 0 AND MOD(duration_minutes,30)=0),
  CONSTRAINT `ck_price_packages_2` CHECK (package_amount >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='時間パック料金';

-- 料金適用先 / A-16,A-19
CREATE TABLE `price_assignments` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部ID',
  `price_version_id` BIGINT UNSIGNED NOT NULL COMMENT '料金版ID',
  `room_id` BIGINT UNSIGNED NOT NULL COMMENT '個別部屋',
  `valid_from` DATETIME(6) NOT NULL COMMENT '適用開始',
  `valid_to` DATETIME(6) NULL COMMENT '適用終了',
  `priority` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '優先順位',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '作成日時(UTC)',
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新日時(UTC)',
  PRIMARY KEY (`id`),
  KEY `ix_price_assignments_1` (`room_id`, `valid_from`),
  KEY `ix_price_assignments_2` (`price_version_id`),
  CONSTRAINT `ck_price_assignments_1` CHECK (valid_to IS NULL OR valid_to > valid_from)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='料金適用先';

-- 予約・仮押さえ / C-04,C-11,C-12,C-13,C-18,A-03,A-04,A-05,A-06
CREATE TABLE `bookings` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部ID',
  `booking_code` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '予約番号',
  `store_id` BIGINT UNSIGNED NOT NULL COMMENT '店舗ID',
  `room_group_id` BIGINT UNSIGNED NOT NULL COMMENT '在庫グループID',
  `member_id` BIGINT UNSIGNED NULL COMMENT '予約顧客ID（電話またはLINE）',
  `requested_room_id` BIGINT UNSIGNED NULL COMMENT '指名部屋ID',
  `business_date` DATE NOT NULL COMMENT '利用営業日(店舗時刻)',
  `starts_at` DATETIME(6) NOT NULL COMMENT '利用開始(UTC)',
  `ends_at` DATETIME(6) NOT NULL COMMENT '利用終了(UTC)',
  `guest_count` SMALLINT UNSIGNED NOT NULL COMMENT '人数',
  `status` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'draft' COMMENT '予約状態',
  `source` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'web' COMMENT '作成経路',
  `created_by_staff_id` BIGINT UNSIGNED NULL COMMENT '代理作成者',
  `client_request_key` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '作成冪等キー',
  `hold_expires_at` DATETIME(6) NULL COMMENT '仮押さえ期限',
  `confirmed_at` DATETIME(6) NULL COMMENT '予約確定日時',
  `completed_at` DATETIME(6) NULL COMMENT '利用終了処理日時',
  `contact_family_name` VARCHAR(100) NULL COMMENT '予約時の姓',
  `contact_given_name` VARCHAR(100) NULL COMMENT '予約時の名',
  `contact_phone_e164` VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT '予約時連絡電話',
  `contact_email` VARCHAR(254) NULL COMMENT '予約時メール',
  `acquisition_source` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT '流入元区分',
  `utm_source` VARCHAR(191) NULL COMMENT 'UTM source',
  `utm_medium` VARCHAR(191) NULL COMMENT 'UTM medium',
  `utm_campaign` VARCHAR(191) NULL COMMENT 'UTM campaign',
  `utm_content` VARCHAR(191) NULL COMMENT 'UTM content',
  `policy_document_id` BIGINT UNSIGNED NULL COMMENT 'キャンセルポリシー版',
  `policy_agreed_at` DATETIME(6) NULL COMMENT '予約ポリシー同意日時',
  `subtotal_amount` BIGINT NOT NULL DEFAULT 0 COMMENT 'クーポン前税込金額',
  `discount_amount` BIGINT NOT NULL DEFAULT 0 COMMENT 'クーポン値引',
  `total_amount` BIGINT NOT NULL DEFAULT 0 COMMENT '予約税込金額',
  `lock_version` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '楽観ロック版',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '作成日時(UTC)',
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新日時(UTC)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_bookings_1` (`booking_code`),
  UNIQUE KEY `uq_bookings_2` (`client_request_key`),
  UNIQUE KEY `uq_bookings_3` (`id`, `store_id`, `room_group_id`),
  UNIQUE KEY `uq_bookings_4` (`id`, `store_id`),
  KEY `ix_bookings_1` (`member_id`, `starts_at`),
  KEY `ix_bookings_2` (`store_id`, `business_date`, `status`),
  KEY `ix_bookings_3` (`room_group_id`, `starts_at`, `ends_at`, `status`),
  KEY `ix_bookings_4` (`status`, `hold_expires_at`),
  KEY `ix_bookings_5` (`room_group_id`, `store_id`),
  KEY `ix_bookings_6` (`requested_room_id`, `store_id`, `room_group_id`),
  KEY `ix_bookings_7` (`created_by_staff_id`),
  KEY `ix_bookings_8` (`policy_document_id`),
  CONSTRAINT `ck_bookings_1` CHECK (ends_at > starts_at),
  CONSTRAINT `ck_bookings_2` CHECK (guest_count > 0),
  CONSTRAINT `ck_bookings_3` CHECK (discount_amount <= subtotal_amount),
  CONSTRAINT `ck_bookings_4` CHECK (total_amount = subtotal_amount - discount_amount),
  CONSTRAINT `ck_bookings_5` CHECK (status <> 'draft' OR hold_expires_at IS NOT NULL),
  CONSTRAINT `ck_bookings_6` CHECK (status NOT IN ('confirmed','completed') OR (member_id IS NOT NULL AND confirmed_at IS NOT NULL AND policy_document_id IS NOT NULL AND policy_agreed_at IS NOT NULL)),
  CONSTRAINT `ck_bookings_7` CHECK (source <> 'proxy' OR created_by_staff_id IS NOT NULL),
  CONSTRAINT `ck_bookings_8` CHECK (status IN ('draft','confirmed','completed','canceled','expired')),
  CONSTRAINT `ck_bookings_9` CHECK (source IN ('web','liff','line','proxy')),
  CONSTRAINT `ck_bookings_10` CHECK (subtotal_amount >= 0),
  CONSTRAINT `ck_bookings_11` CHECK (discount_amount >= 0),
  CONSTRAINT `ck_bookings_12` CHECK (total_amount >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='予約・仮押さえ';

-- 在庫更新の排他キー / C-03,A-03,A-07,A-22
CREATE TABLE `inventory_day_locks` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部ID',
  `room_group_id` BIGINT UNSIGNED NOT NULL COMMENT '在庫グループ',
  `business_date` DATE NOT NULL COMMENT '営業日',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '作成日時(UTC)',
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新日時(UTC)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_inventory_day_locks_1` (`room_group_id`, `business_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='在庫更新の排他キー';

-- 部屋割当履歴 / A-03,A-07,C-11,C-13
CREATE TABLE `booking_assignments` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部ID',
  `booking_id` BIGINT UNSIGNED NOT NULL COMMENT '予約ID',
  `store_id` BIGINT UNSIGNED NOT NULL COMMENT '店舗ID',
  `room_group_id` BIGINT UNSIGNED NOT NULL COMMENT 'グループID',
  `room_id` BIGINT UNSIGNED NOT NULL COMMENT '割当部屋ID',
  `assignment_status` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'provisional' COMMENT '割当段階',
  `assigned_at` DATETIME(6) NOT NULL COMMENT '割当日時',
  `finalized_at` DATETIME(6) NULL COMMENT '最終確定日時',
  `released_at` DATETIME(6) NULL COMMENT '割当解放日時',
  `source` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'batch' COMMENT '割当経路',
  `staff_id` BIGINT UNSIGNED NULL COMMENT '操作スタッフ',
  `reason` VARCHAR(500) NULL COMMENT '変更理由',
  `active_booking_id` BIGINT UNSIGNED GENERATED ALWAYS AS (CASE WHEN released_at IS NULL THEN booking_id ELSE NULL END) STORED COMMENT '現在割当一意キー',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '作成日時(UTC)',
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新日時(UTC)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_booking_assignments_1` (`active_booking_id`),
  UNIQUE KEY `uq_booking_assignments_2` (`id`, `booking_id`),
  KEY `ix_booking_assignments_1` (`room_id`, `released_at`),
  KEY `ix_booking_assignments_2` (`booking_id`, `store_id`, `room_group_id`),
  KEY `ix_booking_assignments_3` (`room_id`, `store_id`, `room_group_id`),
  KEY `ix_booking_assignments_4` (`staff_id`),
  CONSTRAINT `ck_booking_assignments_1` CHECK (released_at IS NULL OR released_at >= assigned_at),
  CONSTRAINT `ck_booking_assignments_2` CHECK (assignment_status <> 'final' OR finalized_at IS NOT NULL),
  CONSTRAINT `ck_booking_assignments_3` CHECK (assignment_status IN ('provisional','final')),
  CONSTRAINT `ck_booking_assignments_4` CHECK (source IN ('batch','manual','named'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='部屋割当履歴';

-- 予約受付不可枠 / A-22
CREATE TABLE `room_blocks` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部ID',
  `room_id` BIGINT UNSIGNED NOT NULL COMMENT '対象部屋',
  `starts_at` DATETIME(6) NOT NULL COMMENT 'ブロック開始',
  `ends_at` DATETIME(6) NOT NULL COMMENT 'ブロック終了',
  `reason` VARCHAR(500) NOT NULL COMMENT '理由',
  `created_by` BIGINT UNSIGNED NOT NULL COMMENT '登録者',
  `released_at` DATETIME(6) NULL COMMENT '解除日時',
  `released_by` BIGINT UNSIGNED NULL COMMENT '解除者',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '作成日時(UTC)',
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新日時(UTC)',
  PRIMARY KEY (`id`),
  KEY `ix_room_blocks_1` (`room_id`, `starts_at`, `ends_at`),
  KEY `ix_room_blocks_2` (`created_by`),
  KEY `ix_room_blocks_3` (`released_by`),
  CONSTRAINT `ck_room_blocks_1` CHECK (ends_at > starts_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='予約受付不可枠';

-- 料金計算スナップショット / A-05,A-17,C-04,C-09
CREATE TABLE `price_calculations` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部ID',
  `booking_id` BIGINT UNSIGNED NOT NULL COMMENT '予約ID',
  `price_version_id` BIGINT UNSIGNED NOT NULL COMMENT '適用料金版',
  `revision_no` INT UNSIGNED NOT NULL COMMENT '計算版',
  `duration_minutes` INT UNSIGNED NOT NULL COMMENT '利用分数',
  `base_amount` BIGINT NOT NULL COMMENT '時間単価計算額',
  `package_discount_amount` BIGINT NOT NULL COMMENT 'パック値引',
  `time_discount_amount` BIGINT NOT NULL COMMENT '時間帯値引',
  `coupon_discount_amount` BIGINT NOT NULL COMMENT 'クーポン値引',
  `total_amount` BIGINT NOT NULL COMMENT '最終税込金額',
  `tax_rate` DECIMAL(5,2) NOT NULL COMMENT '適用税率(%)',
  `calculation_details` JSON NOT NULL COMMENT '内訳・適用条件スナップショット',
  `algorithm_version` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '計算ロジック版',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '作成日時(UTC)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_price_calculations_1` (`booking_id`, `revision_no`),
  UNIQUE KEY `uq_price_calculations_2` (`id`, `booking_id`),
  KEY `ix_price_calculations_1` (`price_version_id`),
  CONSTRAINT `ck_price_calculations_1` CHECK (revision_no > 0),
  CONSTRAINT `ck_price_calculations_2` CHECK (duration_minutes > 0 AND MOD(duration_minutes,30)=0),
  CONSTRAINT `ck_price_calculations_3` CHECK (total_amount = base_amount - package_discount_amount - time_discount_amount - coupon_discount_amount),
  CONSTRAINT `ck_price_calculations_4` CHECK (tax_rate BETWEEN 0 AND 100),
  CONSTRAINT `ck_price_calculations_5` CHECK (base_amount >= 0),
  CONSTRAINT `ck_price_calculations_6` CHECK (package_discount_amount >= 0),
  CONSTRAINT `ck_price_calculations_7` CHECK (time_discount_amount >= 0),
  CONSTRAINT `ck_price_calculations_8` CHECK (coupon_discount_amount >= 0),
  CONSTRAINT `ck_price_calculations_9` CHECK (total_amount >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='料金計算スナップショット';

-- キャンセル確定記録 / C-15,A-08
CREATE TABLE `booking_cancellations` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部ID',
  `booking_id` BIGINT UNSIGNED NOT NULL COMMENT '予約ID',
  `policy_document_id` BIGINT UNSIGNED NOT NULL COMMENT '適用ポリシー版',
  `requested_at` DATETIME(6) NOT NULL COMMENT 'キャンセル依頼日時',
  `automatic_fee_rate` DECIMAL(5,2) NOT NULL COMMENT '自動料率(%)',
  `applied_fee_rate` DECIMAL(5,2) NOT NULL COMMENT '適用料率(%)',
  `paid_amount` BIGINT NOT NULL COMMENT '決済済合計',
  `fee_amount` BIGINT NOT NULL COMMENT 'キャンセル料',
  `refund_amount` BIGINT NOT NULL COMMENT '返金予定額',
  `reason` TEXT NULL COMMENT 'キャンセル理由',
  `staff_id` BIGINT UNSIGNED NULL COMMENT '操作スタッフ',
  `is_manual_override` TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '手動上書き',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '作成日時(UTC)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_booking_cancellations_1` (`booking_id`),
  KEY `ix_booking_cancellations_1` (`policy_document_id`),
  KEY `ix_booking_cancellations_2` (`staff_id`),
  CONSTRAINT `ck_booking_cancellations_1` CHECK (automatic_fee_rate BETWEEN 0 AND 100),
  CONSTRAINT `ck_booking_cancellations_2` CHECK (applied_fee_rate BETWEEN 0 AND 100),
  CONSTRAINT `ck_booking_cancellations_3` CHECK (refund_amount = paid_amount - fee_amount),
  CONSTRAINT `ck_booking_cancellations_4` CHECK (is_manual_override = 0 OR (staff_id IS NOT NULL AND reason IS NOT NULL AND CHAR_LENGTH(reason)>0)),
  CONSTRAINT `ck_booking_cancellations_5` CHECK (paid_amount >= 0),
  CONSTRAINT `ck_booking_cancellations_6` CHECK (fee_amount >= 0),
  CONSTRAINT `ck_booking_cancellations_7` CHECK (refund_amount >= 0),
  CONSTRAINT `ck_booking_cancellations_8` CHECK (is_manual_override IN (0,1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='キャンセル確定記録';

-- 決済試行・取引 / C-09,C-10,C-18,A-05,A-26
CREATE TABLE `payments` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部ID',
  `booking_id` BIGINT UNSIGNED NOT NULL COMMENT '予約ID',
  `price_calculation_id` BIGINT UNSIGNED NOT NULL COMMENT '対象料金計算版',
  `purpose` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'initial' COMMENT '支払目的',
  `provider` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '決済プロバイダ',
  `environment` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '接続環境',
  `provider_account_id` VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '加盟店/アカウント',
  `external_payment_id` VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT '外部決済ID',
  `external_checkout_id` VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT '外部Checkout ID',
  `idempotency_key` VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'API冪等キー',
  `method` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '決済方法',
  `status` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'pending' COMMENT '状態',
  `amount` BIGINT NOT NULL COMMENT '決済要求額',
  `currency` VARCHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'JPY' COMMENT '通貨',
  `paid_at` DATETIME(6) NULL COMMENT '支払成功日時',
  `failure_code` VARCHAR(191) NULL COMMENT '失敗コード',
  `failure_message` TEXT NULL COMMENT '失敗理由',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '作成日時(UTC)',
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新日時(UTC)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_payments_1` (`provider`, `environment`, `provider_account_id`, `external_payment_id`),
  UNIQUE KEY `uq_payments_2` (`provider`, `environment`, `provider_account_id`, `idempotency_key`),
  UNIQUE KEY `uq_payments_3` (`id`, `booking_id`),
  KEY `ix_payments_1` (`booking_id`, `status`),
  KEY `ix_payments_2` (`status`, `created_at`),
  KEY `ix_payments_3` (`price_calculation_id`, `booking_id`),
  CONSTRAINT `ck_payments_1` CHECK (amount > 0),
  CONSTRAINT `ck_payments_2` CHECK (status <> 'succeeded' OR paid_at IS NOT NULL),
  CONSTRAINT `ck_payments_3` CHECK (purpose IN ('initial','adjustment')),
  CONSTRAINT `ck_payments_4` CHECK (environment IN ('test','live')),
  CONSTRAINT `ck_payments_5` CHECK (method IN ('card','paypay','other')),
  CONSTRAINT `ck_payments_6` CHECK (status IN ('pending','processing','succeeded','failed','canceled'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='決済試行・取引';

-- 返金試行・取引 / C-15,A-08,A-26
CREATE TABLE `refunds` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部ID',
  `payment_id` BIGINT UNSIGNED NOT NULL COMMENT '元決済ID',
  `booking_id` BIGINT UNSIGNED NOT NULL COMMENT '予約ID',
  `cancellation_id` BIGINT UNSIGNED NULL COMMENT 'キャンセルID',
  `idempotency_key` VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '返金冪等キー',
  `external_refund_id` VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT '外部返金ID',
  `status` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'requested' COMMENT '返金状態',
  `amount` BIGINT NOT NULL COMMENT '返金額',
  `reason` VARCHAR(500) NOT NULL COMMENT '返金理由',
  `requested_by` BIGINT UNSIGNED NULL COMMENT '依頼者',
  `refunded_at` DATETIME(6) NULL COMMENT '返金成功日時',
  `failure_code` VARCHAR(191) NULL COMMENT '失敗コード',
  `failure_message` TEXT NULL COMMENT '失敗理由',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '作成日時(UTC)',
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新日時(UTC)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_refunds_1` (`payment_id`, `idempotency_key`),
  UNIQUE KEY `uq_refunds_2` (`payment_id`, `external_refund_id`),
  UNIQUE KEY `uq_refunds_3` (`id`, `booking_id`),
  KEY `ix_refunds_1` (`booking_id`, `status`),
  KEY `ix_refunds_2` (`payment_id`, `booking_id`),
  KEY `ix_refunds_3` (`cancellation_id`),
  KEY `ix_refunds_4` (`requested_by`),
  CONSTRAINT `ck_refunds_1` CHECK (amount > 0),
  CONSTRAINT `ck_refunds_2` CHECK (status <> 'succeeded' OR refunded_at IS NOT NULL),
  CONSTRAINT `ck_refunds_3` CHECK (status IN ('requested','processing','succeeded','failed'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='返金試行・取引';

-- 代理予約決済リンク / A-06,C-18
CREATE TABLE `payment_links` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部ID',
  `booking_id` BIGINT UNSIGNED NOT NULL COMMENT '予約ID',
  `token_hash` BINARY(32) NOT NULL COMMENT '公開トークンのハッシュ',
  `expires_at` DATETIME(6) NOT NULL COMMENT '有効期限',
  `used_at` DATETIME(6) NULL COMMENT '決済完了日時',
  `revoked_at` DATETIME(6) NULL COMMENT '失効日時',
  `issued_by` BIGINT UNSIGNED NOT NULL COMMENT '発行者',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '作成日時(UTC)',
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新日時(UTC)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_payment_links_1` (`token_hash`),
  KEY `ix_payment_links_1` (`booking_id`, `expires_at`),
  KEY `ix_payment_links_2` (`issued_by`),
  CONSTRAINT `ck_payment_links_1` CHECK (expires_at > created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='代理予約決済リンク';

-- 外部イベント受信・重複排除 / C-10,A-25
CREATE TABLE `webhook_events` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部ID',
  `provider` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '送信プロバイダ',
  `environment` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '接続環境',
  `provider_account_id` VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'アカウント',
  `external_event_id` VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '外部イベントID',
  `event_type` VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'イベント種別',
  `payload_sha256` BINARY(32) NOT NULL COMMENT '原文ハッシュ',
  `redacted_payload` JSON NULL COMMENT '必要項目のみの受信内容',
  `signature_valid` TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '署名検証済',
  `status` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'received' COMMENT '処理状態',
  `payment_id` BIGINT UNSIGNED NULL COMMENT '関連決済',
  `booking_id` BIGINT UNSIGNED NULL COMMENT '関連予約',
  `attempt_count` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '処理試行数',
  `received_at` DATETIME(6) NOT NULL COMMENT '受信日時',
  `processed_at` DATETIME(6) NULL COMMENT '処理完了日時',
  `next_retry_at` DATETIME(6) NULL COMMENT '次回処理日時',
  `last_error` TEXT NULL COMMENT '最終失敗理由',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '作成日時(UTC)',
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新日時(UTC)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_webhook_events_1` (`provider`, `environment`, `provider_account_id`, `external_event_id`),
  KEY `ix_webhook_events_1` (`status`, `next_retry_at`),
  KEY `ix_webhook_events_2` (`payment_id`),
  KEY `ix_webhook_events_3` (`booking_id`),
  CONSTRAINT `ck_webhook_events_1` CHECK (environment IN ('test','live')),
  CONSTRAINT `ck_webhook_events_2` CHECK (signature_valid IN (0,1)),
  CONSTRAINT `ck_webhook_events_3` CHECK (status IN ('received','processing','processed','failed','ignored'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='外部イベント受信・重複排除';

-- 領収書発行記録 / C-19,A-26
CREATE TABLE `receipts` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部ID',
  `payment_id` BIGINT UNSIGNED NOT NULL COMMENT '対象決済',
  `booking_id` BIGINT UNSIGNED NOT NULL COMMENT '予約ID',
  `refund_id` BIGINT UNSIGNED NULL COMMENT '返金取引',
  `receipt_number` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '領収書番号',
  `issue_sequence` INT UNSIGNED NOT NULL COMMENT '同一決済内発行版',
  `document_type` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'receipt' COMMENT '書類種別',
  `recipient_name` VARCHAR(200) NOT NULL COMMENT '宛名',
  `issuer_name` VARCHAR(200) NOT NULL COMMENT '発行事業者',
  `issuer_address` VARCHAR(500) NOT NULL COMMENT '発行者住所',
  `invoice_registration_no` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT '適格請求書登録番号',
  `total_amount` BIGINT NOT NULL COMMENT '税込合計',
  `tax_amount` BIGINT NOT NULL COMMENT '税額合計',
  `issued_at` DATETIME(6) NOT NULL COMMENT '発行日時',
  `pdf_object_key` VARCHAR(500) NOT NULL COMMENT 'PDF保管キー',
  `pdf_sha256` BINARY(32) NOT NULL COMMENT 'PDFハッシュ',
  `status` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'issued' COMMENT '状態',
  `issued_by` BIGINT UNSIGNED NULL COMMENT '発行者',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '作成日時(UTC)',
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新日時(UTC)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_receipts_1` (`receipt_number`),
  UNIQUE KEY `uq_receipts_2` (`payment_id`, `issue_sequence`),
  KEY `ix_receipts_1` (`payment_id`, `booking_id`),
  KEY `ix_receipts_2` (`refund_id`),
  KEY `ix_receipts_3` (`issued_by`),
  CONSTRAINT `ck_receipts_1` CHECK (issue_sequence > 0),
  CONSTRAINT `ck_receipts_2` CHECK (tax_amount <= total_amount),
  CONSTRAINT `ck_receipts_3` CHECK (document_type IN ('receipt','refund_statement')),
  CONSTRAINT `ck_receipts_4` CHECK (total_amount >= 0),
  CONSTRAINT `ck_receipts_5` CHECK (tax_amount >= 0),
  CONSTRAINT `ck_receipts_6` CHECK (status IN ('issued','void'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='領収書発行記録';

-- 領収書税率別内訳 / C-19,A-26
CREATE TABLE `receipt_tax_lines` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部ID',
  `receipt_id` BIGINT UNSIGNED NOT NULL COMMENT '領収書ID',
  `tax_rate` DECIMAL(5,2) NOT NULL COMMENT '税率(%)',
  `taxable_amount` BIGINT NOT NULL COMMENT '税抜対象額',
  `tax_amount` BIGINT NOT NULL COMMENT '税額',
  `gross_amount` BIGINT NOT NULL COMMENT '税込対象額',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '作成日時(UTC)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_receipt_tax_lines_1` (`receipt_id`, `tax_rate`),
  CONSTRAINT `ck_receipt_tax_lines_1` CHECK (tax_rate BETWEEN 0 AND 100),
  CONSTRAINT `ck_receipt_tax_lines_2` CHECK (gross_amount = taxable_amount + tax_amount),
  CONSTRAINT `ck_receipt_tax_lines_3` CHECK (taxable_amount >= 0),
  CONSTRAINT `ck_receipt_tax_lines_4` CHECK (tax_amount >= 0),
  CONSTRAINT `ck_receipt_tax_lines_5` CHECK (gross_amount >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='領収書税率別内訳';

-- クーポン施策 / C-16,A-13,A-14
CREATE TABLE `coupons` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部ID',
  `code` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'クーポンコード',
  `name` VARCHAR(200) NOT NULL COMMENT 'クーポン名',
  `campaign_tag` VARCHAR(100) NULL COMMENT '施策タグ',
  `status` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'draft' COMMENT '状態',
  `created_by` BIGINT UNSIGNED NULL COMMENT '作成者',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '作成日時(UTC)',
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新日時(UTC)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_coupons_1` (`code`),
  KEY `ix_coupons_1` (`created_by`),
  CONSTRAINT `ck_coupons_1` CHECK (status IN ('draft','active','disabled'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='クーポン施策';

-- クーポン条件の版 / C-09,C-16,A-13,A-14
CREATE TABLE `coupon_versions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部ID',
  `coupon_id` BIGINT UNSIGNED NOT NULL COMMENT 'クーポンID',
  `version_no` INT UNSIGNED NOT NULL COMMENT '版番号',
  `discount_type` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '割引型',
  `discount_value` DECIMAL(12,2) NOT NULL COMMENT '割引額/率',
  `maximum_discount_amount` BIGINT NULL COMMENT '値引上限',
  `minimum_spend_amount` BIGINT NOT NULL DEFAULT 0 COMMENT '最低利用金額',
  `max_uses` INT UNSIGNED NOT NULL COMMENT '利用可能回数',
  `valid_from` DATETIME(6) NOT NULL COMMENT '利用開始',
  `valid_to` DATETIME(6) NOT NULL COMMENT '利用終了',
  `weekday_mask` TINYINT UNSIGNED NOT NULL DEFAULT 127 COMMENT '対象曜日',
  `start_minute` SMALLINT UNSIGNED NULL COMMENT '利用開始時刻条件',
  `end_minute` SMALLINT UNSIGNED NULL COMMENT '利用開始時刻上限',
  `grant_trigger` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'manual' COMMENT '付与契機',
  `stackable` TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '併用可否',
  `conditions_note` TEXT NULL COMMENT '顧客向け適用条件',
  `published_by` BIGINT UNSIGNED NULL COMMENT '公開者',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '作成日時(UTC)',
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新日時(UTC)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_coupon_versions_1` (`coupon_id`, `version_no`),
  KEY `ix_coupon_versions_1` (`published_by`),
  CONSTRAINT `ck_coupon_versions_1` CHECK (version_no > 0),
  CONSTRAINT `ck_coupon_versions_2` CHECK (max_uses > 0),
  CONSTRAINT `ck_coupon_versions_3` CHECK (valid_to > valid_from),
  CONSTRAINT `ck_coupon_versions_4` CHECK ((discount_type='amount' AND discount_value > 0 AND MOD(discount_value,1)=0) OR (discount_type='percent' AND discount_value > 0 AND discount_value <= 100)),
  CONSTRAINT `ck_coupon_versions_5` CHECK (weekday_mask BETWEEN 1 AND 127),
  CONSTRAINT `ck_coupon_versions_6` CHECK ((start_minute IS NULL AND end_minute IS NULL) OR (start_minute IS NOT NULL AND end_minute IS NOT NULL AND end_minute > start_minute AND end_minute <= 2880)),
  CONSTRAINT `ck_coupon_versions_7` CHECK (discount_type IN ('amount','percent')),
  CONSTRAINT `ck_coupon_versions_8` CHECK (maximum_discount_amount >= 0),
  CONSTRAINT `ck_coupon_versions_9` CHECK (minimum_spend_amount >= 0),
  CONSTRAINT `ck_coupon_versions_10` CHECK (grant_trigger IN ('registration','line_friend','first_use','manual','bulk')),
  CONSTRAINT `ck_coupon_versions_11` CHECK (stackable IN (0,1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='クーポン条件の版';

-- クーポン対象店舗 / A-13,A-14
CREATE TABLE `coupon_stores` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部ID',
  `coupon_version_id` BIGINT UNSIGNED NOT NULL COMMENT 'クーポン版ID',
  `store_id` BIGINT UNSIGNED NOT NULL COMMENT '対象店舗',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '作成日時(UTC)',
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新日時(UTC)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_coupon_stores_1` (`coupon_version_id`, `store_id`),
  KEY `ix_coupon_stores_1` (`store_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='クーポン対象店舗';

-- クーポン対象部屋タイプ / A-13,A-14
CREATE TABLE `coupon_room_types` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部ID',
  `coupon_version_id` BIGINT UNSIGNED NOT NULL COMMENT 'クーポン版ID',
  `room_type_id` BIGINT UNSIGNED NOT NULL COMMENT '対象タイプ',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '作成日時(UTC)',
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新日時(UTC)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_coupon_room_types_1` (`coupon_version_id`, `room_type_id`),
  KEY `ix_coupon_room_types_1` (`room_type_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='クーポン対象部屋タイプ';

-- セグメント一斉付与 / A-15
CREATE TABLE `coupon_campaigns` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部ID',
  `coupon_version_id` BIGINT UNSIGNED NOT NULL COMMENT '付与クーポン版',
  `campaign_key` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '施策冪等キー',
  `name` VARCHAR(200) NOT NULL COMMENT '配布施策名',
  `segment_code` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '定型セグメント',
  `segment_conditions` JSON NOT NULL COMMENT '抽出条件・基準日時',
  `preview_count` INT UNSIGNED NOT NULL COMMENT '事前件数',
  `target_count` INT UNSIGNED NOT NULL COMMENT '確定対象数',
  `status` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'draft' COMMENT '実行状態',
  `issued_by` BIGINT UNSIGNED NOT NULL COMMENT '実行者',
  `started_at` DATETIME(6) NULL COMMENT '開始日時',
  `finished_at` DATETIME(6) NULL COMMENT '終了日時',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '作成日時(UTC)',
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新日時(UTC)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_coupon_campaigns_1` (`campaign_key`),
  KEY `ix_coupon_campaigns_1` (`coupon_version_id`),
  KEY `ix_coupon_campaigns_2` (`issued_by`),
  CONSTRAINT `ck_coupon_campaigns_1` CHECK (status IN ('draft','queued','running','completed','failed'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='セグメント一斉付与';

-- 会員へのクーポン付与 / C-07,C-16,A-13,A-15
CREATE TABLE `coupon_grants` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部ID',
  `member_id` BIGINT UNSIGNED NOT NULL COMMENT '会員ID',
  `coupon_version_id` BIGINT UNSIGNED NOT NULL COMMENT '付与条件版',
  `campaign_id` BIGINT UNSIGNED NULL COMMENT '一斉配布施策',
  `issuance_key` VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '付与冪等キー',
  `max_uses` INT UNSIGNED NOT NULL COMMENT '付与時回数スナップショット',
  `valid_from` DATETIME(6) NOT NULL COMMENT '利用開始',
  `expires_at` DATETIME(6) NOT NULL COMMENT '失効日時',
  `granted_at` DATETIME(6) NOT NULL COMMENT '付与日時',
  `granted_by` BIGINT UNSIGNED NULL COMMENT '付与スタッフ',
  `internal_note` VARCHAR(1000) NULL COMMENT '社内メモ',
  `revoked_at` DATETIME(6) NULL COMMENT '取り消し日時',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '作成日時(UTC)',
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新日時(UTC)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_coupon_grants_1` (`issuance_key`),
  KEY `ix_coupon_grants_1` (`member_id`, `expires_at`),
  KEY `ix_coupon_grants_2` (`coupon_version_id`),
  KEY `ix_coupon_grants_3` (`campaign_id`),
  KEY `ix_coupon_grants_4` (`granted_by`),
  CONSTRAINT `ck_coupon_grants_1` CHECK (max_uses > 0),
  CONSTRAINT `ck_coupon_grants_2` CHECK (expires_at > valid_from)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='会員へのクーポン付与';

-- クーポン利用・回数予約 / C-09,A-05,A-27
CREATE TABLE `coupon_redemptions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部ID',
  `coupon_grant_id` BIGINT UNSIGNED NOT NULL COMMENT '会員付与ID',
  `booking_id` BIGINT UNSIGNED NOT NULL COMMENT '予約ID',
  `use_sequence` INT UNSIGNED NOT NULL COMMENT '回数別割引の適用回',
  `discount_amount` BIGINT NOT NULL COMMENT '実際の値引額',
  `status` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'reserved' COMMENT '利用状態',
  `applied_at` DATETIME(6) NULL COMMENT '決済適用日時',
  `released_at` DATETIME(6) NULL COMMENT '解放/戻し日時',
  `active_booking_id` BIGINT UNSIGNED GENERATED ALWAYS AS (CASE WHEN status IN ('reserved','applied') THEN booking_id ELSE NULL END) STORED COMMENT '有効利用一意キー',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '作成日時(UTC)',
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新日時(UTC)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_coupon_redemptions_1` (`active_booking_id`),
  KEY `ix_coupon_redemptions_1` (`coupon_grant_id`, `status`),
  KEY `ix_coupon_redemptions_2` (`booking_id`),
  CONSTRAINT `ck_coupon_redemptions_1` CHECK (use_sequence > 0),
  CONSTRAINT `ck_coupon_redemptions_2` CHECK (status <> 'applied' OR applied_at IS NOT NULL),
  CONSTRAINT `ck_coupon_redemptions_3` CHECK (discount_amount >= 0),
  CONSTRAINT `ck_coupon_redemptions_4` CHECK (status IN ('reserved','applied','released','reversed'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='クーポン利用・回数予約';

-- 鍵デバイス / A-09,A-20
CREATE TABLE `lock_devices` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部ID',
  `store_id` BIGINT UNSIGNED NOT NULL COMMENT '店舗ID',
  `name` VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'デバイス名',
  `provider` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'ロック事業者',
  `provider_account_id` VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '事業者アカウント',
  `external_device_id` VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '外部デバイスID',
  `secret_reference` VARCHAR(500) NULL COMMENT '認証情報の保管先参照',
  `battery_percent` TINYINT UNSIGNED NULL COMMENT '電池残量',
  `communication_status` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'unknown' COMMENT '通信状態',
  `last_response_at` DATETIME(6) NULL COMMENT '最終応答日時',
  `is_active` TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '有効',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '作成日時(UTC)',
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新日時(UTC)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_lock_devices_1` (`provider`, `provider_account_id`, `external_device_id`),
  UNIQUE KEY `uq_lock_devices_2` (`id`, `store_id`),
  KEY `ix_lock_devices_1` (`store_id`),
  CONSTRAINT `ck_lock_devices_1` CHECK (battery_percent IS NULL OR battery_percent <= 100),
  CONSTRAINT `ck_lock_devices_2` CHECK (communication_status IN ('unknown','online','offline')),
  CONSTRAINT `ck_lock_devices_3` CHECK (is_active IN (0,1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='鍵デバイス';

-- 予約の鍵発行・失効管理 / C-11,C-13,A-05,A-09
CREATE TABLE `access_keys` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部ID',
  `booking_id` BIGINT UNSIGNED NOT NULL COMMENT '予約ID',
  `store_id` BIGINT UNSIGNED NOT NULL COMMENT '店舗ID',
  `lock_device_id` BIGINT UNSIGNED NOT NULL COMMENT '対象ロック',
  `provider_key_id` VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT '外部一時鍵ID',
  `code_ciphertext` BLOB NULL COMMENT '入室コード暗号文',
  `encryption_key_version` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT '暗号鍵版',
  `valid_from` DATETIME(6) NOT NULL COMMENT '有効開始',
  `valid_to` DATETIME(6) NOT NULL COMMENT '有効終了',
  `status` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'pending' COMMENT '鍵状態',
  `idempotency_key` VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '発行/再発行冪等キー',
  `issued_at` DATETIME(6) NULL COMMENT '発行日時',
  `revoked_at` DATETIME(6) NULL COMMENT '失効日時',
  `active_marker` TINYINT UNSIGNED GENERATED ALWAYS AS (CASE WHEN status IN ('pending','issued','active','revoke_pending') THEN 1 ELSE NULL END) STORED COMMENT '有効鍵一意マーカー',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '作成日時(UTC)',
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新日時(UTC)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_access_keys_1` (`idempotency_key`),
  UNIQUE KEY `uq_access_keys_2` (`booking_id`, `lock_device_id`, `active_marker`),
  KEY `ix_access_keys_1` (`booking_id`, `store_id`),
  KEY `ix_access_keys_2` (`lock_device_id`, `store_id`),
  CONSTRAINT `ck_access_keys_1` CHECK (valid_to > valid_from),
  CONSTRAINT `ck_access_keys_2` CHECK (status IN ('pending','issued','active','revoke_pending','revoked','expired','failed'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='予約の鍵発行・失効管理';

-- 鍵イベント・API試行 / A-05,A-09
CREATE TABLE `key_events` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部ID',
  `access_key_id` BIGINT UNSIGNED NULL COMMENT '鍵ID',
  `lock_device_id` BIGINT UNSIGNED NOT NULL COMMENT 'デバイスID',
  `booking_id` BIGINT UNSIGNED NULL COMMENT '予約ID',
  `event_type` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'イベント種別',
  `result` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '結果',
  `request_key` VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT '要求追跡キー',
  `attempt_no` INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '試行番号',
  `occurred_at` DATETIME(6) NOT NULL COMMENT '発生日時',
  `error_code` VARCHAR(191) NULL COMMENT 'エラーコード',
  `redacted_details` JSON NULL COMMENT '秘密値除去後の詳細',
  `staff_id` BIGINT UNSIGNED NULL COMMENT '手動対応者',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '作成日時(UTC)',
  PRIMARY KEY (`id`),
  KEY `ix_key_events_1` (`booking_id`, `occurred_at`),
  KEY `ix_key_events_2` (`lock_device_id`, `occurred_at`),
  KEY `ix_key_events_3` (`access_key_id`),
  KEY `ix_key_events_4` (`staff_id`),
  CONSTRAINT `ck_key_events_1` CHECK (result IN ('requested','success','failure','unknown'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='鍵イベント・API試行';

-- 清掃予定・スポットタスク / A-10,K-02
CREATE TABLE `cleaning_tasks` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部ID',
  `room_id` BIGINT UNSIGNED NOT NULL COMMENT '対象部屋',
  `booking_id` BIGINT UNSIGNED NULL COMMENT '関連する次予約',
  `business_date` DATE NOT NULL COMMENT '清掃営業日',
  `task_type` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '清掃種別',
  `status` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'pending' COMMENT '状態',
  `is_urgent` TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '至急表示',
  `planned_start_at` DATETIME(6) NULL COMMENT '開始目安',
  `due_at` DATETIME(6) NOT NULL COMMENT '期限',
  `assigned_staff_id` BIGINT UNSIGNED NULL COMMENT '担当者',
  `generation_key` VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '予定作成冪等キー',
  `reason` VARCHAR(500) NULL COMMENT '発生理由',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '作成日時(UTC)',
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新日時(UTC)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cleaning_tasks_1` (`generation_key`),
  UNIQUE KEY `uq_cleaning_tasks_2` (`id`, `room_id`),
  KEY `ix_cleaning_tasks_1` (`room_id`, `business_date`, `status`),
  KEY `ix_cleaning_tasks_2` (`status`, `due_at`),
  KEY `ix_cleaning_tasks_3` (`booking_id`),
  KEY `ix_cleaning_tasks_4` (`assigned_staff_id`),
  CONSTRAINT `ck_cleaning_tasks_1` CHECK (task_type IN ('opening','spot')),
  CONSTRAINT `ck_cleaning_tasks_2` CHECK (status IN ('pending','in_progress','done','canceled')),
  CONSTRAINT `ck_cleaning_tasks_3` CHECK (is_urgent IN (0,1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='清掃予定・スポットタスク';

-- 清掃実績 / A-10,K-03
CREATE TABLE `cleaning_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部ID',
  `task_id` BIGINT UNSIGNED NOT NULL COMMENT '清掃タスク',
  `staff_id` BIGINT UNSIGNED NOT NULL COMMENT '完了実行者',
  `started_at` DATETIME(6) NULL COMMENT '実際の開始打刻',
  `completed_at` DATETIME(6) NOT NULL COMMENT '実際の完了打刻',
  `was_overdue` TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '完了時の期限超過',
  `notes` TEXT NULL COMMENT '実績メモ',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '作成日時(UTC)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cleaning_logs_1` (`task_id`),
  KEY `ix_cleaning_logs_1` (`staff_id`),
  CONSTRAINT `ck_cleaning_logs_1` CHECK (started_at IS NULL OR completed_at >= started_at),
  CONSTRAINT `ck_cleaning_logs_2` CHECK (was_overdue IN (0,1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='清掃実績';

-- 利用と清掃状態の検証記録 / A-10,A-27,K-03
CREATE TABLE `booking_usage_events` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部ID',
  `booking_id` BIGINT UNSIGNED NOT NULL COMMENT '予約ID',
  `room_id` BIGINT UNSIGNED NOT NULL COMMENT '部屋ID',
  `event_type` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '記録種別',
  `occurred_at` DATETIME(6) NOT NULL COMMENT '観測/処理日時',
  `cleaning_status_snapshot` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '時点の清掃状態',
  `latest_cleaning_log_id` BIGINT UNSIGNED NULL COMMENT '参照清掃実績',
  `evidence_source` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '根拠',
  `event_key` VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'イベント冪等キー',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '作成日時(UTC)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_booking_usage_events_1` (`event_key`),
  KEY `ix_booking_usage_events_1` (`booking_id`, `occurred_at`),
  KEY `ix_booking_usage_events_2` (`room_id`),
  KEY `ix_booking_usage_events_3` (`latest_cleaning_log_id`),
  CONSTRAINT `ck_booking_usage_events_1` CHECK (event_type IN ('scheduled_start','entry','exit','completion')),
  CONSTRAINT `ck_booking_usage_events_2` CHECK (cleaning_status_snapshot IN ('clean','dirty','unknown')),
  CONSTRAINT `ck_booking_usage_events_3` CHECK (evidence_source IN ('scheduler','lock_provider','staff'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='利用と清掃状態の検証記録';

-- 通知テンプレートの適用先 / L-04,A-21
CREATE TABLE `notification_templates` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部ID',
  `event_type` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '通知種別',
  `channel` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '送信チャネル',
  `store_id` BIGINT UNSIGNED NULL COMMENT '店舗ID',
  `scope_store_key` BIGINT UNSIGNED GENERATED ALWAYS AS (COALESCE(store_id,0)) STORED COMMENT '全店一意キー',
  `is_enabled` TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '有効',
  `channel_priority` INT UNSIGNED NOT NULL COMMENT 'チャネル優先順位',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '作成日時(UTC)',
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新日時(UTC)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_notification_templates_1` (`event_type`, `channel`, `scope_store_key`),
  KEY `ix_notification_templates_1` (`store_id`),
  CONSTRAINT `ck_notification_templates_1` CHECK (channel IN ('line','email','sms')),
  CONSTRAINT `ck_notification_templates_2` CHECK (is_enabled IN (0,1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='通知テンプレートの適用先';

-- 通知文面の版 / L-04,A-21
CREATE TABLE `notification_template_versions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部ID',
  `template_id` BIGINT UNSIGNED NOT NULL COMMENT 'テンプレート',
  `version_no` INT UNSIGNED NOT NULL COMMENT '版番号',
  `subject` VARCHAR(250) NULL COMMENT 'メール件名',
  `body` TEXT NOT NULL COMMENT '本文',
  `variables_schema` JSON NOT NULL COMMENT '許可差し込み変数定義',
  `entry_guide_url` VARCHAR(1000) NULL COMMENT '入室案内画像',
  `published_at` DATETIME(6) NOT NULL COMMENT '公開日時',
  `published_by` BIGINT UNSIGNED NOT NULL COMMENT '公開者',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '作成日時(UTC)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_notification_template_versions_1` (`template_id`, `version_no`),
  KEY `ix_notification_template_versions_1` (`published_by`),
  CONSTRAINT `ck_notification_template_versions_1` CHECK (version_no > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='通知文面の版';

-- 通知予定・配送結果 / A-05,A-15,A-25,L-04
CREATE TABLE `notification_deliveries` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部ID',
  `member_id` BIGINT UNSIGNED NULL COMMENT '対象会員',
  `booking_id` BIGINT UNSIGNED NULL COMMENT '関連予約',
  `coupon_grant_id` BIGINT UNSIGNED NULL COMMENT '関連クーポン',
  `payment_link_id` BIGINT UNSIGNED NULL COMMENT '代理予約リンク',
  `template_version_id` BIGINT UNSIGNED NOT NULL COMMENT '文面版',
  `channel` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'チャネル',
  `destination_ciphertext` BLOB NOT NULL COMMENT '送信先暗号文',
  `context_redacted` JSON NOT NULL COMMENT '秘密値除去後の差し込み値',
  `deduplication_key` VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '通知冪等キー',
  `status` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'queued' COMMENT '状態',
  `scheduled_at` DATETIME(6) NOT NULL COMMENT '送信予定',
  `sent_at` DATETIME(6) NULL COMMENT '送信受付日時',
  `next_retry_at` DATETIME(6) NULL COMMENT '再試行日時',
  `attempt_count` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '試行数',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '作成日時(UTC)',
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新日時(UTC)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_notification_deliveries_1` (`deduplication_key`),
  KEY `ix_notification_deliveries_1` (`status`, `scheduled_at`, `next_retry_at`),
  KEY `ix_notification_deliveries_2` (`booking_id`, `created_at`),
  KEY `ix_notification_deliveries_3` (`member_id`),
  KEY `ix_notification_deliveries_4` (`coupon_grant_id`),
  KEY `ix_notification_deliveries_5` (`payment_link_id`),
  KEY `ix_notification_deliveries_6` (`template_version_id`),
  CONSTRAINT `ck_notification_deliveries_1` CHECK (channel IN ('line','email','sms')),
  CONSTRAINT `ck_notification_deliveries_2` CHECK (status IN ('queued','sending','sent','failed','skipped'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='通知予定・配送結果';

-- 通知送信試行ログ / A-05,A-25
CREATE TABLE `notification_attempts` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部ID',
  `delivery_id` BIGINT UNSIGNED NOT NULL COMMENT '配送ID',
  `attempt_no` INT UNSIGNED NOT NULL COMMENT '試行番号',
  `result` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '結果',
  `provider_message_id` VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT '事業者メッセージID',
  `error_code` VARCHAR(191) NULL COMMENT '失敗コード',
  `error_message` TEXT NULL COMMENT '失敗理由',
  `attempted_at` DATETIME(6) NOT NULL COMMENT '試行日時',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '作成日時(UTC)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_notification_attempts_1` (`delivery_id`, `attempt_no`),
  CONSTRAINT `ck_notification_attempts_1` CHECK (result IN ('accepted','delivered','failed','unknown'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='通知送信試行ログ';

-- 業務イベント配送 / C-10,A-25
CREATE TABLE `outbox_events` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部ID',
  `event_key` VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'イベント冪等キー',
  `aggregate_type` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '対象種類',
  `aggregate_id` BIGINT UNSIGNED NOT NULL COMMENT '対象ID',
  `event_type` VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'イベント種類',
  `payload` JSON NOT NULL COMMENT 'ID中心のイベント値',
  `status` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'pending' COMMENT '配送状態',
  `attempt_count` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '試行数',
  `available_at` DATETIME(6) NOT NULL COMMENT '処理可能時刻',
  `locked_at` DATETIME(6) NULL COMMENT '処理リース開始',
  `locked_by` VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT 'ワーカーID',
  `delivered_at` DATETIME(6) NULL COMMENT '配送完了日時',
  `last_error` TEXT NULL COMMENT '最終エラー',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '作成日時(UTC)',
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新日時(UTC)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_outbox_events_1` (`event_key`),
  KEY `ix_outbox_events_1` (`status`, `available_at`),
  CONSTRAINT `ck_outbox_events_1` CHECK (status IN ('pending','processing','delivered','failed'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='業務イベント配送';

-- 運用アラート / A-02,A-25
CREATE TABLE `alerts` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部ID',
  `store_id` BIGINT UNSIGNED NULL COMMENT '関連店舗',
  `booking_id` BIGINT UNSIGNED NULL COMMENT '関連予約',
  `payment_id` BIGINT UNSIGNED NULL COMMENT '関連決済',
  `lock_device_id` BIGINT UNSIGNED NULL COMMENT '関連デバイス',
  `delivery_id` BIGINT UNSIGNED NULL COMMENT '関連通知',
  `webhook_event_id` BIGINT UNSIGNED NULL COMMENT '関連受信イベント',
  `alert_key` VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '検知冪等キー',
  `alert_type` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'アラート種別',
  `severity` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '重要度',
  `status` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'open' COMMENT '対応状態',
  `failure_reason` TEXT NOT NULL COMMENT '失敗理由',
  `recovery_steps` TEXT NOT NULL COMMENT '復旧手順',
  `detected_at` DATETIME(6) NOT NULL COMMENT '検知日時',
  `assigned_staff_id` BIGINT UNSIGNED NULL COMMENT '対応担当',
  `resolved_at` DATETIME(6) NULL COMMENT '解決日時',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '作成日時(UTC)',
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新日時(UTC)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_alerts_1` (`alert_key`),
  KEY `ix_alerts_1` (`status`, `detected_at`),
  KEY `ix_alerts_2` (`store_id`),
  KEY `ix_alerts_3` (`booking_id`),
  KEY `ix_alerts_4` (`payment_id`),
  KEY `ix_alerts_5` (`lock_device_id`),
  KEY `ix_alerts_6` (`delivery_id`),
  KEY `ix_alerts_7` (`webhook_event_id`),
  KEY `ix_alerts_8` (`assigned_staff_id`),
  CONSTRAINT `ck_alerts_1` CHECK (severity IN ('info','warning','critical')),
  CONSTRAINT `ck_alerts_2` CHECK (status IN ('open','in_progress','resolved'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='運用アラート';

-- 操作監査ログ / A-24,A-05,A-07,A-08,A-12
CREATE TABLE `audit_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部ID',
  `actor_type` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '操作者種類',
  `staff_id` BIGINT UNSIGNED NULL COMMENT '操作スタッフ',
  `member_id` BIGINT UNSIGNED NULL COMMENT '操作会員',
  `store_id` BIGINT UNSIGNED NULL COMMENT '関連店舗',
  `action` VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '操作種類',
  `target_type` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '対象テーブル/種別',
  `target_id` BIGINT UNSIGNED NULL COMMENT '対象内部ID',
  `target_code` VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT '操作時の対象業務コード',
  `before_values` JSON NULL COMMENT '変更前(秘密除去)',
  `after_values` JSON NULL COMMENT '変更後(秘密除去)',
  `reason` TEXT NULL COMMENT '操作理由',
  `ip_address` VARBINARY(16) NULL COMMENT 'IPv4/IPv6',
  `request_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '追跡ID',
  `occurred_at` DATETIME(6) NOT NULL COMMENT '操作日時',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '作成日時(UTC)',
  PRIMARY KEY (`id`),
  KEY `ix_audit_logs_1` (`target_type`, `target_id`, `occurred_at`),
  KEY `ix_audit_logs_2` (`staff_id`, `occurred_at`),
  KEY `ix_audit_logs_3` (`store_id`, `occurred_at`),
  KEY `ix_audit_logs_4` (`member_id`),
  CONSTRAINT `ck_audit_logs_1` CHECK ((actor_type='staff' AND staff_id IS NOT NULL AND member_id IS NULL) OR (actor_type='member' AND member_id IS NOT NULL AND staff_id IS NULL) OR (actor_type='system' AND member_id IS NULL AND staff_id IS NULL)),
  CONSTRAINT `ck_audit_logs_2` CHECK (actor_type IN ('system','staff','member'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='操作監査ログ';

-- CSV出力履歴 / A-27
CREATE TABLE `report_exports` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部ID',
  `staff_id` BIGINT UNSIGNED NOT NULL COMMENT '出力者',
  `store_id` BIGINT UNSIGNED NULL COMMENT '店舗ID',
  `report_type` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '出力種別',
  `period_from` DATE NOT NULL COMMENT '開始日',
  `period_to` DATE NOT NULL COMMENT '終了日',
  `filters` JSON NOT NULL COMMENT '抽出条件',
  `data_as_of` DATETIME(6) NOT NULL COMMENT 'データ基準日時',
  `definition_version` VARCHAR(64) NOT NULL COMMENT '集計定義版',
  `status` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'queued' COMMENT '状態',
  `row_count` INT UNSIGNED NULL COMMENT '出力件数',
  `file_object_key` VARCHAR(500) NULL COMMENT 'CSV保管キー',
  `completed_at` DATETIME(6) NULL COMMENT '完了日時',
  `expires_at` DATETIME(6) NULL COMMENT 'ファイル期限',
  `error_message` TEXT NULL COMMENT 'エラー',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '作成日時(UTC)',
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新日時(UTC)',
  PRIMARY KEY (`id`),
  KEY `ix_report_exports_1` (`staff_id`, `created_at`),
  KEY `ix_report_exports_2` (`store_id`),
  CONSTRAINT `ck_report_exports_1` CHECK (period_to >= period_from),
  CONSTRAINT `ck_report_exports_2` CHECK (status IN ('queued','running','completed','failed'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='CSV出力履歴';

-- 割当・清掃・期限解放バッチ実行 / A-03,A-10,A-25
CREATE TABLE `batch_runs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部ID',
  `store_id` BIGINT UNSIGNED NULL COMMENT '店舗ID',
  `job_type` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '処理種類',
  `business_date` DATE NOT NULL COMMENT '対象営業日',
  `run_key` VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '実行冪等キー',
  `status` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'running' COMMENT '実行状態',
  `started_at` DATETIME(6) NOT NULL COMMENT '開始日時',
  `finished_at` DATETIME(6) NULL COMMENT '完了日時',
  `processed_count` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '処理数',
  `failed_count` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '失敗数',
  `triggered_by` BIGINT UNSIGNED NULL COMMENT '手動起動者',
  `error_summary` TEXT NULL COMMENT '失敗概要',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '作成日時(UTC)',
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新日時(UTC)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_batch_runs_1` (`run_key`),
  KEY `ix_batch_runs_1` (`job_type`, `business_date`),
  KEY `ix_batch_runs_2` (`store_id`),
  KEY `ix_batch_runs_3` (`triggered_by`),
  CONSTRAINT `ck_batch_runs_1` CHECK (status IN ('running','completed','failed'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='割当・清掃・期限解放バッチ実行';

-- 部屋の活動記録・メモ / K-02,K-03,A-10,A-24
CREATE TABLE `room_activity_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部ID',
  `room_id` BIGINT UNSIGNED NOT NULL COMMENT '対象部屋ID',
  `task_id` BIGINT UNSIGNED NULL COMMENT '関連清掃タスクID',
  `staff_id` BIGINT UNSIGNED NOT NULL COMMENT 'ログインした記録者ID',
  `source` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '入力画面',
  `action` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '活動種別',
  `body` TEXT NOT NULL COMMENT '活動内容・メモ',
  `occurred_at` DATETIME(6) NOT NULL COMMENT '活動日時(UTC)',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '作成日時(UTC)',
  PRIMARY KEY (`id`),
  KEY `ix_room_activity_logs_1` (`room_id`, `occurred_at`),
  KEY `ix_room_activity_logs_2` (`staff_id`, `occurred_at`),
  KEY `ix_room_activity_logs_3` (`task_id`, `room_id`),
  CONSTRAINT `ck_room_activity_logs_1` CHECK (source IN ('cleaning','admin'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='部屋の活動記録・メモ';

-- 予約変更履歴 / C-13,C-14,A-05,A-24
CREATE TABLE `booking_change_history` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部ID',
  `booking_id` BIGINT UNSIGNED NOT NULL COMMENT '対象予約',
  `actor_type` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '操作者種類',
  `staff_id` BIGINT UNSIGNED NULL COMMENT '操作スタッフ',
  `member_id` BIGINT UNSIGNED NULL COMMENT '操作顧客',
  `policy_document_id` BIGINT UNSIGNED NOT NULL COMMENT '判断時のポリシー版',
  `policy_checked_at` DATETIME(6) NOT NULL COMMENT '変更可否の検証日時',
  `changed_at` DATETIME(6) NOT NULL COMMENT '変更日時',
  `before_values` JSON NOT NULL COMMENT '変更前の日時・人数・金額・割当',
  `after_values` JSON NOT NULL COMMENT '変更後の日時・人数・金額・割当',
  `reason` VARCHAR(1000) NULL COMMENT '変更理由',
  `request_key` VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '変更記録の冪等キー',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '作成日時(UTC)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_booking_change_history_1` (`request_key`),
  KEY `ix_booking_change_history_1` (`booking_id`, `changed_at`),
  KEY `ix_booking_change_history_2` (`staff_id`),
  KEY `ix_booking_change_history_3` (`member_id`),
  KEY `ix_booking_change_history_4` (`policy_document_id`),
  CONSTRAINT `ck_booking_change_history_1` CHECK ((actor_type='staff' AND staff_id IS NOT NULL AND member_id IS NULL) OR (actor_type='member' AND member_id IS NOT NULL AND staff_id IS NULL)),
  CONSTRAINT `ck_booking_change_history_2` CHECK (changed_at >= policy_checked_at),
  CONSTRAINT `ck_booking_change_history_3` CHECK (actor_type IN ('staff','member'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='予約変更履歴';

-- 外部キー(全テーブル作成後に追加)

ALTER TABLE `store_business_hours` ADD CONSTRAINT `fk_store_business_hours_1` FOREIGN KEY (`store_id`) REFERENCES `stores` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `store_calendar_days` ADD CONSTRAINT `fk_store_calendar_days_1` FOREIGN KEY (`store_id`) REFERENCES `stores` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `room_groups` ADD CONSTRAINT `fk_room_groups_1` FOREIGN KEY (`store_id`) REFERENCES `stores` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `room_groups` ADD CONSTRAINT `fk_room_groups_2` FOREIGN KEY (`room_type_id`) REFERENCES `room_types` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `rooms` ADD CONSTRAINT `fk_rooms_1` FOREIGN KEY (`room_group_id`, `store_id`, `room_type_id`) REFERENCES `room_groups` (`id`, `store_id`, `room_type_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `room_photos` ADD CONSTRAINT `fk_room_photos_1` FOREIGN KEY (`room_id`) REFERENCES `rooms` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;



ALTER TABLE `role_permissions` ADD CONSTRAINT `fk_role_permissions_1` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `role_permissions` ADD CONSTRAINT `fk_role_permissions_2` FOREIGN KEY (`permission_id`) REFERENCES `permissions` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `staff_role_grants` ADD CONSTRAINT `fk_staff_role_grants_1` FOREIGN KEY (`staff_id`) REFERENCES `staff` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `staff_role_grants` ADD CONSTRAINT `fk_staff_role_grants_2` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `staff_role_grants` ADD CONSTRAINT `fk_staff_role_grants_3` FOREIGN KEY (`store_id`) REFERENCES `stores` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `staff_role_grants` ADD CONSTRAINT `fk_staff_role_grants_4` FOREIGN KEY (`granted_by`) REFERENCES `staff` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `staff_auth_tokens` ADD CONSTRAINT `fk_staff_auth_tokens_1` FOREIGN KEY (`staff_id`) REFERENCES `staff` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `auth_challenges` ADD CONSTRAINT `fk_auth_challenges_1` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `member_line_links` ADD CONSTRAINT `fk_member_line_links_1` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `member_consents` ADD CONSTRAINT `fk_member_consents_1` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `member_consents` ADD CONSTRAINT `fk_member_consents_2` FOREIGN KEY (`legal_document_id`) REFERENCES `legal_documents` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `member_notes` ADD CONSTRAINT `fk_member_notes_1` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `member_notes` ADD CONSTRAINT `fk_member_notes_2` FOREIGN KEY (`booking_id`) REFERENCES `bookings` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `member_notes` ADD CONSTRAINT `fk_member_notes_3` FOREIGN KEY (`staff_id`) REFERENCES `staff` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `price_profile_versions` ADD CONSTRAINT `fk_price_profile_versions_1` FOREIGN KEY (`price_profile_id`) REFERENCES `price_profiles` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `price_profile_versions` ADD CONSTRAINT `fk_price_profile_versions_2` FOREIGN KEY (`published_by`) REFERENCES `staff` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `price_time_rules` ADD CONSTRAINT `fk_price_time_rules_1` FOREIGN KEY (`price_version_id`) REFERENCES `price_profile_versions` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `price_packages` ADD CONSTRAINT `fk_price_packages_1` FOREIGN KEY (`price_version_id`) REFERENCES `price_profile_versions` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `price_assignments` ADD CONSTRAINT `fk_price_assignments_1` FOREIGN KEY (`price_version_id`) REFERENCES `price_profile_versions` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `price_assignments` ADD CONSTRAINT `fk_price_assignments_2` FOREIGN KEY (`room_id`) REFERENCES `rooms` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `bookings` ADD CONSTRAINT `fk_bookings_1` FOREIGN KEY (`room_group_id`, `store_id`) REFERENCES `room_groups` (`id`, `store_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `bookings` ADD CONSTRAINT `fk_bookings_2` FOREIGN KEY (`requested_room_id`, `store_id`, `room_group_id`) REFERENCES `rooms` (`id`, `store_id`, `room_group_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `bookings` ADD CONSTRAINT `fk_bookings_3` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `bookings` ADD CONSTRAINT `fk_bookings_4` FOREIGN KEY (`created_by_staff_id`) REFERENCES `staff` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `bookings` ADD CONSTRAINT `fk_bookings_5` FOREIGN KEY (`policy_document_id`) REFERENCES `legal_documents` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `inventory_day_locks` ADD CONSTRAINT `fk_inventory_day_locks_1` FOREIGN KEY (`room_group_id`) REFERENCES `room_groups` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `booking_assignments` ADD CONSTRAINT `fk_booking_assignments_1` FOREIGN KEY (`booking_id`, `store_id`, `room_group_id`) REFERENCES `bookings` (`id`, `store_id`, `room_group_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `booking_assignments` ADD CONSTRAINT `fk_booking_assignments_2` FOREIGN KEY (`room_id`, `store_id`, `room_group_id`) REFERENCES `rooms` (`id`, `store_id`, `room_group_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `booking_assignments` ADD CONSTRAINT `fk_booking_assignments_3` FOREIGN KEY (`staff_id`) REFERENCES `staff` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `room_blocks` ADD CONSTRAINT `fk_room_blocks_1` FOREIGN KEY (`room_id`) REFERENCES `rooms` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `room_blocks` ADD CONSTRAINT `fk_room_blocks_2` FOREIGN KEY (`created_by`) REFERENCES `staff` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `room_blocks` ADD CONSTRAINT `fk_room_blocks_3` FOREIGN KEY (`released_by`) REFERENCES `staff` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `price_calculations` ADD CONSTRAINT `fk_price_calculations_1` FOREIGN KEY (`booking_id`) REFERENCES `bookings` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `price_calculations` ADD CONSTRAINT `fk_price_calculations_2` FOREIGN KEY (`price_version_id`) REFERENCES `price_profile_versions` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `booking_cancellations` ADD CONSTRAINT `fk_booking_cancellations_1` FOREIGN KEY (`booking_id`) REFERENCES `bookings` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `booking_cancellations` ADD CONSTRAINT `fk_booking_cancellations_2` FOREIGN KEY (`policy_document_id`) REFERENCES `legal_documents` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `booking_cancellations` ADD CONSTRAINT `fk_booking_cancellations_3` FOREIGN KEY (`staff_id`) REFERENCES `staff` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `payments` ADD CONSTRAINT `fk_payments_1` FOREIGN KEY (`price_calculation_id`, `booking_id`) REFERENCES `price_calculations` (`id`, `booking_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `payments` ADD CONSTRAINT `fk_payments_2` FOREIGN KEY (`booking_id`) REFERENCES `bookings` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `refunds` ADD CONSTRAINT `fk_refunds_1` FOREIGN KEY (`payment_id`, `booking_id`) REFERENCES `payments` (`id`, `booking_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `refunds` ADD CONSTRAINT `fk_refunds_2` FOREIGN KEY (`cancellation_id`) REFERENCES `booking_cancellations` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `refunds` ADD CONSTRAINT `fk_refunds_3` FOREIGN KEY (`requested_by`) REFERENCES `staff` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `payment_links` ADD CONSTRAINT `fk_payment_links_1` FOREIGN KEY (`booking_id`) REFERENCES `bookings` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `payment_links` ADD CONSTRAINT `fk_payment_links_2` FOREIGN KEY (`issued_by`) REFERENCES `staff` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `webhook_events` ADD CONSTRAINT `fk_webhook_events_1` FOREIGN KEY (`payment_id`) REFERENCES `payments` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `webhook_events` ADD CONSTRAINT `fk_webhook_events_2` FOREIGN KEY (`booking_id`) REFERENCES `bookings` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `receipts` ADD CONSTRAINT `fk_receipts_1` FOREIGN KEY (`payment_id`, `booking_id`) REFERENCES `payments` (`id`, `booking_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `receipts` ADD CONSTRAINT `fk_receipts_2` FOREIGN KEY (`refund_id`) REFERENCES `refunds` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `receipts` ADD CONSTRAINT `fk_receipts_3` FOREIGN KEY (`issued_by`) REFERENCES `staff` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `receipt_tax_lines` ADD CONSTRAINT `fk_receipt_tax_lines_1` FOREIGN KEY (`receipt_id`) REFERENCES `receipts` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `coupons` ADD CONSTRAINT `fk_coupons_1` FOREIGN KEY (`created_by`) REFERENCES `staff` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `coupon_versions` ADD CONSTRAINT `fk_coupon_versions_1` FOREIGN KEY (`coupon_id`) REFERENCES `coupons` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `coupon_versions` ADD CONSTRAINT `fk_coupon_versions_2` FOREIGN KEY (`published_by`) REFERENCES `staff` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `coupon_stores` ADD CONSTRAINT `fk_coupon_stores_1` FOREIGN KEY (`coupon_version_id`) REFERENCES `coupon_versions` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `coupon_stores` ADD CONSTRAINT `fk_coupon_stores_2` FOREIGN KEY (`store_id`) REFERENCES `stores` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `coupon_room_types` ADD CONSTRAINT `fk_coupon_room_types_1` FOREIGN KEY (`coupon_version_id`) REFERENCES `coupon_versions` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `coupon_room_types` ADD CONSTRAINT `fk_coupon_room_types_2` FOREIGN KEY (`room_type_id`) REFERENCES `room_types` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `coupon_campaigns` ADD CONSTRAINT `fk_coupon_campaigns_1` FOREIGN KEY (`coupon_version_id`) REFERENCES `coupon_versions` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `coupon_campaigns` ADD CONSTRAINT `fk_coupon_campaigns_2` FOREIGN KEY (`issued_by`) REFERENCES `staff` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `coupon_grants` ADD CONSTRAINT `fk_coupon_grants_1` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `coupon_grants` ADD CONSTRAINT `fk_coupon_grants_2` FOREIGN KEY (`coupon_version_id`) REFERENCES `coupon_versions` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `coupon_grants` ADD CONSTRAINT `fk_coupon_grants_3` FOREIGN KEY (`campaign_id`) REFERENCES `coupon_campaigns` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `coupon_grants` ADD CONSTRAINT `fk_coupon_grants_4` FOREIGN KEY (`granted_by`) REFERENCES `staff` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `coupon_redemptions` ADD CONSTRAINT `fk_coupon_redemptions_1` FOREIGN KEY (`coupon_grant_id`) REFERENCES `coupon_grants` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `coupon_redemptions` ADD CONSTRAINT `fk_coupon_redemptions_2` FOREIGN KEY (`booking_id`) REFERENCES `bookings` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `lock_devices` ADD CONSTRAINT `fk_lock_devices_1` FOREIGN KEY (`store_id`) REFERENCES `stores` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `access_keys` ADD CONSTRAINT `fk_access_keys_1` FOREIGN KEY (`booking_id`, `store_id`) REFERENCES `bookings` (`id`, `store_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `access_keys` ADD CONSTRAINT `fk_access_keys_2` FOREIGN KEY (`lock_device_id`, `store_id`) REFERENCES `lock_devices` (`id`, `store_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `key_events` ADD CONSTRAINT `fk_key_events_1` FOREIGN KEY (`access_key_id`) REFERENCES `access_keys` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `key_events` ADD CONSTRAINT `fk_key_events_2` FOREIGN KEY (`lock_device_id`) REFERENCES `lock_devices` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `key_events` ADD CONSTRAINT `fk_key_events_3` FOREIGN KEY (`booking_id`) REFERENCES `bookings` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `key_events` ADD CONSTRAINT `fk_key_events_4` FOREIGN KEY (`staff_id`) REFERENCES `staff` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `cleaning_tasks` ADD CONSTRAINT `fk_cleaning_tasks_1` FOREIGN KEY (`room_id`) REFERENCES `rooms` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `cleaning_tasks` ADD CONSTRAINT `fk_cleaning_tasks_2` FOREIGN KEY (`booking_id`) REFERENCES `bookings` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `cleaning_tasks` ADD CONSTRAINT `fk_cleaning_tasks_3` FOREIGN KEY (`assigned_staff_id`) REFERENCES `staff` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `cleaning_logs` ADD CONSTRAINT `fk_cleaning_logs_1` FOREIGN KEY (`task_id`) REFERENCES `cleaning_tasks` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `cleaning_logs` ADD CONSTRAINT `fk_cleaning_logs_2` FOREIGN KEY (`staff_id`) REFERENCES `staff` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `booking_usage_events` ADD CONSTRAINT `fk_booking_usage_events_1` FOREIGN KEY (`booking_id`) REFERENCES `bookings` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `booking_usage_events` ADD CONSTRAINT `fk_booking_usage_events_2` FOREIGN KEY (`room_id`) REFERENCES `rooms` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `booking_usage_events` ADD CONSTRAINT `fk_booking_usage_events_3` FOREIGN KEY (`latest_cleaning_log_id`) REFERENCES `cleaning_logs` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `notification_templates` ADD CONSTRAINT `fk_notification_templates_1` FOREIGN KEY (`store_id`) REFERENCES `stores` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `notification_template_versions` ADD CONSTRAINT `fk_notification_template_versions_1` FOREIGN KEY (`template_id`) REFERENCES `notification_templates` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `notification_template_versions` ADD CONSTRAINT `fk_notification_template_versions_2` FOREIGN KEY (`published_by`) REFERENCES `staff` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `notification_deliveries` ADD CONSTRAINT `fk_notification_deliveries_1` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `notification_deliveries` ADD CONSTRAINT `fk_notification_deliveries_2` FOREIGN KEY (`booking_id`) REFERENCES `bookings` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `notification_deliveries` ADD CONSTRAINT `fk_notification_deliveries_3` FOREIGN KEY (`coupon_grant_id`) REFERENCES `coupon_grants` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `notification_deliveries` ADD CONSTRAINT `fk_notification_deliveries_4` FOREIGN KEY (`payment_link_id`) REFERENCES `payment_links` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `notification_deliveries` ADD CONSTRAINT `fk_notification_deliveries_5` FOREIGN KEY (`template_version_id`) REFERENCES `notification_template_versions` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `notification_attempts` ADD CONSTRAINT `fk_notification_attempts_1` FOREIGN KEY (`delivery_id`) REFERENCES `notification_deliveries` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `alerts` ADD CONSTRAINT `fk_alerts_1` FOREIGN KEY (`store_id`) REFERENCES `stores` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `alerts` ADD CONSTRAINT `fk_alerts_2` FOREIGN KEY (`booking_id`) REFERENCES `bookings` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `alerts` ADD CONSTRAINT `fk_alerts_3` FOREIGN KEY (`payment_id`) REFERENCES `payments` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `alerts` ADD CONSTRAINT `fk_alerts_4` FOREIGN KEY (`lock_device_id`) REFERENCES `lock_devices` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `alerts` ADD CONSTRAINT `fk_alerts_5` FOREIGN KEY (`delivery_id`) REFERENCES `notification_deliveries` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `alerts` ADD CONSTRAINT `fk_alerts_6` FOREIGN KEY (`webhook_event_id`) REFERENCES `webhook_events` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `alerts` ADD CONSTRAINT `fk_alerts_7` FOREIGN KEY (`assigned_staff_id`) REFERENCES `staff` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `audit_logs` ADD CONSTRAINT `fk_audit_logs_1` FOREIGN KEY (`staff_id`) REFERENCES `staff` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `audit_logs` ADD CONSTRAINT `fk_audit_logs_2` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `audit_logs` ADD CONSTRAINT `fk_audit_logs_3` FOREIGN KEY (`store_id`) REFERENCES `stores` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `report_exports` ADD CONSTRAINT `fk_report_exports_1` FOREIGN KEY (`staff_id`) REFERENCES `staff` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `report_exports` ADD CONSTRAINT `fk_report_exports_2` FOREIGN KEY (`store_id`) REFERENCES `stores` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `batch_runs` ADD CONSTRAINT `fk_batch_runs_1` FOREIGN KEY (`store_id`) REFERENCES `stores` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `batch_runs` ADD CONSTRAINT `fk_batch_runs_2` FOREIGN KEY (`triggered_by`) REFERENCES `staff` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `room_activity_logs` ADD CONSTRAINT `fk_room_activity_logs_1` FOREIGN KEY (`task_id`, `room_id`) REFERENCES `cleaning_tasks` (`id`, `room_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `room_activity_logs` ADD CONSTRAINT `fk_room_activity_logs_2` FOREIGN KEY (`room_id`) REFERENCES `rooms` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `room_activity_logs` ADD CONSTRAINT `fk_room_activity_logs_3` FOREIGN KEY (`staff_id`) REFERENCES `staff` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `booking_change_history` ADD CONSTRAINT `fk_booking_change_history_1` FOREIGN KEY (`booking_id`) REFERENCES `bookings` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `booking_change_history` ADD CONSTRAINT `fk_booking_change_history_2` FOREIGN KEY (`staff_id`) REFERENCES `staff` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `booking_change_history` ADD CONSTRAINT `fk_booking_change_history_3` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `booking_change_history` ADD CONSTRAINT `fk_booking_change_history_4` FOREIGN KEY (`policy_document_id`) REFERENCES `legal_documents` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
