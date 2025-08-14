-- Discord Messages Schema
CREATE TABLE IF NOT EXISTS discord_messages (
    id VARCHAR(50) PRIMARY KEY,
    message_type VARCHAR(50),
    content TEXT,
    timestamp TIMESTAMP WITH TIME ZONE,
    timestamp_edited TIMESTAMP WITH TIME ZONE,
    is_pinned BOOLEAN DEFAULT false,
    
    -- Author info
    author_id VARCHAR(50),
    author_name VARCHAR(255),
    author_nickname VARCHAR(255),
    author_discriminator VARCHAR(10),
    author_is_bot BOOLEAN DEFAULT false,
    author_avatar_url TEXT,
    
    -- Channel/Server info
    guild_id VARCHAR(50),
    guild_name VARCHAR(255),
    channel_id VARCHAR(50),
    channel_name VARCHAR(255),
    channel_category VARCHAR(255),
    
    -- Additional data (stored as JSONB for flexibility)
    attachments JSONB,
    embeds JSONB,
    reactions JSONB,
    mentions JSONB,
    roles JSONB,
    
    -- Indexing
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON discord_messages(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_messages_author ON discord_messages(author_name);
CREATE INDEX IF NOT EXISTS idx_messages_content ON discord_messages USING gin(to_tsvector('english', content));
CREATE INDEX IF NOT EXISTS idx_messages_channel ON discord_messages(channel_id);
