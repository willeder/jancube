-- Ephemeral LINE conversation state, encrypted at rest. No message bodies or credentials are logged.
CREATE TABLE line_chat_sessions (
  provider_id VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  line_user_id VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  payload_ciphertext MEDIUMBLOB NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (provider_id, line_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
