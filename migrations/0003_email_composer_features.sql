ALTER TABLE email_logs ADD COLUMN cc TEXT NOT NULL DEFAULT '[]';
ALTER TABLE email_logs ADD COLUMN bcc TEXT NOT NULL DEFAULT '[]';
ALTER TABLE email_logs ADD COLUMN reply_to TEXT;
ALTER TABLE email_logs ADD COLUMN from_name TEXT;
ALTER TABLE email_logs ADD COLUMN content_mode TEXT NOT NULL DEFAULT 'text';
ALTER TABLE email_logs ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal';
ALTER TABLE email_logs ADD COLUMN attachment_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE email_logs ADD COLUMN recipient_count INTEGER NOT NULL DEFAULT 1;

UPDATE email_logs
SET recipient = json_array(recipient)
WHERE json_valid(recipient) = 0;
