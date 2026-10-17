-- Confirmed beta rule: 30 minutes between reservations. Existing draft/confirmed reservations
-- are retained; the assignment planner will alert if legacy reservations no longer fit.
UPDATE stores SET cleaning_buffer_minutes=30;
