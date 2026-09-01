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
