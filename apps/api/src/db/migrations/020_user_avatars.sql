-- Optional profile photo, already cropped and resized by the client. Only
-- raster formats are accepted (no SVG, which could carry scripts) and the
-- size is capped so a row stays small.
ALTER TABLE users
  ADD COLUMN avatar bytea,
  ADD COLUMN avatar_mime text CHECK (avatar_mime IN ('image/jpeg','image/png','image/webp')),
  ADD COLUMN avatar_updated_at timestamptz,
  ADD CONSTRAINT users_avatar_complete CHECK (
    (avatar IS NULL) = (avatar_mime IS NULL) AND (avatar IS NULL) = (avatar_updated_at IS NULL)
  ),
  ADD CONSTRAINT users_avatar_size CHECK (avatar IS NULL OR octet_length(avatar) BETWEEN 1 AND 524288);
