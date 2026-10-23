'use strict'

// Deploy gate for the NewBuild upload path, run against a local, throwaway
// copy of the whole service and never against production.
//
// Unlike test/grpc.test.js, nothing here is in-process or stubbed: the server
// is `node index.js -c <config.json>` exactly as pm2 starts it, against a
// Postgres in a docker container on tmpfs, and the upload is the repository's
// CLI binary (src/client/index.js) driven the way pcsx-redux CI drives the
// published one: `buildid > buildid.json`, a version.json carrying buildId,
// then `-l buildId -m version.json upload <zip>`. The project and its tokens
// are provisioned the way they are on the box, with the server's own db.js and
// Schemas. The result is read back over HTTP from the running server.
//
// Requires docker. Run with `npm run test:e2e`. APPDISTRIB_E2E_PGIMAGE picks the
// Postgres image (default postgres:18-alpine, the major production runs).

const assert = require('node:assert')
const crypto = require('node:crypto')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const { execFile, spawn } = require('node:child_process')
const { promisify } = require('node:util')
const test = require('node:test')

const fs = require('fs-extra')
const base85 = require('base85')
const { sha3_256 } = require('@noble/hashes/sha3')

const database = require('../../src/back/db/db.js')
const Schemas = require('../../src/back/db/schemas.js')

const execFileP = promisify(execFile)

const ROOT = path.join(__dirname, '..', '..')
const CLI = path.join(ROOT, 'src', 'client', 'index.js')
// Not configurable on purpose: the server's /storage route serves
// <root>/storage whatever config.storage.path says, and so does the production
// nginx, so this is the only storage path from which an upload is retrievable
// over the web. The test refuses to run if something is already there.
const STORAGE = path.join(ROOT, 'storage')
const PG_IMAGE = process.env.APPDISTRIB_E2E_PGIMAGE || 'postgres:18-alpine'

const ORG = 'e2e-org'
const PROJECT = 'e2e-project'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function freePort () {
  return new Promise((resolve, reject) => {
    const s = net.createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => resolve(port))
    })
  })
}

async function docker (...args) {
  const { stdout } = await execFileP('docker', args, { timeout: 120_000 })
  return stdout.trim()
}

// Starts Postgres on tmpfs, published on a random loopback port. The container
// is --rm and is removed again in the suite's after hook.
async function startPostgres () {
  const name = `appdistrib-e2e-${crypto.randomBytes(4).toString('hex')}`
  const password = crypto.randomBytes(16).toString('hex')
  await docker(
    'run', '-d', '--rm', '--name', name,
    '--tmpfs', '/var/lib/postgresql:rw',
    '-e', 'POSTGRES_USER=appdistrib',
    '-e', `POSTGRES_PASSWORD=${password}`,
    '-e', 'POSTGRES_DB=appdistrib',
    '-p', '127.0.0.1::5432',
    PG_IMAGE
  )
  const mapping = await docker('port', name, '5432/tcp')
  const port = Number(mapping.split('\n')[0].split(':').pop())
  // The image's init runs a socket-only server first and then restarts, so
  // only a TCP answer means the real one is up.
  const deadline = Date.now() + 60_000
  for (;;) {
    try {
      await docker('exec', name, 'pg_isready', '-q', '-h', '127.0.0.1', '-U', 'appdistrib')
      break
    } catch (err) {
      if (Date.now() > deadline) throw new Error(`Postgres in ${name} never became ready`)
      await sleep(500)
    }
  }
  return {
    name,
    pgConfig: {
      user: 'appdistrib',
      password,
      host: '127.0.0.1',
      port,
      database: 'appdistrib'
    }
  }
}

// Runs the server the way pm2 does. Resolves once it prints "Server started",
// rejects if it exits first.
function startServer ({ configPath, tmpDir, logPath }) {
  const log = fs.createWriteStream(logPath)
  const child = spawn(process.execPath, ['index.js', '-c', configPath], {
    cwd: ROOT,
    env: { ...process.env, TMPDIR: tmpDir },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  child.stdout.pipe(log)
  child.stderr.pipe(log)
  const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)))
  const started = new Promise((resolve, reject) => {
    let out = ''
    child.stdout.on('data', (d) => {
      out += d
      if (out.includes('Server started')) resolve()
    })
    exited.then((code) => reject(new Error(`server exited with ${code} before starting; see ${logPath}`)))
    setTimeout(() => reject(new Error(`server did not start in 60 s; see ${logPath}`)), 60_000).unref()
  })
  return { child, started, exited }
}

// The CLI binary, through the same options CI uses, with an explicit local
// endpoint. Never inherits APPDISTRIB_* from the environment running the test,
// so a real CI token cannot leak into it and it cannot reach api.distrib.app.
async function cli (grpcPort, token, args, cwd) {
  const env = { ...process.env }
  for (const k of Object.keys(env)) if (k.startsWith('APPDISTRIB_')) delete env[k]
  env.APPDISTRIB_ORGANIZATION = ORG
  env.APPDISTRIB_PROJECT = PROJECT
  if (token !== undefined) env.APPDISTRIB_TOKEN = token
  try {
    const { stdout, stderr } = await execFileP(
      process.execPath,
      [CLI, '-h', '127.0.0.1', '--port', String(grpcPort), '-i', ...args],
      { cwd, env, timeout: 60_000 }
    )
    return { code: 0, stdout, stderr }
  } catch (err) {
    if (err.killed) throw new Error(`CLI timed out: ${args.join(' ')}`)
    return { code: err.code, stdout: err.stdout, stderr: err.stderr }
  }
}

function sha3hex (buf) {
  return Buffer.from(sha3_256(buf)).toString('hex')
}

test.describe('NewBuild end to end against a local server', { timeout: 300_000 }, () => {
  const ctx = {}

  test.before(async () => {
    if (await fs.pathExists(STORAGE)) {
      throw new Error(`${STORAGE} already exists; refusing to run over it`)
    }
    ctx.work = await fs.mkdtemp(path.join(os.tmpdir(), 'appdistrib-e2e-'))
    ctx.uploadTmp = path.join(ctx.work, 'tmp')
    await fs.ensureDir(ctx.uploadTmp)
    ctx.pg = await startPostgres()
    ctx.webPort = await freePort()
    ctx.grpcPort = await freePort()
    // Same shape as config.json-example, plus grpcConfig so the ports are
    // ours. storage.path is left unset on purpose, as above.
    ctx.config = {
      secretKey: crypto.randomBytes(16).toString('hex'),
      providers: {},
      pgConfig: ctx.pg.pgConfig,
      storage: {
        secretKey: crypto.randomBytes(16).toString('hex'),
        maxUploadSize: 1073741824
      },
      webServer: {
        baseURL: `http://127.0.0.1:${ctx.webPort}`,
        host: '127.0.0.1',
        port: ctx.webPort,
        secret: crypto.randomBytes(16).toString('hex')
      },
      grpcConfig: { host: '127.0.0.1', port: ctx.grpcPort }
    }
    ctx.configPath = path.join(ctx.work, 'config.json')
    await fs.writeJson(ctx.configPath, ctx.config)
    ctx.serverLog = path.join(ctx.work, 'server.log')
    ctx.server = startServer({
      configPath: ctx.configPath,
      tmpDir: ctx.uploadTmp,
      logPath: ctx.serverLog
    })
    await ctx.server.started
    ctx.base = `http://127.0.0.1:${ctx.webPort}`

    // Provisioning, the way it is done on the box: the server's own db.js and
    // Schemas against the same database, after the server has migrated it.
    ctx.db = database.create(ctx.config.pgConfig)
    await ctx.db.connect()
    ctx.db.sequelize.options.logging = false
    ctx.schemas = new Schemas(ctx.db, {})
    const user = await ctx.schemas.findOrCreateUser({
      provider: 'e2e', id: 'uploader', screenName: 'uploader', avatarURL: null
    })
    await user.update({ enabled: true })
    await ctx.schemas.createOrganization({ id: ORG, name: ORG, owner: user })
    const org = await ctx.schemas.findOrganization(ORG)
    ctx.project = await ctx.schemas.createProject({ id: PROJECT, name: PROJECT, organization: org })
    const mk = (description, expiration) => ctx.schemas.createToken({
      secretKey: ctx.config.secretKey, project: ctx.project, description, expiration
    })
    ctx.tokens = {
      // What every production token looks like: no expiration at all.
      noExpiry: await mk('ci, no expiration'),
      future: await mk('ci, expires tomorrow', new Date(Date.now() + 86_400_000)),
      expired: await mk('ci, expired an hour ago', new Date(Date.now() - 3_600_000)),
      // Well formed, decodable, and not in the table.
      wrong: 'tk1.' + base85.encode(crypto.randomBytes(32)).replace(/\./g, '_')
    }
  })

  test.after(async () => {
    if (ctx.db) await ctx.db.sequelize.close().catch(() => {})
    if (ctx.server) {
      ctx.server.child.kill('SIGTERM')
      await Promise.race([ctx.server.exited, sleep(5000)])
      ctx.server.child.kill('SIGKILL')
    }
    if (ctx.pg) await docker('rm', '-f', ctx.pg.name).catch(() => {})
    await fs.remove(STORAGE)
    if (ctx.work) {
      if (process.env.APPDISTRIB_E2E_KEEP) console.log(`kept ${ctx.work}`)
      else await fs.remove(ctx.work)
    }
  })

  async function buildCount () {
    return ctx.db.sequelize.models.build.count({ where: { projectId: ctx.project.id } })
  }

  async function latest () {
    const res = await fetch(`${ctx.base}/pub/org/${ORG}/project/${PROJECT}/latest`, { redirect: 'manual' })
    return { status: res.status, location: res.headers.get('location') }
  }

  // The CI sequence: buildid, version.json, upload with -l buildId -m.
  async function ciUpload (token, filename, content) {
    const dir = await fs.mkdtemp(path.join(ctx.work, 'job-'))
    const bid = await cli(ctx.grpcPort, token, ['buildid'], dir)
    assert.strictEqual(bid.code, 0, `buildid failed: ${bid.stderr}`)
    // `buildid` prints the int64 as a JSON string; CI splices it into
    // version.json unquoted with `jq -r`, so the manifest carries a number.
    const buildid = Number(JSON.parse(bid.stdout).buildid)
    assert.ok(Number.isInteger(buildid) && buildid > 0, `bad build id: ${bid.stdout}`)
    await fs.writeJson(path.join(dir, 'version.json'), { version: 'e2e', buildId: buildid })
    await fs.writeFile(path.join(dir, filename), content)
    const up = await cli(ctx.grpcPort, token, ['-l', 'buildId', '-m', 'version.json', 'upload', filename], dir)
    return { buildid, ...up }
  }

  async function assertPublished ({ buildid, stdout }, filename, content) {
    const m = /Hash: ([0-9a-f]+)\nKey: (\S+)\nServer is publishing build (\d+)\./.exec(stdout)
    assert.ok(m, `CLI did not report a published build:\n${stdout}`)
    assert.strictEqual(m[1], sha3hex(content))
    assert.strictEqual(Number(m[3]), buildid)
    const keyHex = Buffer.from(base85.decode(m[2])).toString('hex')

    // The build row and its asset.
    const build = await ctx.schemas.getBuild({ project: ctx.project, id: buildid })
    assert.ok(build, `no build row for ${buildid}`)
    assert.strictEqual(build.assetId, keyHex)
    const asset = await ctx.db.sequelize.models.asset.findByPk(keyHex)
    assert.ok(asset, 'no asset row')
    assert.strictEqual(asset.filename, filename)
    assert.strictEqual(Number(asset.size), content.length)

    // The stored artifact, at its content-addressed path.
    const rel = path.join('assets', keyHex.slice(0, 3), keyHex.slice(3, 6), keyHex.slice(6, 9), keyHex.slice(9))
    assert.deepStrictEqual(await fs.readFile(path.join(STORAGE, rel + '.data')), content)

    // Retrievable over the web: /latest and /alias both 302 to it, and the
    // bytes behind that URL are the bytes uploaded.
    const wantLocation = `/storage/${rel}/${filename}`
    const l = await latest()
    assert.strictEqual(l.status, 302)
    assert.strictEqual(l.location, wantLocation)
    const alias = await fetch(`${ctx.base}/alias/${ORG}/${PROJECT}/${filename}`, { redirect: 'manual' })
    assert.strictEqual(alias.status, 302)
    assert.strictEqual(alias.headers.get('location'), wantLocation)
    const blob = await fetch(ctx.base + wantLocation)
    assert.strictEqual(blob.status, 200)
    assert.deepStrictEqual(Buffer.from(await blob.arrayBuffer()), content)

    // The manifests the in-app updater reads.
    const mf = await fetch(`${ctx.base}/storage/manifests/${ORG}/${PROJECT}/manifest.json`)
    assert.strictEqual(mf.status, 200)
    assert.ok((await mf.json()).builds.some((b) => Number(b.id) === buildid), 'build missing from manifest.json')
    const bm = await fetch(`${ctx.base}/storage/manifests/${ORG}/${PROJECT}/manifest-${buildid}.json`)
    assert.strictEqual(bm.status, 200)
  }

  async function assertRefused (token) {
    const before = await buildCount()
    const latestBefore = await latest()
    const dir = await fs.mkdtemp(path.join(ctx.work, 'job-'))
    const content = crypto.randomBytes(4096)
    await fs.writeFile(path.join(dir, 'refused.zip'), content)
    const up = await cli(ctx.grpcPort, token, ['upload', 'refused.zip'], dir)
    assert.notStrictEqual(up.code, 0, 'upload with a bad token exited 0')
    assert.match(up.stderr, /16 UNAUTHENTICATED: Invalid token/)
    assert.doesNotMatch(up.stdout, /Server is publishing build/)
    assert.strictEqual(await buildCount(), before, 'a refused upload created a build row')
    assert.deepStrictEqual(await latest(), latestBefore)
    assert.strictEqual(await ctx.db.sequelize.models.asset.count({ where: { filename: 'refused.zip' } }), 0)
  }

  test('a CI-shaped upload with a token that has no expiration is stored and served', async () => {
    const content = crypto.randomBytes(3 * 1024 * 1024 + 17)
    const filename = 'PCSX-Redux-e2e00001-linux-x86_64.zip'
    const r = await ciUpload(ctx.tokens.noExpiry, filename, content)
    assert.strictEqual(r.code, 0, `upload failed (${r.code}):\n${r.stderr}`)
    await assertPublished(r, filename, content)
  })

  test('a token whose expiration is in the future still uploads', async () => {
    const content = crypto.randomBytes(200_000)
    const filename = 'PCSX-Redux-e2e00002-linux-x86_64.zip'
    const r = await ciUpload(ctx.tokens.future, filename, content)
    assert.strictEqual(r.code, 0, `upload failed (${r.code}):\n${r.stderr}`)
    await assertPublished(r, filename, content)
  })

  test('an expired token is refused and nothing is stored', async () => {
    await assertRefused(ctx.tokens.expired)
  })

  test('a wrong token is refused and nothing is stored', async () => {
    await assertRefused(ctx.tokens.wrong)
  })

  test('an unparseable config.json stops the boot with exit code 1', async () => {
    const bad = path.join(ctx.work, 'bad-config.json')
    await fs.writeFile(bad, '{ "secretKey": ')
    const s = startServer({ configPath: bad, tmpDir: ctx.uploadTmp, logPath: path.join(ctx.work, 'bad.log') })
    s.started.catch(() => {})
    const code = await Promise.race([s.exited, sleep(30_000).then(() => 'timeout')])
    if (code === 'timeout') s.child.kill('SIGKILL')
    assert.strictEqual(code, 1)
  })
})
