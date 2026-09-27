# Deploy the demo: Render Free + Aiven MySQL Free

Frontend: https://woof-paws.vercel.app. The backend is a single Node.js 24
web service on Render. MySQL lives separately on Aiven; do not run MySQL
inside the API service. These instructions create an independent online
database. Local users, passwords, applications, and chat history are not copied.

## 1. Create MySQL on Aiven

In the [Aiven Console](https://console.aiven.io/), create a MySQL service on the
**Free** tier and wait for **Running**. Free services choose their region
automatically. For a database in Amsterdam (ams), use Frankfurt for the API.

Record the host, port, database (usually `defaultdb`), username, and password
from **Overview / Connection information**. Download the **CA certificate**
as `ca.pem`. The service URI contains the password; do not paste it into chat,
logs, commits, or frontend variables. Rotate any password already shared.

You can inspect this database in MySQL Workbench using those connection
details. In SSL settings select **Require and Verify Identity** and supply
the downloaded CA file. Keep this connection separate from local MySQL.

Sources: [Aiven setup](https://aiven.io/docs/products/mysql/get-started),
[Workbench](https://aiven.io/docs/products/mysql/howto/connect-from-mysql-workbench),
[Aiven free limits](https://aiven.io/docs/products/mysql/concepts/mysql-free-tier).

## 2. Push the backend deployment changes

Commit the code, lockfile, configuration examples, tests, and this guide on
the branch you intend to deploy. Real `.env` files and certificates must stay
ignored. The instructions below use `main`.

## 3. Create the Render Web Service

In the [Render Dashboard](https://dashboard.render.com/), choose
**New > Web Service**, connect GitHub, and select **Raulanthropos/Capstone-BE**.

| Setting | Value |
| --- | --- |
| Name | `woof-paws-api` (or an available alternative) |
| Branch | `main`, containing the deployment commit |
| Region | Frankfurt |
| Language / Runtime | Node |
| Root Directory | Leave empty |
| Instance Type | Free |
| Build Command | `npm ci --omit=dev` |
| Start Command | `npm run start:render` |
| Health Check Path | `/health` |

The repository pins the Node 24 major version. Remove any conflicting old
`NODE_VERSION` setting, or set it to `24`.

In **Environment**, add:

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `API_HOST` | `0.0.0.0` |
| `TRUST_PROXY` | `1` |
| `CORS_ORIGINS` | `https://woof-paws.vercel.app` |
| `JWT_SECRET` | A new random secret, at least 32 bytes |
| `DB_HOST` | Aiven host, without scheme or port |
| `DB_PORT` | Aiven port |
| `DB_NAME` | `defaultdb`, unless you chose another database |
| `DB_USER` | Aiven database user, initially `avnadmin` |
| `DB_PASSWORD` | That user's current database password |
| `DB_SSL` | `true` |
| `DB_SSL_CA_PATH` | `/etc/secrets/ca.pem` |

Generate a **new** JWT secret locally with
`node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`,
then paste it only into Render. Keep it stable between deploys.

Under **Secret Files**, add a file named `ca.pem` containing the entire
downloaded certificate, including the BEGIN/END CERTIFICATE lines.
Leave `PORT` unset: Render supplies it. Leave `MONGO_URL` unset: this
deployment uses the migrated MySQL routes.

Create the service after all variables and the certificate are configured.
The start command applies tracked migrations, then starts Express and
Socket.IO on the same port. Migrations use a MySQL advisory lock and reuse
Drizzle's existing migration history. A migration failure stops startup.
Migrations never seed data or provision administrators automatically.

Free Render services do not provide a pre-deploy command or interactive
shell. This is why migrations run at startup and one-time data setup below
runs from your computer. Keep later migrations compatible with the previous
API version during a rollout. MySQL DDL does not roll back as a whole; inspect
a failed migration before retrying it, and back up data before schema changes.

Sources: [Render Node deployment](https://render.com/docs/deploy-node-express-app),
[Node versions](https://render.com/docs/node-version),
[deploy commands](https://render.com/docs/deploys),
[secret files](https://render.com/docs/configure-environment-variables#secret-files).

## 4. Verify the API

Open `https://YOUR-SERVICE.onrender.com/health`.
A successful response is `{"status":"ok"}`; database failures return 503
without exposing connection details. The first request after inactivity can
take about a minute on the Free plan.

Open `/dogs` next. An empty array before seeding is expected.
Render's automatic `RENDER_EXTERNAL_URL` is used for dog-photo URLs.
If you later use a custom API domain, set `PUBLIC_API_URL` to its HTTPS origin.

If startup fails, inspect Render Logs for the first error. Common checks:
current DB password, exact host/port, CA file contents/path, and database name.
Aiven IP restrictions, if configured, must include the Render service's
outbound addresses and your address for local administration.

## 5. Seed the online demo, once

Create an ignored `.env.production.local` from `.env.production.example`.
Fill in the hosted DB credentials. Set `DB_SSL_CA_PATH` to your local copy of
the downloaded CA, for example `C:/Users/YOU/Downloads/ca.pem`.
Do not overwrite your existing local `.env`.

From Capstone-BE, run:

```sh
node --env-file=.env.production.local scripts/check-db.js
node --env-file=.env.production.local scripts/seed-dogs.js --allow-production
```

Check the displayed database name before seeding. This adds only Luna, Milo,
Rocky and their committed photos. Reruns preserve existing demo records and
do not reset adoptions, messages, users, or edits. The production flag is
explicit because these are fictional demo listings. Do not run the test
suite against the hosted database.

## 6. Connect Vercel and create the online admin

In Vercel, open Capstone-FE's **Settings > Environment Variables**.
Set `REACT_APP_API_URL=https://YOUR-SERVICE.onrender.com` for Production,
then create a new frontend deployment: CRA embeds this value at build time.

Check registration and login at https://woof-paws.vercel.app. Register the
account you want to use as administrator. In the **Aiven** Workbench connection,
select the correct database and inspect that account:

```sql
SELECT id, email, role FROM users WHERE email = 'your-normalized-email';
UPDATE users SET role = 'admin' WHERE email = 'your-normalized-email';
```

Reload the profile (or log out/in). Use a second regular account in a private
browser window to send an adoption request; review it and exchange messages
as admin. Confirm notifications arrive without refreshing. Also check that
dog photos use HTTPS and that reloading a frontend route works.

The same exact `CORS_ORIGINS` list governs REST and Socket.IO. Add additional
trusted frontend origins as a comma-separated list when needed. Origins have
no trailing slash; do not use a wildcard for Vercel preview domains.

## Operational scope

This is a single-instance demo deployment. Failed logins are limited to 20
per 15 minutes per IP, and registrations to 10 attempts per hour per IP.
The limiters use memory and reset on restart; use shared storage before
running multiple instances. Socket.IO also needs a shared adapter if scaled.
`TRUST_PROXY=1` assumes one trusted edge hop; verify the proxy topology when
moving to another host. It must not be set to `true`.

Render Free sleeps after 15 minutes without inbound activity and has usage
limits. Aiven Free also has storage/connection limits and can be powered off
after inactivity. Review these limits before inviting real shelter users.
Uploaded files are not persisted by this deployment; current demo photos
are committed repository assets.

[Render Free limitations](https://render.com/docs/free),
[Aiven Free limitations](https://aiven.io/docs/products/mysql/concepts/mysql-free-tier).
