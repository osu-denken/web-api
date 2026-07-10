-- 部員名簿。Google Spreadsheet からの移行先
CREATE TABLE IF NOT EXISTS members (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id  TEXT    NOT NULL UNIQUE,
    email       TEXT    NOT NULL UNIQUE,
    local_id    TEXT    UNIQUE,
    name        TEXT    NOT NULL,
    furigana    TEXT,
    tel         TEXT,
    -- active 以外は一切の権限を持たない (util/member.ts の effectivePermissions)
    status      TEXT    NOT NULL DEFAULT 'pre-active'
    -- pre-active: 仮登録, active: 部員, withdrawn: 退部, graduated: 卒業, rejected: 却下
                CHECK (status IN ('pre-active', 'active', 'withdrawn', 'graduated', 'rejected')),
    role_bits   INTEGER NOT NULL DEFAULT 0,
    perm_bits   INTEGER NOT NULL DEFAULT 0,
    join_date   TEXT,
    leave_date  TEXT,
    approved_by INTEGER REFERENCES members(id),
    approved_at TEXT,
    -- 将来の項目追加をマイグレーションなしに吸収するための JSON
    custom_data TEXT    NOT NULL DEFAULT '{}'
);

-- 認証は email、名簿引きは student_id、承認画面は status で引く
CREATE INDEX IF NOT EXISTS idx_members_status ON members(status);
