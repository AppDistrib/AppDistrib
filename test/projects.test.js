'use strict'

const test = require('node:test')
const assert = require('node:assert')

const harness = require('./helpers/harness.js')

// project.key is half of the HMAC key for every token in the project
// (secretKey + '|' + project.key). It must never appear in a response body.
test('the project key never reaches the client', async (t) => {
  const h = await harness.start()
  t.after(() => h.stop())

  const alice = await h.makeOrgWithProject({
    userName: 'alice',
    orgId: 'alice-org',
    projectId: 'seed-project'
  })
  h.becomeUser(alice.user)

  const created = await h.post('/api/v1/projects/create', {
    orgId: 'alice-org',
    id: 'new-project',
    name: 'New Project'
  })
  assert.strictEqual(created.status, 200)
  assert.ok(
    !('key' in created.body),
    'create must not return the project key'
  )

  const listed = await h.get('/api/v1/projects/list?orgId=alice-org')
  assert.strictEqual(listed.status, 200)
  for (const project of listed.body) {
    assert.ok(!('key' in project), 'list must not return the project key')
  }

  // Belt and braces: the key genuinely exists server-side, so a test that
  // passed because no key was ever generated would be worthless.
  const stored = await h.schemas.findProject({
    id: 'new-project',
    organization: alice.org
  })
  assert.ok(stored.key && stored.key.length > 0, 'the key does exist on the row')
  assert.ok(
    !JSON.stringify(created.body).includes(stored.key),
    'the stored key value must not appear anywhere in the create response'
  )
})

test('both project responses use the bare id, not the org-prefixed one', async (t) => {
  const h = await harness.start()
  t.after(() => h.stop())

  const alice = await h.makeOrgWithProject({
    userName: 'alice',
    orgId: 'alice-org',
    projectId: 'seed-project'
  })
  h.becomeUser(alice.user)

  const created = await h.post('/api/v1/projects/create', {
    orgId: 'alice-org',
    id: 'new-project',
    name: 'New Project'
  })
  assert.strictEqual(created.body.id, 'new-project')

  const listed = await h.get('/api/v1/projects/list?orgId=alice-org')
  const ids = listed.body.map((p) => p.id).sort()
  assert.deepStrictEqual(ids, ['new-project', 'seed-project'])
})

test('an unauthenticated caller gets 401, not data', async (t) => {
  const h = await harness.start()
  t.after(() => h.stop())

  await h.makeOrgWithProject({
    userName: 'alice',
    orgId: 'alice-org',
    projectId: 'seed-project'
  })
  h.becomeNobody()

  const listed = await h.get('/api/v1/projects/list?orgId=alice-org')
  assert.strictEqual(listed.status, 401)
})

test('a member of one org cannot list another org projects', async (t) => {
  const h = await harness.start()
  t.after(() => h.stop())

  const alice = await h.makeOrgWithProject({
    userName: 'alice',
    orgId: 'alice-org',
    projectId: 'alice-project'
  })
  await h.makeOrgWithProject({
    userName: 'bob',
    orgId: 'bob-org',
    projectId: 'bob-project'
  })

  h.becomeUser(alice.user)
  const res = await h.get('/api/v1/projects/list?orgId=bob-org')
  assert.strictEqual(res.status, 404, "alice must not see bob's org")
})

test('creating a project whose id is taken in the same org is a 409', async (t) => {
  const h = await harness.start()
  t.after(() => h.stop())
  const alice = await h.makeOrgWithProject({
    userName: 'alice',
    orgId: 'alice-org',
    projectId: 'taken'
  })
  h.becomeUser(alice.user)
  const before = await h.schemas.findProject({ id: 'taken', organization: alice.org })

  const res = await h.post('/api/v1/projects/create', {
    orgId: 'alice-org',
    id: 'taken',
    name: 'Again'
  })
  assert.strictEqual(res.status, 409)

  const after = await h.schemas.findProject({ id: 'taken', organization: alice.org })
  assert.strictEqual(after.name, 'taken', 'the existing name is untouched')
  assert.strictEqual(after.key, before.key, 'the existing key is untouched')
})

// Control for the test above: project ids are only unique within their org.
test('the same project id can exist in two different orgs', async (t) => {
  const h = await harness.start()
  t.after(() => h.stop())
  await h.makeOrgWithProject({
    userName: 'alice',
    orgId: 'alice-org',
    projectId: 'shared'
  })
  const bob = await h.makeOrgWithProject({
    userName: 'bob',
    orgId: 'bob-org',
    projectId: 'bob-project'
  })
  h.becomeUser(bob.user)

  const res = await h.post('/api/v1/projects/create', {
    orgId: 'bob-org',
    id: 'shared',
    name: 'Shared'
  })
  assert.strictEqual(res.status, 200)
  assert.ok(await h.schemas.findProject({ id: 'shared', organization: bob.org }))
})

test('a member of one org cannot create a project in another org', async (t) => {
  const h = await harness.start()
  t.after(() => h.stop())
  const alice = await h.makeOrgWithProject({
    userName: 'alice',
    orgId: 'alice-org',
    projectId: 'alice-project'
  })
  const bob = await h.makeOrgWithProject({
    userName: 'bob',
    orgId: 'bob-org',
    projectId: 'bob-project'
  })
  h.becomeUser(alice.user)

  const res = await h.post('/api/v1/projects/create', {
    orgId: 'bob-org',
    id: 'planted',
    name: 'Planted'
  })
  assert.strictEqual(res.status, 404)
  assert.strictEqual(
    await h.schemas.findProject({ id: 'planted', organization: bob.org }),
    false
  )
})

test('an unauthenticated caller cannot create, rename or re-describe a project', async (t) => {
  const h = await harness.start()
  t.after(() => h.stop())
  const alice = await h.makeOrgWithProject({
    userName: 'alice',
    orgId: 'alice-org',
    projectId: 'alice-project'
  })
  h.becomeNobody()

  const created = await h.post('/api/v1/projects/create', {
    orgId: 'alice-org',
    id: 'anon-project',
    name: 'Anon'
  })
  assert.strictEqual(created.status, 401)
  assert.strictEqual(
    await h.schemas.findProject({ id: 'anon-project', organization: alice.org }),
    false
  )

  const renamed = await h.post('/api/v1/projects/rename', {
    orgId: 'alice-org',
    id: 'alice-project',
    name: 'Renamed'
  })
  assert.strictEqual(renamed.status, 401)

  const described = await h.post('/api/v1/projects/setDescription', {
    orgId: 'alice-org',
    id: 'alice-project',
    description: 'Described'
  })
  assert.strictEqual(described.status, 401)

  const project = await h.schemas.findProject({
    id: 'alice-project',
    organization: alice.org
  })
  assert.strictEqual(project.name, 'alice-project')
  assert.strictEqual(project.description, null)
})

test('project create rejects a missing org and malformed ids and names', async (t) => {
  const h = await harness.start()
  t.after(() => h.stop())
  const alice = await h.makeOrgWithProject({
    userName: 'alice',
    orgId: 'alice-org',
    projectId: 'seed-project'
  })
  h.becomeUser(alice.user)

  const noOrg = await h.post('/api/v1/projects/create', { id: 'p', name: 'P' })
  assert.strictEqual(noOrg.status, 400)

  for (const id of [
    undefined,
    '',
    42,
    ['a'],
    'UPPER',
    'a:b',
    'a/b',
    '..',
    'a'.repeat(65)
  ]) {
    const res = await h.post('/api/v1/projects/create', {
      orgId: 'alice-org',
      id,
      name: 'Name'
    })
    assert.strictEqual(res.status, 400, `id ${JSON.stringify(id)} must be refused`)
  }
  for (const name of [undefined, '', 42, 'n'.repeat(256)]) {
    const res = await h.post('/api/v1/projects/create', {
      orgId: 'alice-org',
      id: 'fresh',
      name
    })
    assert.strictEqual(
      res.status,
      400,
      `name ${JSON.stringify(name)?.slice(0, 20)} must be refused`
    )
  }

  const listed = await h.get('/api/v1/projects/list?orgId=alice-org')
  assert.deepStrictEqual(listed.body.map((p) => p.id), ['seed-project'])

  // VARCHAR(255) counts characters, not UTF-16 code units.
  const astral = await h.post('/api/v1/projects/create', {
    orgId: 'alice-org',
    id: 'astral',
    name: 'n'.repeat(254) + '\u{1F600}'
  })
  assert.strictEqual(astral.status, 200, 'a 255-character name with an astral character still fits')
})

test('a member can rename and re-describe a project', async (t) => {
  const h = await harness.start()
  t.after(() => h.stop())
  const alice = await h.makeOrgWithProject({
    userName: 'alice',
    orgId: 'alice-org',
    projectId: 'alice-project'
  })
  h.becomeUser(alice.user)

  const renamed = await h.post('/api/v1/projects/rename', {
    orgId: 'alice-org',
    id: 'alice-project',
    name: 'Renamed'
  })
  assert.strictEqual(renamed.status, 200)
  const described = await h.post('/api/v1/projects/setDescription', {
    orgId: 'alice-org',
    id: 'alice-project',
    description: 'Described'
  })
  assert.strictEqual(described.status, 200)

  const project = await h.schemas.findProject({
    id: 'alice-project',
    organization: alice.org
  })
  assert.strictEqual(project.name, 'Renamed')
  assert.strictEqual(project.description, 'Described')
})

test('a member of one org cannot rename or re-describe another org project', async (t) => {
  const h = await harness.start()
  t.after(() => h.stop())
  const alice = await h.makeOrgWithProject({
    userName: 'alice',
    orgId: 'alice-org',
    projectId: 'alice-project'
  })
  const bob = await h.makeOrgWithProject({
    userName: 'bob',
    orgId: 'bob-org',
    projectId: 'bob-project'
  })
  h.becomeUser(alice.user)

  const renamed = await h.post('/api/v1/projects/rename', {
    orgId: 'bob-org',
    id: 'bob-project',
    name: 'pwned'
  })
  assert.strictEqual(renamed.status, 404)
  const described = await h.post('/api/v1/projects/setDescription', {
    orgId: 'bob-org',
    id: 'bob-project',
    description: 'pwned'
  })
  assert.strictEqual(described.status, 404)

  const project = await h.schemas.findProject({
    id: 'bob-project',
    organization: bob.org
  })
  assert.strictEqual(project.name, 'bob-project')
  assert.strictEqual(project.description, null)
})

test('project rename and setDescription reject malformed input and unknown projects', async (t) => {
  const h = await harness.start()
  t.after(() => h.stop())
  const alice = await h.makeOrgWithProject({
    userName: 'alice',
    orgId: 'alice-org',
    projectId: 'alice-project'
  })
  h.becomeUser(alice.user)

  for (const name of [undefined, '', 42, 'n'.repeat(256)]) {
    const res = await h.post('/api/v1/projects/rename', {
      orgId: 'alice-org',
      id: 'alice-project',
      name
    })
    assert.strictEqual(
      res.status,
      400,
      `rename to ${JSON.stringify(name)?.slice(0, 20)} must be refused`
    )
  }
  for (const description of [undefined, 42, { a: 1 }]) {
    const res = await h.post('/api/v1/projects/setDescription', {
      orgId: 'alice-org',
      id: 'alice-project',
      description
    })
    assert.strictEqual(
      res.status,
      400,
      `description ${JSON.stringify(description)} must be refused`
    )
  }
  for (const route of ['rename', 'setDescription']) {
    const body = { name: 'X', description: 'X' }
    const noOrg = await h.post(`/api/v1/projects/${route}`, { ...body, id: 'alice-project' })
    assert.strictEqual(noOrg.status, 400, `${route} without orgId`)
    const noId = await h.post(`/api/v1/projects/${route}`, { ...body, orgId: 'alice-org' })
    assert.strictEqual(noId.status, 400, `${route} without id`)
    const unknown = await h.post(`/api/v1/projects/${route}`, {
      ...body,
      orgId: 'alice-org',
      id: 'no-such-project'
    })
    assert.strictEqual(unknown.status, 404, `${route} of an unknown project`)
  }

  const project = await h.schemas.findProject({
    id: 'alice-project',
    organization: alice.org
  })
  assert.strictEqual(project.name, 'alice-project')
  assert.strictEqual(project.description, null)
})

// rename and setDescription regenerate the manifest. When that write fails the
// route must answer with an error, not answer success first and then try to
// send a 500 on top of it from the catch, which throws out of the handler.
test('a manifest write failure on rename or setDescription is a 500, not a crash', async (t) => {
  const h = await harness.start()
  t.after(() => h.stop())
  const alice = await h.makeOrgWithProject({
    userName: 'alice',
    orgId: 'alice-org',
    projectId: 'alice-project'
  })
  h.becomeUser(alice.user)

  // A plain file where the project's manifest directory should be.
  const fs = require('fs-extra')
  const blocked = h.server.getProjectManifestPath(alice.project)
  await fs.ensureDir(require('node:path').dirname(blocked))
  await fs.writeFile(blocked, 'not a directory')

  const unhandled = []
  const onUnhandled = (err) => unhandled.push(err)
  process.on('unhandledRejection', onUnhandled)
  t.after(() => process.off('unhandledRejection', onUnhandled))

  for (const [route, body] of [
    ['rename', { name: 'Renamed' }],
    ['setDescription', { description: 'Described' }]
  ]) {
    const res = await h.post(`/api/v1/projects/${route}`, {
      orgId: 'alice-org',
      id: 'alice-project',
      ...body
    })
    assert.strictEqual(res.status, 500, `${route} must report the failure`)
  }
  // Give a rejection escaping the handler a chance to be reported.
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepStrictEqual(unhandled.map(String), [], 'nothing escaped the handler')

  // The server is still answering.
  const listed = await h.get('/api/v1/projects/list?orgId=alice-org')
  assert.strictEqual(listed.status, 200)
})
