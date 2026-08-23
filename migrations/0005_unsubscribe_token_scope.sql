ALTER TABLE user_org_preferences
  ADD COLUMN IF NOT EXISTS unsubscribe_token varchar;

CREATE UNIQUE INDEX IF NOT EXISTS user_org_preferences_unsubscribe_token_unique
  ON user_org_preferences (unsubscribe_token)
  WHERE unsubscribe_token IS NOT NULL;
