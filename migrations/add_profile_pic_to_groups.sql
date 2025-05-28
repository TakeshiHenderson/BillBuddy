-- Add profile_picture column to groups table
ALTER TABLE groups
ADD COLUMN profile_picture VARCHAR(255) DEFAULT NULL; 