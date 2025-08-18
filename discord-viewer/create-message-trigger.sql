-- Create function to notify on new messages
CREATE OR REPLACE FUNCTION notify_new_message() 
RETURNS trigger AS $$
BEGIN
  -- Only notify for messages from today (Chicago timezone)
  IF NEW.discord_timestamp >= CURRENT_DATE AT TIME ZONE 'America/Chicago' THEN
    PERFORM pg_notify(
      'new_message', 
      json_build_object(
        'id', NEW.id,
        'author_id', NEW.author_id,
        'content', NEW.content,
        'timestamp', NEW.discord_timestamp
      )::text
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger on messages table
DROP TRIGGER IF EXISTS message_insert_notify ON messages;
CREATE TRIGGER message_insert_notify
AFTER INSERT ON messages
FOR EACH ROW
EXECUTE FUNCTION notify_new_message();

-- Also create a trigger for ticker detections
CREATE OR REPLACE FUNCTION notify_ticker_detection() 
RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify(
    'ticker_detected', 
    json_build_object(
      'ticker', NEW.ticker,
      'message_id', NEW.message_id,
      'confidence', NEW.detection_confidence,
      'timestamp', NEW.created_at
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger on ticker_detections table
DROP TRIGGER IF EXISTS ticker_detection_notify ON ticker_detections;
CREATE TRIGGER ticker_detection_notify
AFTER INSERT ON ticker_detections
FOR EACH ROW
EXECUTE FUNCTION notify_ticker_detection();
