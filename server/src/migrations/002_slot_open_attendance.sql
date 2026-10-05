-- Slot "kick-in": a slot's crews may board only after an organizer opens the slot,
-- and Sprint 1 cannot start before that. Attendance (team.checked_in_at) gates crew login
-- when the rule `attendanceGatesLogin` is on (default).
ALTER TABLE slot ADD COLUMN opened_at timestamptz;
ALTER TABLE slot ADD COLUMN opened_by uuid REFERENCES organizer_user(id);
