'use strict'

// The migrations, run two ways: from an empty database, which is what every
// other test file gets, and as an upgrade of a database that has been sitting
// on 00_initial.js with data in it, which is what an existing install gets.

const test = require('node:test')
const assert = require('node:assert')
const path = require('node:path')
const { Sequelize } = require('sequelize')
const { Umzug, SequelizeStorage } = require('umzug')

const harness = require('./helpers/harness.js')
const { INDEXES, indexName } = require('../src/back/db/migrations/01_constraints_and_indexes.js')

const NOT_NULL = [
  ['providedAuths', 'userId'],
  ['projects', 'organizationId'],
  ['builds', 'projectId'],
  ['builds', 'assetId']
]

async function connect (t) {
  const PG = harness.PG
  const sequelize = new Sequelize(PG.database, PG.user, PG.password, {
    host: PG.host,
    dialect: 'postgres',
    logging: false
  })
  t.after(() => sequelize.close())
  await sequelize.getQueryInterface().dropAllTables()
  const umzug = new Umzug({
    migrations: {
      glob: path
        .join(__dirname, '..', 'src', 'back', 'db', 'migrations', '*.js')
        .split(path.sep)
        .join('/')
    },
    context: sequelize,
    storage: new SequelizeStorage({ sequelize }),
    logger: undefined
  })
  return { sequelize, umzug }
}

async function rows (sequelize, sql) {
  const [result] = await sequelize.query(sql)
  return result
}

async function nullable (sequelize, table, column) {
  const [r] = await rows(
    sequelize,
    `SELECT is_nullable FROM information_schema.columns
      WHERE table_name = '${table}' AND column_name = '${column}'`
  )
  return r.is_nullable === 'YES'
}

async function width (sequelize, table, column) {
  const [r] = await rows(
    sequelize,
    `SELECT character_maximum_length AS w FROM information_schema.columns
      WHERE table_name = '${table}' AND column_name = '${column}'`
  )
  return r.w
}

async function indexNames (sequelize) {
  return (await rows(sequelize, "SELECT indexname FROM pg_indexes WHERE schemaname = 'public'"))
    .map((r) => r.indexname)
}

async function applied (umzug) {
  return (await umzug.executed()).map((m) => m.name)
}

async function assertMigrated (sequelize) {
  for (const [table, column] of NOT_NULL) {
    assert.strictEqual(await nullable(sequelize, table, column), false, `${table}.${column}`)
  }
  assert.strictEqual(await width(sequelize, 'users', 'avatarURL'), 2048)
  assert.strictEqual(await width(sequelize, 'providedAuths', 'avatarURL'), 2048)
  const names = await indexNames(sequelize)
  for (const [table, fields] of INDEXES) {
    assert.ok(names.includes(indexName(table, fields)), indexName(table, fields))
  }
}

// One organization, two projects, `count` builds split between them, each on
// its own asset, written straight into the 00_initial.js tables.
async function seed (sequelize, count) {
  await sequelize.query(`
    INSERT INTO organizations (id, name, "createdAt", "updatedAt")
      VALUES ('org', 'org', now(), now());
    INSERT INTO projects (id, key, name, "organizationId", "createdAt", "updatedAt")
      VALUES ('org:a', 'ka', 'a', 'org', now(), now()),
             ('org:b', 'kb', 'b', 'org', now(), now());
    INSERT INTO assets (id, filename, size, "createdAt", "updatedAt")
      SELECT md5(n::text) || md5((n + 1)::text), 'f' || n || '.zip', n, now(), now()
        FROM generate_series(1, ${count}) AS n;
    INSERT INTO builds (id, "buildId", keep, "projectId", "assetId", "createdAt", "updatedAt")
      SELECT CASE WHEN n % 2 = 0 THEN 'org:a:' ELSE 'org:b:' END || n, n, false,
             CASE WHEN n % 2 = 0 THEN 'org:a' ELSE 'org:b' END,
             md5(n::text) || md5((n + 1)::text), now(), now()
        FROM generate_series(1, ${count}) AS n;
  `)
}

test('a fresh database ends up with the constraints and indexes', async (t) => {
  const { sequelize, umzug } = await connect(t)
  await umzug.up()
  assert.deepStrictEqual(await applied(umzug), ['00_initial.js', '01_constraints_and_indexes.js', '02_project_build_counter.js'])
  await assertMigrated(sequelize)
})

test('upgrading a populated 00_initial.js database keeps every row', async (t) => {
  const { sequelize, umzug } = await connect(t)
  await umzug.up({ to: '00_initial.js' })
  // The starting point is what 00_initial.js really produced.
  for (const [table, column] of NOT_NULL) {
    assert.strictEqual(await nullable(sequelize, table, column), true, `${table}.${column} before`)
  }
  assert.strictEqual(await width(sequelize, 'users', 'avatarURL'), 255)
  await seed(sequelize, 350)
  const before = await rows(sequelize, 'SELECT id, "buildId", "projectId", "assetId" FROM builds ORDER BY id')

  await umzug.up()

  assert.deepStrictEqual(await applied(umzug), ['00_initial.js', '01_constraints_and_indexes.js', '02_project_build_counter.js'])
  await assertMigrated(sequelize)
  const after = await rows(sequelize, 'SELECT id, "buildId", "projectId", "assetId" FROM builds ORDER BY id')
  assert.strictEqual(after.length, 350)
  assert.deepStrictEqual(after, before)
  // Each project's build-id counter starts one past its highest build.
  assert.deepStrictEqual(
    await rows(sequelize, 'SELECT id, "nextBuildId" FROM projects ORDER BY id'),
    [{ id: 'org:a', nextBuildId: '351' }, { id: 'org:b', nextBuildId: '350' }]
  )
  await assert.rejects(
    sequelize.query(`INSERT INTO builds (id, "buildId", keep, "projectId", "createdAt", "updatedAt")
      VALUES ('org:a:999', 999, false, 'org:a', now(), now())`),
    /null value in column "assetId"/
  )
})

test('an upgrade that meets a null foreign key fails and changes nothing', async (t) => {
  const { sequelize, umzug } = await connect(t)
  await umzug.up({ to: '00_initial.js' })
  await seed(sequelize, 10)
  await sequelize.query(`INSERT INTO builds (id, "buildId", keep, "projectId", "createdAt", "updatedAt")
    VALUES ('org:a:11', 11, false, 'org:a', now(), now())`)

  await assert.rejects(umzug.up(), /assetId/)

  assert.deepStrictEqual(await applied(umzug), ['00_initial.js'])
  assert.strictEqual(await nullable(sequelize, 'providedAuths', 'userId'), true)
  assert.strictEqual(await width(sequelize, 'users', 'avatarURL'), 255)
  const names = await indexNames(sequelize)
  for (const [table, fields] of INDEXES) {
    assert.ok(!names.includes(indexName(table, fields)), indexName(table, fields))
  }
})

test('the migration rolls back to what 00_initial.js left', async (t) => {
  const { sequelize, umzug } = await connect(t)
  await umzug.up()
  await umzug.down({ to: '01_constraints_and_indexes.js' })
  assert.deepStrictEqual(await applied(umzug), ['00_initial.js'])
  for (const [table, column] of NOT_NULL) {
    assert.strictEqual(await nullable(sequelize, table, column), true, `${table}.${column}`)
  }
  assert.strictEqual(await width(sequelize, 'users', 'avatarURL'), 255)
  await umzug.up()
  await assertMigrated(sequelize)
})
