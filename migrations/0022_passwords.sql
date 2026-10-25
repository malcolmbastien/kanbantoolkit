-- A password, as a hash and nothing else.
--
-- Until task 154 the only way in was an identity provider: an account was a row in `users` plus a
-- row in `identities` saying which provider vouched for it. A team with no provider had no accounts
-- at all — which is a fine deployment and a poor product, because installing the software and being
-- unable to have a single user is not self-hosting.
--
-- So an account may now carry a password. What is stored is the module's own format
-- (`pbkdf2$<iterations>$<salt>$<hash>`, see `server/auth/password.ts`): the cost and the salt travel
-- with the hash so the cost can be raised later without invalidating what exists. There is no
-- column for a password, a reset question, or anything an administrator could read.
--
-- NULL means "this account has no password", which is every account today, and remains a valid
-- state: an OIDC-only account signs in through its issuer and never has one.

ALTER TABLE users ADD COLUMN password_hash TEXT;

INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (22, 'passwords');
