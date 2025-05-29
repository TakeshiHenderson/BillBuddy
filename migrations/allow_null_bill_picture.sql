-- Allow bill_picture to be null in bills table
ALTER TABLE bills MODIFY COLUMN bill_picture VARCHAR(255) NULL; 