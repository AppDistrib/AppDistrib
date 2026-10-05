'use strict'

// End-to-end tests for the gRPC upload path, which is what the CLI drives from
// CI. Real gRPC server, real client, real database and a real storage
// directory: an upload here goes through NewBuild, moveAsset, createBuild, both
// manifest generators and the changelog writer.

const fs = require('fs-extra')
const os = require('node:os')
const path = require('node:path')

// The temp module picks its directory once, when it is first required, so this
// has to happen before anything pulls it in. Every test file runs in its own
// process, so this does not leak into the others.
const uploadTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'appdistrib-uploads-'))
process.env.TMPDIR = uploadTmp

const test = require('node:test')
const assert = require('node:assert')
const base85 = require('base85')
const grpc = require('@grpc/grpc-js')
const { sha3_256 } = require('@noble/hashes/sha3')
const { hmac } = require('@noble/hashes/hmac')

const harness = require('./helpers/harness.js')

const ORG = 'grpc-org'
const PROJECT = 'grpc-project'

async function setup (t, { configure } = {}) {
  const h = await harness.start()
  t.after(() => h.stop())
  if (configure) configure(h.config)
  const { project } = await h.makeOrgWithProject({
    userName: 'uploader',
    orgId: ORG,
    projectId: PROJECT
  })
  const token = await h.schemas.createToken({
    secretKey: h.config.secretKey,
    project,
    description: 'ci'
  })
  const g = await h.startGrpc()
  const meta = { token, organization: ORG, project: PROJECT }
  return { h, g, project, meta }
}

// Opens a NewBuild call and queues everything that comes back on it, so a test
// can write messages and then read responses one at a time. `next` resolves
// with { data }, { error } or { timeout }; `status` resolves once the call is
// over, whichever way it ended.
function openUpload (g, meta) {
  const call = g.client.NewBuild(g.metadata(meta))
  const events = []
  const waiters = []
  const wake = () => {
    while (waiters.length && events.length) waiters.shift()(events.shift())
  }
  call.on('data', (data) => {
    events.push({ data })
    wake()
  })
  call.on('error', (error) => {
    events.push({ error })
    wake()
  })
  const status = new Promise((resolve) => call.on('status', resolve))
  return {
    call,
    status,
    write: (message) => call.write(message),
    end: () => call.end(),
    next (timeoutMs = 2000) {
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          const i = waiters.indexOf(waiter)
          if (i >= 0) waiters.splice(i, 1)
          resolve({ timeout: true })
        }, timeoutMs)
        const waiter = (event) => {
          clearTimeout(timer)
          resolve(event)
        }
        waiters.push(waiter)
        wake()
      })
    }
  }
}

function describeEvent (event) {
  if (event.timeout) return 'nothing (timeout)'
  if (event.error) return `error ${event.error.code}: ${event.error.details}`
  return `response ${event.data.response}`
}

function expectResponse (event, kind) {
  assert.ok(
    event.data && event.data.response === kind,
    `expected a ${kind} response, got ${describeEvent(event)}`
  )
  return event.data[kind]
}

function expectError (event, code) {
  assert.ok(event.error, `expected an error, got ${describeEvent(event)}`)
  assert.strictEqual(event.error.code, code, `wrong status: ${event.error.details}`)
}

// Uploads `data` the way appdistrib-cli does: header, wait for the build id,
// then one chunk per ack, then the footer carrying the sha3 of the content.
async function cliUpload (g, meta, { header, data, chunkSize = 4, hash }) {
  const up = openUpload(g, meta)
  up.write({ header: { fileSize: data.length, manifest: 'null', ...header } })
  const buildId = expectResponse(await up.next(), 'buildId').buildId.id
  for (let offset = 0; offset < data.length; offset += chunkSize) {
    up.write({ chunk: { data: data.subarray(offset, offset + chunkSize) } })
    expectResponse(await up.next(), 'chunkAck')
  }
  up.write({ footer: { hash: hash ?? Buffer.from(sha3_256(data)) } })
  up.end()
  const event = await up.next()
  return { up, buildId, event, status: await up.status }
}

// Upload staging files are the only plain files temp creates here; the
// harness's storage directories sit beside them and are skipped.
function tempFiles () {
  return fs
    .readdirSync(uploadTmp, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
}

// Server-side cleanup and storage work continue after the client has its
// status, so anything asserting on what the server did afterwards polls for a
// bounded time rather than reading once.
async function eventually (predicate, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return true
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  return predicate()
}

// For the opposite question - did the server do something it should not have -
// there is no event to wait on, so give it a fixed window to misbehave in.
const settle = () => new Promise((resolve) => setTimeout(resolve, 750))

function assetPaths (storagePath, keyBuffer, filename) {
  const hex = keyBuffer.toString('hex')
  const dir = path.join(
    storagePath,
    'assets',
    hex.slice(0, 3),
    hex.slice(3, 6),
    hex.slice(6, 9)
  )
  return {
    blob: path.join(dir, hex.slice(9) + '.data'),
    link: path.join(dir, hex.slice(9), filename),
    publicPath: '/' + path.posix.join('storage', 'assets', hex.slice(0, 3), hex.slice(3, 6), hex.slice(6, 9), hex.slice(9), filename)
  }
}

test('an upload lands in storage, the database and every manifest', async (t) => {
  const { h, g, project, meta } = await setup(t)

  const data = Buffer.from('a build artifact, eleven chunks of four bytes')
  const changelog = '# Changes\n\n- something\n'
  const result = await cliUpload(g, meta, {
    header: {
      filename: 'artifact-linux.zip',
      manifest: JSON.stringify({ version: '1.2.3' }),
      changelog
    },
    data
  })
  assert.strictEqual(result.buildId, '1')
  assert.strictEqual(result.status.code, grpc.status.OK, result.status.details)

  const key = Buffer.from(hmac(sha3_256, 'test-storage-key', data))
  assert.strictEqual(expectResponse(result.event, 'key').key, base85.encode(key))

  const files = assetPaths(h.storagePath, key, 'artifact-linux.zip')
  assert.deepStrictEqual(await fs.readFile(files.blob), data, 'blob holds the upload')
  const [blobStat, linkStat] = await Promise.all([fs.stat(files.blob), fs.stat(files.link)])
  assert.strictEqual(blobStat.ino, linkStat.ino, 'named file is a hardlink to the blob')

  const build = await h.schemas.getBuild({ project, id: 1 })
  assert.ok(build, 'build row exists')
  assert.strictEqual(build.asset.id, key.toString('hex'))
  assert.strictEqual(build.asset.filename, 'artifact-linux.zip')
  assert.strictEqual(Number(build.asset.size), data.length)
  assert.strictEqual(build.keep, false)

  const manifestDir = path.join(h.storagePath, 'manifests', ORG, PROJECT)
  const buildManifest = await fs.readJson(path.join(manifestDir, 'manifest-1.json'))
  assert.strictEqual(buildManifest.id, 1)
  assert.strictEqual(buildManifest.path, files.publicPath)
  // A string, because the column is a BIGINT. Production manifests carry it
  // the same way and the in-app updater reads them, so this pins it.
  assert.strictEqual(buildManifest.size, String(data.length))
  assert.deepStrictEqual(buildManifest.manifest, { version: '1.2.3' })
  assert.strictEqual(buildManifest.hashes.sha3, Buffer.from(sha3_256(data)).toString('hex'))
  const projectManifest = await fs.readJson(path.join(manifestDir, 'manifest.json'))
  assert.deepStrictEqual(projectManifest.builds.map((b) => b.id), [1])
  assert.strictEqual(projectManifest.project.name, PROJECT)
  assert.strictEqual(
    await fs.readFile(path.join(h.storagePath, 'changelogs', ORG, PROJECT, 'changelog-1.md'), 'utf-8'),
    changelog
  )

  // Same bytes under another name: a new build, the same blob, a second link.
  const again = await cliUpload(g, meta, { header: { filename: 'renamed.zip' }, data })
  assert.strictEqual(again.buildId, '2')
  assert.strictEqual(again.status.code, grpc.status.OK, again.status.details)
  const second = assetPaths(h.storagePath, key, 'renamed.zip')
  assert.strictEqual((await fs.stat(second.link)).ino, blobStat.ino, 'deduplicated onto the same blob')
  const updated = await fs.readJson(path.join(manifestDir, 'manifest.json'))
  assert.deepStrictEqual(updated.builds.map((b) => b.id), [2, 1])

  const next = await new Promise((resolve, reject) =>
    g.client.GetNextBuildId({}, g.metadata(meta), (err, res) => (err ? reject(err) : resolve(res)))
  )
  assert.strictEqual(next.id, '3')
  assert.ok(await eventually(() => tempFiles().length === 0), 'no temp file left behind')
})

test('an upload without a valid token is refused before anything is staged', async (t) => {
  const { g } = await setup(t)
  const up = openUpload(g, { token: 'tk1.nonsense', organization: ORG, project: PROJECT })
  expectError(await up.next(), grpc.status.UNAUTHENTICATED)
  assert.deepStrictEqual(tempFiles(), [])
})

test('a chunk that runs past the declared file size is refused', async (t) => {
  const { g, meta } = await setup(t)
  const up = openUpload(g, meta)
  up.write({ header: { filename: 'big.zip', fileSize: 4, manifest: 'null' } })
  expectResponse(await up.next(), 'buildId')
  up.write({ chunk: { data: Buffer.alloc(8) } })
  expectError(await up.next(), grpc.status.INVALID_ARGUMENT)
})

test('a declared file size over the configured limit is refused at the header', async (t) => {
  const { g, meta } = await setup(t, {
    configure: (config) => { config.storage.maxUploadSize = 16 }
  })
  const up = openUpload(g, meta)
  up.write({ header: { filename: 'big.zip', fileSize: 17, manifest: 'null' } })
  expectError(await up.next(), grpc.status.INVALID_ARGUMENT)

  // And one at the limit still goes through.
  const ok = await cliUpload(g, meta, { header: { filename: 'fits.zip' }, data: Buffer.alloc(16, 1) })
  assert.strictEqual(ok.status.code, grpc.status.OK, ok.status.details)
})

for (const filename of ['..', '.', '', 'a/b', 'a\\b', 'nul\0byte']) {
  test(`filename ${JSON.stringify(filename)} is refused at the header`, async (t) => {
    const { g, meta } = await setup(t)
    const up = openUpload(g, meta)
    up.write({ header: { filename, fileSize: 4, manifest: 'null' } })
    expectError(await up.next(), grpc.status.INVALID_ARGUMENT)
  })
}

// Storage is addressed by content across every project, and published builds
// are public. With ".." as the filename, moveAsset removes the directory that
// holds the blob, so re-uploading someone else's artifact under that name, with
// a token for your own project, deleted theirs.
test('a ".." upload cannot delete another project\'s artifact', async (t) => {
  const { h, g, meta } = await setup(t)
  const victim = await h.makeOrgWithProject({
    userName: 'victim',
    orgId: 'victim-org',
    projectId: 'victim-project'
  })
  const victimMeta = {
    token: await h.schemas.createToken({
      secretKey: h.config.secretKey,
      project: victim.project,
      description: 'ci'
    }),
    organization: 'victim-org',
    project: 'victim-project'
  }
  const data = Buffer.from('a public release artifact')
  const published = await cliUpload(g, victimMeta, { header: { filename: 'release.zip' }, data })
  assert.strictEqual(published.status.code, grpc.status.OK, published.status.details)
  const key = Buffer.from(hmac(sha3_256, 'test-storage-key', data))
  const files = assetPaths(h.storagePath, key, 'release.zip')
  assert.ok(await fs.pathExists(files.link), 'positive control: the artifact is there to lose')

  const up = openUpload(g, meta)
  up.write({ header: { filename: '..', fileSize: data.length, manifest: 'null' } })
  const first = await up.next()
  if (first.data?.response === 'buildId') {
    up.write({ chunk: { data } })
    await up.next()
    up.write({ footer: { hash: Buffer.from(sha3_256(data)) } })
    up.end()
    await up.status
    await settle()
  }
  assert.deepStrictEqual(await fs.readFile(files.blob), data, 'the blob survived')
  assert.ok(await fs.pathExists(files.link), 'the published name survived')
  expectError(first, grpc.status.INVALID_ARGUMENT)
})

// Pins the cleanup that does happen: when the server fails a call, grpc-js
// cancels it and the 'cancelled' handler removes the staging file.
test('a rejected upload does not leave its temp file behind', async (t) => {
  const { g, meta } = await setup(t)

  // Fails at the end, on the hash. Positive control first: while the upload
  // is in flight its staging file is there to be seen, so an empty directory
  // afterwards means it was removed and not that this check cannot see it.
  const data = Buffer.from('twelve bytes')
  const up1 = openUpload(g, meta)
  up1.write({ header: { filename: 'x.zip', fileSize: data.length, manifest: 'null' } })
  expectResponse(await up1.next(), 'buildId')
  assert.strictEqual(tempFiles().length, 1, 'the in-flight upload is staged where this test looks')
  up1.write({ chunk: { data } })
  expectResponse(await up1.next(), 'chunkAck')
  up1.write({ footer: { hash: Buffer.alloc(32) } })
  up1.end()
  expectError(await up1.next(), grpc.status.INVALID_ARGUMENT)
  assert.ok(await eventually(() => tempFiles().length === 0), `left behind: ${tempFiles()}`)

  // Fails at the header.
  const up = openUpload(g, meta)
  up.write({ header: { filename: 'a/b', fileSize: 4, manifest: 'null' } })
  expectError(await up.next(), grpc.status.INVALID_ARGUMENT)
  assert.ok(await eventually(() => tempFiles().length === 0), `left behind: ${tempFiles()}`)
})

test('nothing sent after the server has failed the call is acted on', async (t) => {
  const { h, g, project, meta } = await setup(t)
  const data = Buffer.from('payload')
  const up = openUpload(g, meta)
  up.write({ header: { filename: 'x.zip', fileSize: data.length, manifest: 'null' } })
  expectResponse(await up.next(), 'buildId')

  // A chunk with no data fails the call. Everything after it is well formed
  // and would complete an upload on its own.
  up.write({ chunk: {} })
  up.write({ chunk: { data } })
  up.write({ footer: { hash: Buffer.from(sha3_256(data)) } })
  up.end()
  expectError(await up.next(), grpc.status.INVALID_ARGUMENT)

  await settle()
  assert.strictEqual(await h.schemas.getBuild({ project, id: 1 }), null, 'no build was created')
  assert.ok(!(await fs.pathExists(path.join(h.storagePath, 'assets'))), 'nothing was stored')
})

// The duplicate check on an explicit build id is a database lookup, and the
// rest of a pipelined upload is handled while it runs. If the header counts as
// accepted before that lookup returns, the chunk, the footer and the end of
// the stream all go through and the asset is stored, even though the header is
// refused moments later.
test('a pipelined upload behind a refused header stores nothing', async (t) => {
  const { h, g, meta } = await setup(t)
  const first = await cliUpload(g, meta, {
    header: { filename: 'one.zip', buildId: { id: '7' } },
    data: Buffer.from('first')
  })
  assert.strictEqual(first.status.code, grpc.status.OK, first.status.details)
  const countAssets = async () => (await h.schemas.Asset.count())

  assert.strictEqual(await countAssets(), 1)
  const data = Buffer.from('second')
  const up = openUpload(g, meta)
  up.write({ header: { filename: 'two.zip', buildId: { id: '7' }, fileSize: data.length, manifest: 'null' } })
  up.write({ chunk: { data } })
  up.write({ footer: { hash: Buffer.from(sha3_256(data)) } })
  up.end()
  const seen = []
  for (;;) {
    const event = await up.next(1000)
    if (event.timeout) break
    seen.push(describeEvent(event))
    if (event.error) break
  }
  await settle()
  assert.ok(!seen.includes('response chunkAck'), `responses: ${seen.join(', ')}`)
  assert.ok(seen.at(-1)?.startsWith(`error ${grpc.status.INVALID_ARGUMENT}`), `responses: ${seen.join(', ')}`)
  assert.strictEqual(await countAssets(), 1, 'no asset was stored for the refused upload')
})
