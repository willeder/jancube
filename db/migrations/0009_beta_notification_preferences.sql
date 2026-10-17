ALTER TABLE members ADD COLUMN notification_channel VARCHAR(10) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'email';
ALTER TABLE members ADD CONSTRAINT ck_members_notification_channel CHECK (notification_channel IN ('email','line'));
-- Preserve existing routes until customers choose; no implicit blocked-LINE fallback.
UPDATE members m INNER JOIN member_line_links l ON l.member_id = m.id SET m.notification_channel = 'line';
