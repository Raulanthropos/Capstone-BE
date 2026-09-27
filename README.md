# Capstone-BE

## Online demo deployment

See [Render + Aiven deployment](docs/render.md) for the complete setup,
including TLS, environment variables, migrations, demo data and Vercel.


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
Registration, login, current-user lookup, dog listing, and adoption request
submission, own listing, and admin review now use MySQL. The remaining API models still use
MongoDB while the migration is in progress.

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

User listing/editing/deletion, logout, and dog management/individual lookup
have not yet been migrated. Without `MONGO_URL`, they return 503 immediately. If explicitly
configured, MongoDB enables those legacy endpoints, but they still read the
old collections. MySQL accounts and tokens do not provide access to those old
accounts. Login is limited to 20 failed attempts per 15 minutes per IP; registration
to 10 attempts per hour per IP. These single-process limits reset on restart.

The sibling `Capstone-FE` now uses a shared API client configured through
`REACT_APP_API_URL`, defaulting locally to `http://127.0.0.1:3001`. Start it with
`npm start` and open `http://localhost:3000` to register, log in, and view your
profile. The frontend README describes session handling and the features that
remain unavailable during the migration.

## Local dog listing

Apply the migrations and add the local demo records:

```sh
npm run db:migrate
npm run db:seed:dogs
```

The seed creates Luna, Milo, and Rocky with one photo each. These are fictional
demo profiles; their photos are copies of existing repository assets served
locally under `/demo-dogs/`. Cloudinary credentials are not needed. The seed
runs in a transaction and uses fixed IDs. Rerunning it does not create
duplicates or overwrite edits to existing dogs/photos. It does not change
users. In production, the command requires the explicit `--allow-production` flag
for a hosted demo; see the deployment guide.

With both apps running, log in and open `http://localhost:3000/main`.
Refresh an already open page to fetch the new list. Name, breed, age, and
weight sorting work; the existing **Neutered only** checkbox filters the
returned dogs. The adoption button submits requests, and administrators can
review them at `/admin/adoptions`. Dog management still awaits migration.

`GET /dogs` is a public MySQL endpoint and always lists only dogs with
`isAdopted=false`. It returns the array expected by the frontend, including
`_id`, numeric `age` (years) and `weight` (kg), boolean `isNeutered`, and an
ordered `images` array. Images with a relative path are returned with the API
origin so they load correctly from the frontend's different port. Absolute
image URLs are preserved. Dogs without photos have `images: []`.

| Parameter | Default | Accepted values |
| --- | --- | --- |
| `sort` | `name` | `name`, `breed`, `age`, `weight` |
| `order` | `asc` | `asc`, `desc` |
| `isNeutered` | No filter | `true`, `false` |
| `limit` | `100` | Integer from 1 to 100 |
| `offset` | `0` | Integer from 0 to 100000 |

The current frontend shows the first page; pagination controls are not yet
implemented. Equal sort values use ascending ID as a stable tiebreaker.
Invalid, repeated, nested, or unsupported query parameters return 400.
No matches return HTTP 200 with `[]`; database failures return 500.
`/dogs/:id`, image uploads, and write operations remain legacy endpoints.

## Local adoption requests

Apply `npm run db:migrate` to create `adoption_requests`. Both endpoints below
require `Authorization: Bearer <accessToken>` from the MySQL login endpoint
and return `Cache-Control: no-store`.

`POST /adoptions` accepts only this JSON body (no query parameters):

```json
{
  "dogId": "<dog UUID from GET /dogs>"
}
```

The user comes from the verified token. Client-supplied `user`, `userId`,
`status`, and other extra fields are rejected. Success returns HTTP 201:

```json
{
  "_id": "<request UUID>",
  "dogId": "<dog UUID>",
  "status": "pending",
  "createdAt": "2026-09-27T12:00:00.000Z",
  "updatedAt": "2026-09-27T12:00:00.000Z"
}
```

Requests are saved in a transaction. The account and dog are checked and
locked until commit; the dog must exist and be available. A unique user/dog
constraint prevents duplicate requests, including simultaneous submissions.
Different users can apply for the same available dog. Creating a request
does **not** change `dogs.is_adopted`.

| Status | Meaning |
| --- | --- |
| 400 | Invalid body, extra fields, or unsupported query parameters |
| 401 | Missing/invalid/expired token or deleted account |
| 404 | Dog does not exist |
| 409 | Dog is already adopted, or this user already has a request for it |
| 415 | Content type is not application/json |
| 500 | Unexpected server/database failure; private details are omitted |

`GET /adoptions/me` returns an array of the same request fields, restricted to
the authenticated user. Results are ordered by newest creation time, then
descending ID for ties. It accepts only `limit` (1–100, default 100) and
`offset` (0–100000, default 0). Invalid, repeated, or nested parameters return
400. An empty page returns 200 with `[]`. It never accepts another user's ID.

A previous request of any status prevents reapplication for the same dog.
Cancellation and resubmission are not implemented.

## Admin adoption review

Administrators use the same login endpoint as regular users. Public
registration always creates a `user`; creating an admin is a local database
provisioning operation, not a role supplied through the registration form.
Local account passwords and JWT secrets are not committed to this repository.

`GET /adoptions` requires a current MySQL `admin` role. It accepts `status`
(`pending` by default, or `approved`, `rejected`, `all`), plus `limit`
(1-100, default 100) and `offset` (0-100000, default 0). It returns
`{ items, total, limit, offset }`, oldest first with ID as the tiebreaker.
Each item includes the request, applicant name/email/age/description, dog
details, and nullable `reviewedBy` / `reviewedAt` fields. Password hashes are
never returned. Listing and decision responses use `Cache-Control: no-store`.

`PATCH /adoptions/:requestId` accepts only a JSON `status` field:

```json
{ "status": "approved" }
```

Only `pending` requests can become `approved` or `rejected`.
Approval marks the dog adopted and declines all other pending applications
for that dog in the same transaction. Declining changes only the selected
request. The approving admin and timestamp are also recorded for requests
automatically declined as a consequence of that approval. Reviewed requests
cannot be reopened or overwritten through this API.

Success returns the request ID, dog ID, status, review metadata, updated
timestamp and `closedRequests` (the number of competing requests declined).
Missing/expired credentials return 401, a non-admin role returns 403, malformed
input returns 400/415, missing requests return 404, and previously reviewed
requests or approval of an already adopted dog return 409. Database failures
return a generic 500.

The transaction rechecks and locks the admin account, then the dog, then the
request. Dog locking serializes competing approvals and new submissions;
concurrent decisions cannot approve two applications for the same dog.
If any write fails, the decision and availability changes roll back together.

After applying migrations, the frontend's **Review adoption requests** link
opens `/admin/adoptions`. It provides status filters, pagination, applicant
details, and confirmation dialogs describing approval/decline effects.

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

The second migration adds `dogs` and `dog_images`. Age and weight are decimal
columns, so puppies and fractional kilograms are supported. Dog names are
not unique. Each image belongs to a dog through a foreign key; its position
determines display order. Deleting a dog also deletes its image rows.

The third migration adds `adoption_requests` with user/dog foreign keys,
a unique pair, status, and timestamps. Those foreign keys restrict deletion
of users/dogs with requests, preserving request history. Account/dog deletion
policy will need to be handled explicitly when those endpoints are migrated.

The fourth migration adds nullable `reviewed_by` and `reviewed_at` columns.
The reviewer foreign key restricts deletion of an admin referenced by a decision.
Existing pending requests are preserved.

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
* GET /dogs: Lists available dogs and ordered images from MySQL.
* POST /adoptions: Creates a pending MySQL adoption request for the authenticated user.
* GET /adoptions/me: Lists that user's own MySQL adoption requests.
* GET /adoptions: Lists requests and applicant/dog details for administrators.
* PATCH /adoptions/:requestId: Approves or declines a pending request as an administrator.
* Remaining user routes and dog management/individual lookup:
  legacy routes pending migration.

Routes do not use an `/api` prefix. Separate shelter and admin login routes are
part of the original idea and have not been implemented.

## API Documentation
The API documentation is available through Postman, and includes information about all endpoints, input and output formats, and any necessary authentication or authorization requirements.

## Database Schema
The MySQL schema is in `src/db/schema.ts`, with migrations in `drizzle/`.
Legacy MongoDB models remain under `src/api/` until their routes are migrated.

## Testing
Run `npm test` with the local MySQL database running and migrations applied.
The user, dog, and adoption integration tests use real HTTP requests and MySQL queries.
Test files run sequentially because they share the local database; concurrent
submission scenarios still exercise multiple HTTP requests/pooled connections.
They cover JSON and multipart registration, password hashing, role assignment,
input validation, duplicate and concurrent registrations, login, profile
lookup, rejected JWTs, safe database errors, and startup without MongoDB.
Dog tests also cover numeric sorting, filtering, pagination, ordered photos,
schema constraints, local image responses, and repeatable demo seeding.
Adoption tests cover token ownership, availability, duplicate/concurrent
submissions, private listing, pagination, foreign keys, and rollback on failure.
Review tests cover admin access, fresh role checks, decision validation, audit
fields, competing/concurrent decisions, availability changes and atomic rollback.
User/dog test records run in transactions that are rolled back. Adoption tests
commit temporary users/dogs so separate transaction connections can see them,
then remove only their generated UUIDs in cleanup hooks. Those temporary
records may briefly appear in the running local app during tests. Tests do not
truncate tables and check that no test records remain after normal completion.
Auth setup tests use temporary directories and never change your `.env`.
Tests supply their own signing key.

## Contributors
This project is developed by Ioannis Psychias and any other team members or collaborators.

## License
The project is licensed under [Insert License Here].

## Notifications and private adoption conversations

Apply migrations and start the local API with Node 24:

```sh
npm install
npm run db:migrate
npm run dev
```

The inbox uses MySQL (`messages`, `notifications`) and Socket.IO on the same
HTTP server/port as Express. An adoption request is also a conversation:
only its applicant and current administrators may read or reply. Existing
requests automatically appear as conversations; no backfill is needed.
Conversations remain available after an approval or decline.

All inbox HTTP endpoints require the existing Bearer JWT:

| Method | Endpoint | Behavior |
| --- | --- | --- |
| GET | /inbox/conversations?limit=20&offset=0 | Own requests, or all requests for admins, with last-message previews |
| GET | /inbox/conversations/:requestId | Authorized conversation details |
| GET | /inbox/conversations/:requestId/messages?limit=50&beforeId=123 | Most recent messages, returned oldest first; cursor for older history |
| POST | /inbox/conversations/:requestId/messages | Send JSON `{body, clientMessageId}`; text 1–2000 characters, client ID a UUID |
| GET | /inbox/notifications?limit=20&offset=0 | Own notification page, total and unread count |
| PATCH | /inbox/notifications/:id/read | Mark one own notification read; JSON `{}` |
| POST | /inbox/notifications/read-all | Mark all own notifications read; JSON `{}` |

Sending retries reuse the same clientMessageId and body. They return the
existing message instead of inserting a duplicate. New sends return 201,
retries 200. A different body with that ID returns 409. The local server
allows 60 send attempts per account per minute, returning 429 / Retry-After
above that limit. This limiter is currently held in process memory.

New requests notify current admins; approval/decline notifies the applicant.
Approval also notifies applicants whose competing requests were declined.
Messages notify the other participants. Writes and notifications share one
transaction, so rollback cannot leave a misleading notification. Old actions
are not retroactively notified. Admin-only notifications are hidden if the
recipient loses their admin role.

Connect Socket.IO with `auth: {token: accessToken}`. The server verifies the
JWT and current account, assigns its own per-user room, and disconnects at
token expiry. Clients cannot choose another user's room. The only business
event, `inbox:changed`, carries no private content: clients read the authorized
HTTP APIs to refresh. Message text is stored and rendered as plain text.

Events are published after commit. MySQL is the durable source of truth;
there is no durable socket-event queue. The frontend reloads on reconnect,
window focus and every 30 seconds while visible, recovering missed updates
after a restart. Socket transport is an immediate refresh signal, not the
message database.

`npm test` includes real HTTP/MySQL/Socket.IO tests for participant access,
role changes, notification ownership, retries, pagination, socket expiry,
recipient isolation and transaction rollback. Tests delete only their fixtures.

Render deployment is a later step. This local implementation runs one API
instance; multiple instances need a shared Socket.IO adapter and shared rate
limits. The MySQL Docker volume is local and must be replaced with a persistent
deployment database before release. No Render deployment is configured here.
