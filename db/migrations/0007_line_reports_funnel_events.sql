-- F-RPT-01 ファネル計測イベント (additive; no change to existing tables).
-- Page-view steps of the booking funnel that leave no other trace in the database
-- (store selected, availability viewed, LIFF opened). Later steps (hold, sign-in, checkout,
-- confirmation) are counted from bookings/payments, so they are not duplicated here; the step list
-- still allows them so instrumentation can be added later without a migration.
-- A log table: no foreign keys, so rows never block deletes/anonymisation of other data.
CREATE TABLE `funnel_events` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部ID',
  `visitor_key` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '匿名訪問者キー(Cookie)',
  `step` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'ファネル段階',
  `channel` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'web' COMMENT '経路',
  `store_id` BIGINT UNSIGNED NULL COMMENT '店舗ID',
  `member_id` BIGINT UNSIGNED NULL COMMENT '会員ID(ログイン中のみ)',
  `utm_source` VARCHAR(191) NULL COMMENT 'UTM source',
  `occurred_at` DATETIME(6) NOT NULL COMMENT '発生日時(UTC)',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '作成日時(UTC)',
  PRIMARY KEY (`id`),
  KEY `ix_funnel_events_1` (`occurred_at`, `step`),
  KEY `ix_funnel_events_2` (`store_id`, `occurred_at`),
  CONSTRAINT `ck_funnel_events_1` CHECK (step IN ('liff_opened','store_selected','slots_viewed','hold_created','signed_in','checkout_started','confirmed')),
  CONSTRAINT `ck_funnel_events_2` CHECK (channel IN ('web','liff'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='予約ファネル計測イベント';
