CREATE TABLE IF NOT EXISTS ultron_sensor_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('camera_snapshot','drone_telemetry','aircraft_telemetry','aircraft_maintenance','site_sensor')),
  source_label TEXT NOT NULL,
  captured_at TIMESTAMPTZ,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  assessment JSONB NOT NULL DEFAULT '{}'::jsonb,
  review_status TEXT NOT NULL DEFAULT 'pending_human_review' CHECK (review_status IN ('pending_human_review','reviewed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ultron_sensor_observations_owner_time
  ON ultron_sensor_observations(owner_id,created_at DESC);