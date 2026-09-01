'use strict'

// Boots the REST layer against a real Postgres, with the database rebuilt from
// the migrations on every run.
//
// What is real here: the Server constructor and its middleware stack, the
// umzug migrations, the Schemas class, and the route handlers themselves. What
// is not: app.listen and the cron jobs, which the harness owns instead so that
// tests can pick an ephemeral port and actually shut down afterwards, and
// passport, which is replaced by a stub that injects a chosen user. That stub
// is the only thing standing between a test and a route, so a route's own
// authorization checks - which is what most of these tests are about - all
// still run for real.

const path = require('node:path')
const os = require('node:os')
const fs = require('fs-extra')

const database = require('../../src/back/db/db.js')
const Schemas = require('../../src/back/db/schemas.js')
const serverModule = require('../../src/back/server.js')

// The socket form: the local cluster is peer-authenticated, and this is also
// the only branch of db.js that works without putting a password in the repo.
const PG = {
  useSocket: true,
  host: process.env.APPDISTRIB_TEST_PGHOST || '/var/run/postgresql',
  user: process.env.APPDISTRIB_TEST_PGUSER || process.env.USER,
  password: process.env.APPDISTRIB_TEST_PGPASSWORD || null,
  database: process.env.APPDISTRIB_TEST_PGDATABASE || 'appdistrib_test',
  port: 5432
}

// Prerequisite: a reachable Postgres and a database to scribble on. Defaults to
// a local peer-authenticated cluster and a database named appdistrib_test:
//   createdb appdistrib_test
// Override with APPDISTRIB_TEST_PG{HOST,USER,PASSWORD,DATABASE}. Every run drops
// every table in it, so do not point this at anything you care about.

async function start () {
  const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'appdistrib-test-'))

  const config = {
    secretKey: 'test-secret-key',
    providers: {},
    storage: { secretKey: 'test-storage-key', path: storagePath },
    webServer: { baseURL: 'http://127.0.0.1', port: 0, secret: 'test' },
    pgConfig: PG
  }

  const server = new serverModule.Server(config)

  const db = database.create(config.pgConfig)
  await db.connect()
  // db.js builds the Sequelize instance inside connect() and takes no logging
  // option, so silence it here rather than have every run print its whole SQL
  // transcript. Has to be after connect(), which is where the instance appears.
  db.sequelize.options.logging = false
  // Every run starts from an empty schema so tests cannot leak into each other
  // and so the migrations are exercised rather than assumed.
  await db.sequelize.getQueryInterface().dropAllTables()
  await db.initialize()
  server.schemas = new Schemas(db, server)

  // Stand in for passport. `currentUser` is what the tests move around.
  const state = { currentUser: null }
  server.authenticationFilter = () => (req, res, next) => {
    if (!state.currentUser) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }
    req.user = state.currentUser
    next()
  }

  await require('../../src/back/web/rest/index.js').setRoutes(server)

  const listener = await new Promise((resolve) => {
    const l = server.app.listen(0, '127.0.0.1', () => resolve(l))
  })
  const base = `http://127.0.0.1:${listener.address().port}`

  async function api (method, urlPath, body) {
    const res = await fetch(base + urlPath, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    })
    const text = await res.text()
    let json
    try {
      json = JSON.parse(text)
    } catch {
      json = text
    }
    return { status: res.status, body: json }
  }

  return {
    server,
    schemas: server.schemas,
    config,
    storagePath,
    get: (p) => api('GET', p),
    post: (p, body) => api('POST', p, body),
    becomeUser (user) {
      state.currentUser = user
      return user
    },
    becomeNobody () {
      state.currentUser = null
    },
    // Creates an enabled user, an organization they own, and a project in it.
    // Users arrive through findOrCreateUser because that is the only creation
    // path in Schemas, and `enabled` has to be set by hand because nothing in
    // the application ever sets it either.
    async makeOrgWithProject ({ userName, orgId, projectId }) {
      const user = await server.schemas.findOrCreateUser({
        provider: 'test',
        id: userName,
        screenName: userName,
        avatarURL: null
      })
      await user.update({ enabled: true })
      // createOrganization does not return the organization it created, so
      // read it back rather than passing its return value along - doing that
      // yields a project id of `undefined:<projectId>`.
      await server.schemas.createOrganization({
        id: orgId,
        name: orgId,
        owner: user
      })
      const org = await server.schemas.findOrganization(orgId)
      const project = await server.schemas.createProject({
        id: projectId,
        name: projectId,
        organization: org
      })
      return { user, org, project }
    },
    async stop () {
      await new Promise((resolve) => listener.close(resolve))
      await db.sequelize.close()
      await fs.remove(storagePath)
    }
  }
}

module.exports = { start }
