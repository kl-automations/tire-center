-- ERP tire level + location lookup tables (mechanic PWA / sync-erp-tables).

CREATE TABLE IF NOT EXISTS erp_tire_level_codes (
    code        INTEGER PRIMARY KEY,
    description TEXT NOT NULL
);

INSERT INTO erp_tire_level_codes (code, description) VALUES
    (1, 'פרימיום'),
    (2, 'ביניים'),
    (3, 'חסכוני')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description;

CREATE TABLE IF NOT EXISTS erp_tire_location_codes (
    code         INTEGER PRIMARY KEY,
    description  TEXT NOT NULL,
    position_key TEXT
);

INSERT INTO erp_tire_location_codes (code, description, position_key) VALUES
    (1, 'קידמי שמאלי',      'front-left'),
    (2, 'קידמי ימני',       'front-right'),
    (3, 'אחורי ימני',       'rear-right'),
    (4, 'אחורי שמאלי',      'rear-left'),
    (5, 'ספייר',            'spare-tire'),
    (6, 'ללא מיקום',        NULL),
    (7, 'אחורי שמאלי פנימי','rear-left-inner'),
    (8, 'אחורי ימני פנימי', 'rear-right-inner')
ON CONFLICT (code) DO UPDATE SET
    description  = EXCLUDED.description,
    position_key = EXCLUDED.position_key;
