-- R2+D1 统一架构 init（D1 存元数据，正文存 R2）
-- 多站共享同一 D1 时用 site_id 区分

CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  first_image TEXT,
  template TEXT NOT NULL DEFAULT 'default',
  category TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft',
  publish_at TEXT,
  expires_at TEXT,
  site_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_articles_category_status ON articles(category, status);
CREATE INDEX IF NOT EXISTS idx_articles_status_updated ON articles(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_articles_site_status ON articles(site_id, status);

CREATE TABLE IF NOT EXISTS seeds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  raw TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '优惠',
  template TEXT NOT NULL DEFAULT 'deal',
  status TEXT NOT NULL DEFAULT 'pending',
  publish_at TEXT,
  expires_at TEXT,
  article_id TEXT,
  error TEXT,
  source TEXT NOT NULL DEFAULT 'admin',
  fp TEXT NOT NULL DEFAULT '',
  site_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_seeds_status ON seeds(status);
CREATE INDEX IF NOT EXISTS idx_seeds_site_status ON seeds(site_id, status);

CREATE TABLE IF NOT EXISTS run_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_at TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  total INTEGER NOT NULL DEFAULT 0,
  ok INTEGER NOT NULL DEFAULT 0,
  fail INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  dry_run INTEGER NOT NULL DEFAULT 0,
  site_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_run_logs_created ON run_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_run_logs_site ON run_logs(site_id, created_at);
