CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE users (
    user_id CHAR(36) NOT NULL PRIMARY KEY,
    email VARCHAR(50) NOT NULL UNIQUE,
    password VARCHAR(255), -- Allow NULL for OAuth users
    is_subscribed BOOLEAN NOT NULL DEFAULT FALSE,
    reset_token VARCHAR(50),
    reset_token_expiry TIMESTAMP
);

CREATE TABLE groups (
    group_id CHAR(36) NOT NULL PRIMARY KEY,
    group_name VARCHAR(50) NOT NULL
);

CREATE TABLE user_groups (
    group_id CHAR(36) NOT NULL,
    user_id CHAR(36) NOT NULL,
    PRIMARY KEY (group_id, user_id),
    FOREIGN KEY (group_id) REFERENCES groups(group_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE bills (
    bill_id CHAR(36) NOT NULL PRIMARY KEY,
    group_id CHAR(36) NOT NULL,
    payed_by CHAR(36) NOT NULL,
    summarized BOOLEAN NOT NULL,
    date_created DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (group_id) REFERENCES groups(group_id) ON DELETE CASCADE,
    FOREIGN KEY (payed_by) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE items (
    item_id CHAR(36) NOT NULL PRIMARY KEY,
    bill_id CHAR(36) NOT NULL,
    to_be_paid_by CHAR(36) NOT NULL,
    item_name VARCHAR(50) NOT NULL,
    item_price INT NOT NULL,
    already_paid BOOLEAN NOT NULL,
    FOREIGN KEY (bill_id) REFERENCES bills(bill_id) ON DELETE CASCADE,
    FOREIGN KEY (to_be_paid_by) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE invoice (
    invoice_id CHAR(36) NOT NULL PRIMARY KEY,
    date_start DATETIME NOT NULL,
    date_end DATETIME NOT NULL
);

CREATE TABLE record (
    record_id CHAR(36) NOT NULL PRIMARY KEY,
    invoice_id CHAR(36) NOT NULL,
    debtor CHAR(36) NOT NULL,
    debtee CHAR(36) NOT NULL,
    nominal FLOAT NOT NULL,
    already_paid BOOLEAN NOT NULL,
    FOREIGN KEY (invoice_id) REFERENCES invoice(invoice_id) ON DELETE CASCADE,
    FOREIGN KEY (debtor) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (debtee) REFERENCES users(user_id) ON DELETE CASCADE
);

