# Capstone-BE

## Local MySQL connection check

Use Node.js 24 LTS. Install dependencies with `npm ci`, copy `.env.example`
to `.env` if it does not already exist, and start the local database with
`docker compose up -d`. The example credentials match the local development
database in `compose.yaml`; update `.env` if you changed those credentials.

Once MySQL is ready, run:

```sh
npm run db:check
```

This runs a read-only query through `mysql2` and prints the server version and
current database (`woof_paws`). The database is exposed at `127.0.0.1:3307`.
In PowerShell, use `npm.cmd` if execution policy blocks `npm.ps1`.

The connection check does not start the API, create tables, or migrate data.
Registration, login, and current-user lookup now use MySQL. The remaining API
models still use MongoDB while the migration is in progress.

## Run the local API

With the database running and migrations applied, generate a local JWT signing
secret once (also required when upgrading from the registration-only version):

```sh
npm run auth:setup
```

This adds a random secret to the ignored `.env` without printing it. Existing
valid secrets are preserved. `.env.example` intentionally leaves `JWT_SECRET`
empty; never commit your real secret. Restart an already running API to load it.
The server requires a secret of at least 32 bytes; `auth:setup` generates 32
random bytes encoded as hex.

Start the API:

```sh
npm run dev
```

The API listens at `http://127.0.0.1:3001` by default. `PORT` and `API_HOST` can
override these defaults. Both `npm run dev` and `npm start` load `.env` using
Node.js 24's built-in environment-file support. The server verifies its MySQL
connection before listening.

`POST /users/register` accepts JSON or text-only multipart/form-data, matching
the currently enabled fields in the frontend registration form:

```json
{
  "name": "Test",
  "surname": "User",
  "age": 30,
  "email": "test@example.com",
  "password": "Local-test-password-42",
  "description": "I would like to adopt a dog."
}
```

Success returns HTTP 201 with `{ "_id": "<uuid>" }`. The API trims names and
email, lowercases email, hashes the password with bcrypt, and always creates a
`user` role regardless of submitted role fields. Duplicate email returns 409,
invalid fields return 400, and unsupported content types return 415. Passwords
must contain at least 8 characters and at most 72 UTF-8 bytes to avoid bcrypt
truncation. Age must be an integer from 0 to 130; description is required and
limited to 5000 characters. Picture uploads are deferred; new users have a
null picture.

`POST /users/login` accepts JSON with the registered user's `email` and
`password`. It normalizes email in the same way as registration and checks the
bcrypt hash in MySQL. Success returns HTTP 200:

```json
{
  "user": {
    "_id": "<uuid>",
    "name": "Test",
    "surname": "User",
    "age": 30,
    "email": "test@example.com",
    "picture": null,
    "role": "user",
    "description": "I would like to adopt a dog."
  },
  "accessToken": "<jwt>"
}
```

Wrong passwords and unknown emails both return 401 with the same message.
Invalid fields return 400; unsupported content types return 415. Passwords
are never trimmed and values beyond bcrypt's 72-byte limit are rejected.

`GET /users/me` requires `Authorization: Bearer <accessToken>` and returns the
same public user fields, freshly read from MySQL. Neither endpoint returns a
password hash. Missing, invalid, or expired tokens and deleted users return
401. Tokens expire after one hour; signature, HS256 algorithm, issuer, and
audience are checked. Login and profile responses use `Cache-Control: no-store`.
No refresh-token or server-side logout/revocation flow has been migrated yet;
log in again after expiry. Changing `JWT_SECRET` invalidates existing tokens.

User listing/editing/deletion, logout, dog, and adoption endpoints have not yet
been migrated. Without `MONGO_URL`, they return 503 immediately. If explicitly
configured, MongoDB enables those legacy endpoints, but they still read the
old collections. MySQL accounts and tokens do not provide access to those old
accounts. This local authentication step does not add login rate limiting;
add abuse controls before exposing the API publicly.

The frontend still contains its old Railway API URL. This step preserves its
registration and login request/response formats, including the profile lookup
immediately after login; connecting it to the local API is a subsequent step.

## MySQL schema and migrations

The SQL schema is defined in `src/db/schema.ts`. Drizzle Kit reads the same
`.env` connection settings as `db:check`.

Apply the committed migrations to the local database:

```sh
npm run db:migrate
```

After editing the schema, generate a migration, review the SQL in `drizzle/`,
then apply it:

```sh
npm run db:generate -- --name=describe_the_change
npm run db:migrate
```

Commit the SQL files and `drizzle/meta` together. Drizzle records applied
migrations in `__drizzle_migrations`, so rerunning `db:migrate` skips migrations
already applied. MySQL DDL does not provide a fully transactional rollback;
inspect the database before retrying a migration that failed partway through.

The first migration creates `users` with UUID IDs, a unique email, a password
hash, profile fields, roles, and timestamps. UUIDs are generated by Drizzle
when inserting a user; raw SQL inserts must provide an ID. Password hashing
and input validation are handled by the registration endpoint, not the schema.

## Project Overview
This project is a dog fostering service website that allows dog shelters to provide details about dogs up for adoption, and users to browse and adopt dogs. The website includes three types of users: admins, dog shelters, and users interested in adopting dogs.

## Technologies Used
This backend of the project was built using the following technologies:

* NodeJS: a JavaScript runtime built on Chrome's V8 JavaScript engine.
* ExpressJS: a web application framework for NodeJS.
* MongoDB: a document-based NoSQL database.

## API Endpoints
The backend API includes the following endpoints:

* POST /users/register: Creates a user in MySQL.
* POST /users/login: Authenticates a MySQL user and returns a one-hour JWT.
* GET /users/me: Returns the authenticated MySQL user's public profile.
* /users, /dogs, /adoptions: Remaining legacy routes, pending migration.

Routes do not use an `/api` prefix. Separate shelter and admin login routes are
part of the original idea and have not been implemented.

## API Documentation
The API documentation is available through Postman, and includes information about all endpoints, input and output formats, and any necessary authentication or authorization requirements.

## Database Schema
The MySQL schema is in `src/db/schema.ts`, with migrations in `drizzle/`.
Legacy MongoDB models remain under `src/api/` until their routes are migrated.

## Testing
Run `npm test` with the local MySQL database running and migrations applied.
The user integration tests use real HTTP requests and MySQL queries.
They cover JSON and multipart registration, password hashing, role assignment,
input validation, duplicate and concurrent registrations, login, profile
lookup, rejected JWTs, safe database errors, and startup without MongoDB.
Test registrations run in transactions that are rolled back; the tests do not
truncate tables or leave test users behind. Auth setup tests use temporary
directories and never change your `.env`. Tests supply their own signing key.

## Contributors
This project is developed by Ioannis Psychias and any other team members or collaborators.

## License
The project is licensed under [Insert License Here].
