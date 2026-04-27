-- Run once on first deploy: psql $DATABASE_URL -f schema.sql

CREATE TABLE IF NOT EXISTS open_orders (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id              text        NOT NULL,
  license_plate        text        NOT NULL,
  plate_type           text        NOT NULL,
  mileage              integer,
  car_data             jsonb,        -- ERP Wave 1 response stored here
  diagnosis            jsonb,        -- mechanic selections + Carool results per wheel
  status               text        NOT NULL DEFAULT 'open',
  request_id           text,         -- ERP's identifier, set after Wave 1
  carool_diagnosis_id  text,         -- Carool session ID, set on first photo
  erp_hash             text        NOT NULL,
  declined_at          timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- status values: 'open' | 'waiting' | 'approved' | 'partly-approved' | 'declined'

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_updated_at ON open_orders;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON open_orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX IF NOT EXISTS idx_open_orders_shop_id     ON open_orders (shop_id);
CREATE INDEX IF NOT EXISTS idx_open_orders_status      ON open_orders (status);
CREATE INDEX IF NOT EXISTS idx_open_orders_request_id  ON open_orders (request_id) WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_open_orders_declined_at ON open_orders (declined_at) WHERE declined_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS erp_action_codes (
  id               serial  PRIMARY KEY,
  erp_code         integer NOT NULL UNIQUE,
  description      text    NOT NULL,
  frontend_action  text,
  frontend_reason  text
);

CREATE TABLE IF NOT EXISTS erp_tire_locations (
  id               serial  PRIMARY KEY,
  erp_code         integer NOT NULL UNIQUE,
  description      text    NOT NULL,
  wheel_position   text    NOT NULL
);

INSERT INTO erp_action_codes (erp_code, description, frontend_action, frontend_reason) VALUES
  (2,  'כיוון פרונט',         'front_alignment', null),
  (3,  'בלאי,שחיקה,יובש',    'replacement',     'wear'),
  (4,  'נסיעה על תקר',        'puncture',        null),
  (23, 'נזק- קרע בצמיג',      'replacement',     'damage'),
  (25, 'מידת הצמיג שגויה',    'replacement',     'fitment')
ON CONFLICT (erp_code) DO NOTHING;

INSERT INTO erp_tire_locations (erp_code, description, wheel_position) VALUES
  (1, 'קידמי שמאלי',          'front-left'),
  (2, 'קידמי ימני',           'front-right'),
  (3, 'אחורי ימני',           'rear-right'),
  (4, 'אחורי שמאלי',          'rear-left'),
  (5, 'ספייר',                'spare-tire'),
  (6, 'ללא מיקום',            'no-location'),
  (7, 'אחורי שמאלי פנימי',    'rear-left-inner'),
  (8, 'אחורי ימני פנימי',     'rear-right-inner')
ON CONFLICT (erp_code) DO NOTHING;
