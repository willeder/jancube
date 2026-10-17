-- Register the confirmed end+15-minute message channels. Publish approved wording via A-21;
-- do not attribute an automatic migration to an arbitrary staff publisher.
INSERT INTO notification_templates (event_type,channel,store_id,is_enabled,channel_priority)
VALUES ('usage_completed','email',NULL,1,2),('usage_completed','line',NULL,1,1);
-- Future/current bookings created before this feature also receive their delayed event.
INSERT IGNORE INTO outbox_events (event_key,aggregate_type,aggregate_id,event_type,payload,available_at)
SELECT CONCAT('usage_completed:',id,':',DATE_FORMAT(ends_at,'%Y-%m-%dT%H:%i:%s.000Z')),
'booking',id,'booking.usage_completed',JSON_OBJECT('end',DATE_FORMAT(ends_at,'%Y-%m-%dT%H:%i:%s.000Z')),DATE_ADD(ends_at,INTERVAL 15 MINUTE)
FROM bookings WHERE status='confirmed' AND ends_at>=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 15 MINUTE);
