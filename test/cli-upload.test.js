'use strict'

// The CLI's upload loop, run as the binary CI runs. An upload is one gRPC
// stream, so the number of round trips it waits on is what decides how long
// the stream stays open between a CI runner and the origin.

const fs = require('fs-extra')
const os = require('node:os')
const path = require('node:path')

const uploadTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'appdistrib-uploads-'))
process.env.TMPDIR = uploadTmp

const test = require('node:test')
const assert = require('node:assert')
const crypto = require('node:crypto')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const grpc = require('@grpc/grpc-js')
const protoLoader = require('@grpc/proto-loader')

const harness = require('./helpers/harness.js')

const execFileP = promisify(execFile)
const CLI = path.join(__dirname, '..', 'src', 'client', 'index.js')
const PROTO = path.join(__dirname, '..', 'src', 'client', 'appdistrib.proto')

function runCli (port, token, args) {
  return execFileP(
    process.execPath,
    [CLI, '-h', '127.0.0.1', '--port', String(port), '-i', '-o', 'cli-org', '-p', 'cli-project', ...args],
    { env: { ...process.env, APPDISTRIB_TOKEN: token }, timeout: 60_000 }
  )
}

async function writeRandom (dir, name, size) {
  const file = path.join(dir, name)
  const data = crypto.randomBytes(size)
  await fs.writeFile(file, data)
  return { file, data }
}

test('the CLI uploads a multi-chunk file intact', async (t) => {
  const h = await harness.start()
  t.after(() => h.stop())
  const { project } = await h.makeOrgWithProject({ userName: 'cli', orgId: 'cli-org', projectId: 'cli-project' })
  const token = await h.schemas.createToken({ secretKey: h.config.secretKey, project, description: 'ci' })
  h.server.config.grpcConfig = { host: '127.0.0.1', port: 0 }
  const [bound] = await require('../src/back/grpc/service.js').setService(h.server)
  const port = await bound

  const { file, data } = await writeRandom(uploadTmp, 'big.zip', 3 * 1024 * 1024 + 12345)
  const { stdout } = await runCli(port, token, ['upload', file])
  assert.match(stdout, /has completed successfully/)

  const [build] = await h.schemas.listBuilds(project)
  const hex = build.asset.id
  const stored = path.join(h.storagePath, 'assets', hex.slice(0, 3), hex.slice(3, 6), hex.slice(6, 9), hex.slice(9), 'big.zip')
  assert.ok((await fs.readFile(stored)).equals(data), 'the stored bytes are the uploaded bytes')
})

// A stand-in NewBuild that holds back the first chunk's ack until a second
// chunk has arrived, or 3 s have gone by. A client that waits for every ack
// before sending more can only ever have one chunk outstanding.
async function holdingServer () {
  const pkg = grpc.loadPackageDefinition(await protoLoader.load(PROTO, { oneofs: true }))
  const seen = { maxOutstanding: 0, chunks: 0, stalled: false }
  const server = new grpc.Server()
  server.addService(pkg.appdistrib.AppDistrib.service, {
    NewBuild (call) {
      let received = 0
      let acked = 0
      let held = null
      const ack = () => {
        acked++
        call.write({ chunkAck: {} })
      }
      call.on('data', (msg) => {
        if (msg.header) call.write({ buildId: { buildId: { id: '1' } } })
        if (msg.chunk) {
          received++
          seen.chunks++
          seen.maxOutstanding = Math.max(seen.maxOutstanding, received - acked)
          if (received === 1) {
            held = setTimeout(() => {
              seen.stalled = true
              held = null
              ack()
            }, 3000)
          } else {
            if (held) {
              clearTimeout(held)
              held = null
              ack()
            }
            ack()
          }
        }
        if (msg.footer) {
          call.write({ key: { key: 'k' } })
          call.end()
        }
      })
    }
  })
  const port = await new Promise((resolve, reject) =>
    server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (err, p) => (err ? reject(err) : resolve(p)))
  )
  return { server, port, seen }
}

test('the CLI keeps more than one chunk in flight', async (t) => {
  const { server, port, seen } = await holdingServer()
  t.after(() => server.forceShutdown())
  const { file } = await writeRandom(uploadTmp, 'window.zip', 4 * 1024 * 1024)
  await runCli(port, 'tk1.x', ['-b', '1', 'upload', file])
  assert.ok(seen.chunks >= 2, `chunks sent: ${seen.chunks}`)
  assert.strictEqual(seen.stalled, false, 'the client waited on the held ack')
  assert.ok(seen.maxOutstanding > 1, `max outstanding chunks: ${seen.maxOutstanding}`)
})
