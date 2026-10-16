'use strict'

// SetProjectIndex over gRPC and the /alias HTTP route that serves what it, and
// uploaded builds, make available.

const fs = require('fs-extra')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')

// See grpc.test.js: temp picks its directory when first required.
process.env.TMPDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'appdistrib-alias-'))

const test = require('node:test')
const assert = require('node:assert')
const base85 = require('base85')
const grpc = require('@grpc/grpc-js')
const { sha3_256 } = require('@noble/hashes/sha3')

const harness = require('./helpers/harness.js')

const ORG = 'alias-org'
const PROJECT = 'alias-project'

async function setup (t) {
  const h = await harness.start()
  t.after(() => h.stop())
  const { project } = await h.makeOrgWithProject({
    userName: 'owner',
    orgId: ORG,
    projectId: PROJECT
  })
  const token = await h.schemas.createToken({
    secretKey: h.config.secretKey,
    project,
    description: 'ci'
  })
  const g = await h.startGrpc()
  await require('../src/back/web/static.js').setRoutes(h.server)
  const meta = { token, organization: ORG, project: PROJECT }
  return { h, g, project, meta }
}

function setIndex (g, meta, index) {
  return new Promise((resolve) => {
    g.client.SetProjectIndex({ index }, g.metadata(meta), (error, res) =>
      resolve({ error, res })
    )
  })
}

// A full NewBuild upload of `data` named `filename`, as the CLI does it.
function upload (g, meta, filename, data) {
  return new Promise((resolve, reject) => {
    const call = g.client.NewBuild(g.metadata(meta))
    call.on('error', reject)
    call.on('data', (payload) => {
      if (payload.response === 'buildId') {
        call.write({ chunk: { data } })
      } else if (payload.response === 'chunkAck') {
        call.write({ footer: { hash: Buffer.from(sha3_256(data)) } })
        call.end()
      } else if (payload.response === 'key') {
        resolve(payload.key.key)
      }
    })
    call.write({
      header: { fileSize: data.length, filename, manifest: 'null' }
    })
  })
}

// The harness's own helpers follow redirects; these need to see them.
async function httpGet (h, urlPath) {
  return new Promise((resolve, reject) => {
    const u = new URL(h.base)
    // http.request with the raw path, so that nothing normalizes ".." away.
    http
      .request(
        { host: u.hostname, port: u.port, path: urlPath, method: 'GET' },
        (res) => {
          const chunks = []
          res.on('data', (c) => chunks.push(c))
          res.on('end', () =>
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: Buffer.concat(chunks).toString()
            })
          )
        }
      )
      .on('error', reject)
      .end()
  })
}

const alias = (name) => `/alias/${ORG}/${PROJECT}/${name}`

test('SetProjectIndex writes the index with a valid token', async (t) => {
  const { h, g, project, meta } = await setup(t)
  const index = Buffer.from(JSON.stringify({ latest: '1.2.3' }))
  const { error } = await setIndex(g, meta, index)
  assert.ifError(error)
  const dir = h.server.getProjectManifestPath(project)
  assert.deepStrictEqual(await fs.readFile(path.join(dir, 'index.json')), index)
  assert.deepStrictEqual(
    (await fs.readdir(dir)).filter((f) => f.endsWith('.tmp')),
    []
  )
  // Replacing it works too.
  const second = Buffer.from('[1]')
  assert.ifError((await setIndex(g, meta, second)).error)
  assert.deepStrictEqual(await fs.readFile(path.join(dir, 'index.json')), second)
})

test('SetProjectIndex refuses a bad token', async (t) => {
  const { g, meta } = await setup(t)
  const { error } = await setIndex(g, { ...meta, token: 'tk1.garbage' }, Buffer.from('{}'))
  assert.strictEqual(error.code, grpc.status.UNAUTHENTICATED)
})

test('SetProjectIndex refuses invalid or oversized JSON', async (t) => {
  const { h, g, project, meta } = await setup(t)
  let r = await setIndex(g, meta, Buffer.from('{not json'))
  assert.strictEqual(r.error.code, grpc.status.INVALID_ARGUMENT)
  r = await setIndex(g, meta, Buffer.alloc(0))
  assert.strictEqual(r.error.code, grpc.status.INVALID_ARGUMENT)
  const big = Buffer.from('"' + 'a'.repeat(1024 * 1024) + '"')
  r = await setIndex(g, meta, big)
  assert.strictEqual(r.error.code, grpc.status.INVALID_ARGUMENT)
  assert.ok(
    !(await fs.pathExists(
      path.join(h.server.getProjectManifestPath(project), 'index.json')
    ))
  )
})

test('/alias serves index.json, 404 before upload', async (t) => {
  const { h, g, meta } = await setup(t)
  let r = await httpGet(h, alias('index.json'))
  assert.strictEqual(r.status, 404)
  const index = JSON.stringify({ latest: '1.2.3' })
  assert.ifError((await setIndex(g, meta, Buffer.from(index))).error)
  r = await httpGet(h, alias('index.json'))
  assert.strictEqual(r.status, 200)
  // Express appends the charset; the media type is what matters.
  assert.match(r.headers['content-type'], /^application\/json(;|$)/)
  assert.strictEqual(r.headers['cache-control'], 'no-cache')
  assert.strictEqual(r.body, index)
})

test('/alias 404s on unknown organization and project', async (t) => {
  const { h } = await setup(t)
  assert.strictEqual((await httpGet(h, '/alias/nope/x/index.json')).status, 404)
  assert.strictEqual(
    (await httpGet(h, `/alias/${ORG}/nope/index.json`)).status,
    404
  )
  assert.strictEqual((await httpGet(h, `/alias/${ORG}/nope/a.zip`)).status, 404)
})

test('/alias redirects a filename to the newest build with it', async (t) => {
  const { h, g, project, meta } = await setup(t)
  const assetPath = (k, name) =>
    `/storage/assets/${k.slice(0, 3)}/${k.slice(3, 6)}/${k.slice(6, 9)}/${k.slice(9)}/${name}`
  const keyOf = (key) => Buffer.from(base85.decode(key)).toString('hex')

  const key1 = keyOf(await upload(g, meta, 'app.zip', Buffer.from('first build')))
  const keyOther = keyOf(await upload(g, meta, 'other.zip', Buffer.from('another file')))
  let r = await httpGet(h, alias('app.zip'))
  assert.strictEqual(r.status, 302)
  assert.strictEqual(r.headers.location, assetPath(key1, 'app.zip'))
  assert.strictEqual(r.headers['cache-control'], 'no-cache')

  // A newer build with the same filename wins.
  const key2 = keyOf(await upload(g, meta, 'app.zip', Buffer.from('second build')))
  assert.notStrictEqual(key1, key2)
  r = await httpGet(h, alias('app.zip'))
  assert.strictEqual(r.status, 302)
  assert.strictEqual(r.headers.location, assetPath(key2, 'app.zip'))

  // The other file is unaffected.
  r = await httpGet(h, alias('other.zip'))
  assert.strictEqual(r.headers.location, assetPath(keyOther, 'other.zip'))

  // /latest still redirects, to the newest build's asset.
  const last = await h.schemas.getLastBuild(project)
  r = await httpGet(h, `/pub/org/${ORG}/project/${PROJECT}/latest`)
  assert.strictEqual(r.status, 302)
  assert.strictEqual(r.headers.location, assetPath(last.asset.id, last.asset.filename))
})

test('/alias 404s on an unknown filename', async (t) => {
  const { h, g, meta } = await setup(t)
  await upload(g, meta, 'app.zip', Buffer.from('x'))
  const r = await httpGet(h, alias('missing.zip'))
  assert.strictEqual(r.status, 404)
  assert.ok(!r.headers.location)
})

test('/alias refuses traversal-shaped filenames', async (t) => {
  const { h, g, meta } = await setup(t)
  await upload(g, meta, 'app.zip', Buffer.from('x'))
  for (const name of ['..', '.', '%2e%2e', 'a%2Fb.zip', '..%2Fapp.zip', 'a%5Cb', 'a%00b']) {
    const r = await httpGet(h, alias(name))
    assert.ok(r.status >= 400 && r.status < 500, `${name}: ${r.status}`)
    assert.ok(!r.headers.location, `${name} must not redirect`)
  }
})
