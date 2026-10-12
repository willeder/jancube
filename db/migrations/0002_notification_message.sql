-- Rendered notification text, encrypted (it can contain entry codes), so retries resend exactly the
-- message that was queued even if the template changes in between (F-NTF-09).
ALTER TABLE `notification_deliveries`
  ADD COLUMN `message_ciphertext` BLOB NULL COMMENT '送信文面暗号文(再送用)' AFTER `destination_ciphertext`;
