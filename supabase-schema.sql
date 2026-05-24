-- ============================================
-- OGFX Trading Platform - Complete Schema
-- Run this in Supabase SQL Editor
-- ============================================

-- 1. USERS TABLE
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone TEXT UNIQUE NOT NULL,
    telegram_id TEXT,
    telegram_chat_id TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. USER SUBSCRIPTIONS TABLE
CREATE TABLE IF NOT EXISTS user_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    pair TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, pair)
);

-- 3. TELEGRAM SUBSCRIPTIONS TABLE
CREATE TABLE IF NOT EXISTS telegram_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    chat_id TEXT UNIQUE NOT NULL,
    username TEXT,
    first_name TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. SIGNALS TABLE
CREATE TABLE IF NOT EXISTS signals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pair TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('BUY', 'SELL')),
    entry DECIMAL(20, 8) NOT NULL,
    stop_loss DECIMAL(20, 8) NOT NULL,
    take_profit DECIMAL(20, 8)[] DEFAULT '{}',
    confidence INTEGER CHECK (confidence >= 0 AND confidence <= 100),
    grade TEXT CHECK (grade IN ('S', 'A+', 'A', 'B', 'C')),
    reason TEXT,
    smc_data JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. TRADES TABLE
CREATE TABLE IF NOT EXISTS trades (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    signal_id UUID REFERENCES signals(id) ON DELETE SET NULL,
    pair TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('BUY', 'SELL')),
    entry DECIMAL(20, 8) NOT NULL,
    exit_price DECIMAL(20, 8),
    stop_loss DECIMAL(20, 8) NOT NULL,
    take_profit DECIMAL(20, 8)[] DEFAULT '{}',
    status TEXT DEFAULT 'open' CHECK (status IN ('open', 'closed', 'cancelled')),
    pnl DECIMAL(20, 8) DEFAULT 0,
    pnl_percent DECIMAL(5, 2) DEFAULT 0,
    close_reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    closed_at TIMESTAMP WITH TIME ZONE
);

-- 6. STRATEGY CONFIG TABLE
CREATE TABLE IF NOT EXISTS strategy_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    risk_per_trade DECIMAL(4, 2) DEFAULT 1.00,
    max_trades_per_day INTEGER DEFAULT 3,
    max_daily_loss DECIMAL(5, 2) DEFAULT 3.00,
    min_confidence INTEGER DEFAULT 75,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- INDEXES FOR PERFORMANCE
-- ============================================

CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user_id ON user_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_pair ON user_subscriptions(pair);
CREATE INDEX IF NOT EXISTS idx_signals_pair ON signals(pair);
CREATE INDEX IF NOT EXISTS idx_signals_created_at ON signals(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_signals_is_active ON signals(is_active);
CREATE INDEX IF NOT EXISTS idx_trades_signal_id ON trades(signal_id);
CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
CREATE INDEX IF NOT EXISTS idx_telegram_sub_chat_id ON telegram_subscriptions(chat_id);
CREATE INDEX IF NOT EXISTS idx_telegram_sub_user_id ON telegram_subscriptions(user_id);

-- ============================================
-- ENABLE RLS (ROW LEVEL SECURITY)
-- ============================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategy_config ENABLE ROW LEVEL SECURITY;

-- ============================================
-- RLS POLICIES
-- ============================================

-- Users: Allow all for now (use service role key in backend)
CREATE POLICY IF NOT EXISTS "Allow all" ON users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "Allow all subs" ON user_subscriptions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "Allow all telegram" ON telegram_subscriptions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "Allow all signals" ON signals FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "Allow all trades" ON trades FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "Allow all config" ON strategy_config FOR ALL USING (true) WITH CHECK (true);

-- ============================================
-- TRIGGERS FOR UPDATED_AT
-- ============================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_users_updated_at ON users;
DROP TRIGGER IF EXISTS update_user_subscriptions_updated_at ON user_subscriptions;
DROP TRIGGER IF EXISTS update_telegram_subscriptions_updated_at ON telegram_subscriptions;
DROP TRIGGER IF EXISTS update_signals_updated_at ON signals;
DROP TRIGGER IF EXISTS update_strategy_config_updated_at ON strategy_config;

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_subscriptions_updated_at BEFORE UPDATE ON user_subscriptions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_telegram_subscriptions_updated_at BEFORE UPDATE ON telegram_subscriptions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_signals_updated_at BEFORE UPDATE ON signals
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_strategy_config_updated_at BEFORE UPDATE ON strategy_config
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- INSERT DEFAULT DATA
-- ============================================

INSERT INTO strategy_config (name, risk_per_trade, max_trades_per_day, max_daily_loss, min_confidence)
VALUES ('ELITE_SMC_STRATEGY', 1.00, 3, 3.00, 85)
ON CONFLICT DO NOTHING;
