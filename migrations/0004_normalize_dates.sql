-- 日付は ISO8601 (YYYY-MM-DD) に揃える。
-- スプレッドシート由来の "2022/05/26" のままだと input[type=date] が値を捨てる。
UPDATE members SET join_date = REPLACE(join_date, '/', '-') WHERE join_date LIKE '%/%';
UPDATE members SET leave_date = REPLACE(leave_date, '/', '-') WHERE leave_date LIKE '%/%';
