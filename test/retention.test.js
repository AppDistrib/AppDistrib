'use strict'

// Retention is the only code here that deletes things: createBuild prunes
// ephemeral builds past the project's `historical` count, the five-minute cron
// sweeps assets no build refers to any more, and the nightly cron removes the
// directories that leaves behind. Uploads are staged the way NewBuild stages
// them - moveAsset, createBuild, then the three generators - against a real
// database and a real storage directory.

const test = require('node:test')
const assert = require('node:assert')
const path = require('node:path')
const fs = require('fs-extra')
const { sha3_256 } = require('@noble/hashes/sha3')
const { hmac } = require('@noble/hashes/hmac')

const harness = require('./helpers/harness.js')

const ORG = 'retention-org'
const PROJECT = 'retention-project'

async function setup (t, { historical = 3 } = {}) {
  const h = await harness.start()
  t.after(() => h.stop())
  const { org, project } = await h.makeOrgWithProject({
    userName: 'keeper',
    orgId: ORG,
    projectId: PROJECT
  })
  await project.update({ historical })
  return { h, org, project }
}

function keyFor (h, content) {
  return Buffer.from(hmac(sha3_256, h.config.storage.secretKey, content))
}

function assetPaths (h, key) {
  const hex = key.toString('hex')
  const dir = path.join(
    h.storagePath,
    'assets',
    hex.slice(0, 3),
    hex.slice(3, 6),
    hex.slice(6, 9),
    hex.slice(9)
  )
  return { dir, blob: dir + '.data' }
}

function projectFile (h, kind, name) {
  return path.join(h.storagePath, kind, ORG, PROJECT, name)
}

// The same sequence NewBuild runs on `end`, minus the stream.
async function upload (h, org, project, { buildId, content, filename, keep = false, changelog }) {
  const key = keyFor(h, content)
  const staged = path.join(h.storagePath, `staged-${buildId}-${filename}`)
  await fs.writeFile(staged, content)
  await h.server.moveAsset(staged, filename, key)
  const build = await h.schemas.createBuild({
    project,
    id: buildId,
    manifest: { version: String(buildId) },
    assetId: key.toString('hex'),
    filename,
    hashes: { sha3: Buffer.from(sha3_256(content)).toString('hex') },
    size: content.length,
    keep
  })
  await h.server.generateBuildManifest(build, project)
  await h.server.generateBuildChangelog(build, project, changelog)
  await h.server.generateProjectManifest(project, org)
  return key
}

async function survivingBuildIds (h, project) {
  const builds = await h.schemas.Build.findAll({ where: { projectId: project.id } })
  return builds.map((b) => b.buildId).sort((a, b) => a - b)
}

async function emptyDirs (dir) {
  const found = []
  for (const entry of await fs.readdir(dir)) {
    const full = path.join(dir, entry)
    if ((await fs.stat(full)).isDirectory()) {
      if ((await fs.readdir(full)).length === 0) found.push(full)
      else found.push(...(await emptyDirs(full)))
    }
  }
  return found
}

test('createBuild keeps the newest `historical` ephemeral builds and deletes the rest with their files', async (t) => {
  const { h, org, project } = await setup(t, { historical: 3 })
  for (let id = 1; id <= 5; id++) {
    await upload(h, org, project, {
      buildId: id,
      content: Buffer.from(`build ${id}`),
      filename: `app-${id}.zip`,
      changelog: `changes in ${id}`
    })
  }

  assert.deepStrictEqual(await survivingBuildIds(h, project), [3, 4, 5])
  for (const id of [1, 2]) {
    assert.strictEqual(await fs.pathExists(projectFile(h, 'manifests', `manifest-${id}.json`)), false, `manifest-${id}`)
    assert.strictEqual(await fs.pathExists(projectFile(h, 'changelogs', `changelog-${id}.md`)), false, `changelog-${id}`)
  }
  for (const id of [3, 4, 5]) {
    assert.strictEqual(await fs.pathExists(projectFile(h, 'manifests', `manifest-${id}.json`)), true, `manifest-${id}`)
    assert.strictEqual(await fs.pathExists(projectFile(h, 'changelogs', `changelog-${id}.md`)), true, `changelog-${id}`)
  }
  const manifest = await fs.readJson(projectFile(h, 'manifests', 'manifest.json'))
  assert.deepStrictEqual(manifest.builds.map((b) => b.id), [5, 4, 3])
})

test('kept builds are never pruned and do not count against `historical`', async (t) => {
  const { h, org, project } = await setup(t, { historical: 2 })
  await upload(h, org, project, { buildId: 1, content: Buffer.from('release'), filename: 'release.zip', keep: true })
  for (let id = 2; id <= 5; id++) {
    await upload(h, org, project, { buildId: id, content: Buffer.from(`dev ${id}`), filename: `dev-${id}.zip` })
  }
  assert.deepStrictEqual(await survivingBuildIds(h, project), [1, 4, 5])
  assert.strictEqual(await fs.pathExists(projectFile(h, 'manifests', 'manifest-1.json')), true)
})

test('the orphan sweep deletes the blobs of pruned builds and only those', async (t) => {
  const { h, org, project } = await setup(t, { historical: 2 })
  // Build 1's bytes are uploaded again as build 3, so its asset outlives the
  // prune of build 1. Build 2's asset is unique and dies with it.
  const shared = Buffer.from('shared bytes')
  const sharedKey = await upload(h, org, project, { buildId: 1, content: shared, filename: 'a.zip' })
  const lonelyKey = await upload(h, org, project, { buildId: 2, content: Buffer.from('only build 2'), filename: 'b.zip' })
  await upload(h, org, project, { buildId: 3, content: shared, filename: 'a.zip' })
  const liveKey = await upload(h, org, project, { buildId: 4, content: Buffer.from('build 4'), filename: 'd.zip' })
  assert.deepStrictEqual(await survivingBuildIds(h, project), [3, 4])

  // Pruning only removes rows: the blob stays until the sweep finds it.
  assert.strictEqual(await fs.pathExists(assetPaths(h, lonelyKey).blob), true)

  await h.server.sweepOrphanAssets()

  assert.strictEqual(await fs.pathExists(assetPaths(h, lonelyKey).blob), false)
  assert.strictEqual(await fs.pathExists(assetPaths(h, lonelyKey).dir), false)
  assert.strictEqual(await h.schemas.Asset.findByPk(lonelyKey.toString('hex')), null)
  for (const key of [sharedKey, liveKey]) {
    assert.strictEqual(await fs.pathExists(assetPaths(h, key).blob), true)
    assert.notStrictEqual(await h.schemas.Asset.findByPk(key.toString('hex')), null)
  }
  assert.deepStrictEqual(
    await fs.readFile(path.join(assetPaths(h, sharedKey).dir, 'a.zip')),
    shared
  )
})

test('the orphan sweep leaves an asset alone while any build refers to it', async (t) => {
  const { h, org, project } = await setup(t, { historical: 100 })
  const key = await upload(h, org, project, { buildId: 1, content: Buffer.from('in use'), filename: 'x.zip' })
  await h.server.sweepOrphanAssets()
  assert.strictEqual(await fs.pathExists(assetPaths(h, key).blob), true)
  assert.notStrictEqual(await h.schemas.Asset.findByPk(key.toString('hex')), null)
})

test('one empty-folder pass clears every directory a swept asset leaves behind', async (t) => {
  const { h, org, project } = await setup(t, { historical: 1 })
  const goneKey = await upload(h, org, project, { buildId: 1, content: Buffer.from('gone'), filename: 'g.zip' })
  const keptKey = await upload(h, org, project, { buildId: 2, content: Buffer.from('kept'), filename: 'k.zip' })
  await h.server.sweepOrphanAssets()
  assert.strictEqual(await fs.pathExists(assetPaths(h, goneKey).blob), false)

  await h.server.deleteSomeEmptyFolders(h.storagePath)

  assert.deepStrictEqual(await emptyDirs(h.storagePath), [])
  assert.strictEqual(await fs.pathExists(assetPaths(h, keptKey).blob), true)
  assert.strictEqual(await fs.pathExists(path.join(assetPaths(h, keptKey).dir, 'k.zip')), true)
})

test('the empty-folder pass never removes the storage root itself', async (t) => {
  const { h } = await setup(t)
  assert.deepStrictEqual(await fs.readdir(h.storagePath), [])
  await h.server.deleteSomeEmptyFolders(h.storagePath)
  assert.strictEqual(await fs.pathExists(h.storagePath), true)
})
