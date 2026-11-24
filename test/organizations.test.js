'use strict'

const test = require('node:test')
const assert = require('node:assert')

const harness = require('./helpers/harness.js')

// A user with no organization yet. findOrCreateUser is the only creation path
// in Schemas, and nothing in the application ever enables a user, so that is
// done by hand, the same way makeOrgWithProject does it.
async function makeUser (h, userName, { enabled = true } = {}) {
  const user = await h.schemas.findOrCreateUser({
    provider: 'test',
    id: userName,
    screenName: userName,
    avatarURL: null
  })
  await user.update({ enabled })
  return user
}

test('an enabled user can create an organization and is a member of it', async (t) => {
  const h = await harness.start()
  t.after(() => h.stop())
  const alice = h.becomeUser(await makeUser(h, 'alice'))

  const res = await h.post('/api/v1/orgs/create', {
    id: 'alice-org',
    name: 'Alice Org'
  })
  assert.strictEqual(res.status, 200)

  const org = await h.schemas.findOrganization('alice-org')
  assert.ok(org, 'the organization exists')
  assert.strictEqual(org.name, 'Alice Org')
  assert.ok(await org.hasUser(alice), 'its creator is a member')

  const listed = await h.get('/api/v1/orgs/list')
  assert.strictEqual(listed.status, 200)
  assert.deepStrictEqual(
    listed.body.map((o) => o.id),
    ['alice-org']
  )
})

test('creating an organization whose id is taken is a 409 and leaves the original alone', async (t) => {
  const h = await harness.start()
  t.after(() => h.stop())
  await h.makeOrgWithProject({
    userName: 'alice',
    orgId: 'taken',
    projectId: 'alice-project'
  })
  const bob = h.becomeUser(await makeUser(h, 'bob'))

  const res = await h.post('/api/v1/orgs/create', {
    id: 'taken',
    name: 'Hijacked'
  })
  assert.strictEqual(res.status, 409)

  const org = await h.schemas.findOrganization('taken')
  assert.strictEqual(org.name, 'taken', 'the existing name is untouched')
  assert.ok(!(await org.hasUser(bob)), 'bob did not become a member')
})

test('organization create rejects malformed ids', async (t) => {
  const h = await harness.start()
  t.after(() => h.stop())
  h.becomeUser(await makeUser(h, 'alice'))

  // `..` and `/` matter most: the id becomes a directory under manifests/.
  for (const id of [
    undefined,
    '',
    42,
    ['a'],
    'UPPER',
    'has space',
    'a/b',
    '..',
    'a'.repeat(65)
  ]) {
    const res = await h.post('/api/v1/orgs/create', { id, name: 'Name' })
    assert.strictEqual(res.status, 400, `id ${JSON.stringify(id)} must be refused`)
  }
  // A 64-character id is the longest allowed and is the positive control for
  // the length bound above.
  const longest = await h.post('/api/v1/orgs/create', {
    id: 'a'.repeat(64),
    name: 'Name'
  })
  assert.strictEqual(longest.status, 200)

  const listed = await h.get('/api/v1/orgs/list')
  assert.deepStrictEqual(listed.body.map((o) => o.id), ['a'.repeat(64)])
})

test('organization create rejects a missing, empty, non-string or over-long name', async (t) => {
  const h = await harness.start()
  t.after(() => h.stop())
  h.becomeUser(await makeUser(h, 'alice'))

  for (const name of [undefined, '', 42, { a: 1 }, 'n'.repeat(256)]) {
    const res = await h.post('/api/v1/orgs/create', { id: 'alice-org', name })
    assert.strictEqual(
      res.status,
      400,
      `name ${JSON.stringify(name)?.slice(0, 20)} must be refused`
    )
  }
  assert.strictEqual(await h.schemas.findOrganization('alice-org'), false)

  const longest = await h.post('/api/v1/orgs/create', {
    id: 'alice-org',
    name: 'n'.repeat(255)
  })
  assert.strictEqual(longest.status, 200, 'a 255-character name still fits')

  // VARCHAR(255) counts characters: 254 ASCII plus one astral character is 255, though .length is 256.
  const astral = await h.post('/api/v1/orgs/create', {
    id: 'alice-astral',
    name: 'n'.repeat(254) + '\u{1F600}'
  })
  assert.strictEqual(astral.status, 200, 'a 255-character name with an astral character still fits')
})

test('a user who has not been enabled cannot create an organization', async (t) => {
  const h = await harness.start()
  t.after(() => h.stop())
  h.becomeUser(await makeUser(h, 'mallory', { enabled: false }))

  const res = await h.post('/api/v1/orgs/create', {
    id: 'mallory-org',
    name: 'Mallory Org'
  })
  assert.strictEqual(res.status, 403)
  assert.match(res.body.error, /enabled/)
  assert.strictEqual(await h.schemas.findOrganization('mallory-org'), false)
})

test('an unauthenticated caller cannot list, create, rename or re-describe organizations', async (t) => {
  const h = await harness.start()
  t.after(() => h.stop())
  await h.makeOrgWithProject({
    userName: 'alice',
    orgId: 'alice-org',
    projectId: 'alice-project'
  })
  h.becomeNobody()

  const created = await h.post('/api/v1/orgs/create', {
    id: 'anon-org',
    name: 'Anon'
  })
  assert.strictEqual(created.status, 401)
  assert.strictEqual(await h.schemas.findOrganization('anon-org'), false)

  const renamed = await h.post('/api/v1/orgs/rename', {
    id: 'alice-org',
    name: 'Renamed'
  })
  assert.strictEqual(renamed.status, 401)

  const described = await h.post('/api/v1/orgs/setDescription', {
    id: 'alice-org',
    description: 'Described'
  })
  assert.strictEqual(described.status, 401)

  const listed = await h.get('/api/v1/orgs/list')
  assert.strictEqual(listed.status, 401)

  const org = await h.schemas.findOrganization('alice-org')
  assert.strictEqual(org.name, 'alice-org')
  assert.strictEqual(org.description, null)
})

test('a member can rename and re-describe their organization', async (t) => {
  const h = await harness.start()
  t.after(() => h.stop())
  const alice = await h.makeOrgWithProject({
    userName: 'alice',
    orgId: 'alice-org',
    projectId: 'alice-project'
  })
  h.becomeUser(alice.user)

  const renamed = await h.post('/api/v1/orgs/rename', {
    id: 'alice-org',
    name: 'Renamed'
  })
  assert.strictEqual(renamed.status, 200)

  const described = await h.post('/api/v1/orgs/setDescription', {
    id: 'alice-org',
    description: 'Described'
  })
  assert.strictEqual(described.status, 200, JSON.stringify(described.body))

  const org = await h.schemas.findOrganization('alice-org')
  assert.strictEqual(org.name, 'Renamed')
  assert.strictEqual(org.description, 'Described')
})

test('a member of one org cannot rename or re-describe another org', async (t) => {
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

  const renamed = await h.post('/api/v1/orgs/rename', {
    id: 'bob-org',
    name: 'pwned'
  })
  assert.strictEqual(renamed.status, 404)

  const described = await h.post('/api/v1/orgs/setDescription', {
    id: 'bob-org',
    description: 'pwned'
  })
  assert.strictEqual(described.status, 404)

  const org = await h.schemas.findOrganization('bob-org')
  assert.strictEqual(org.name, 'bob-org')
  assert.strictEqual(org.description, null)
})

test('organization rename and setDescription reject malformed input', async (t) => {
  const h = await harness.start()
  t.after(() => h.stop())
  const alice = await h.makeOrgWithProject({
    userName: 'alice',
    orgId: 'alice-org',
    projectId: 'alice-project'
  })
  h.becomeUser(alice.user)

  for (const name of [undefined, '', 42, 'n'.repeat(256)]) {
    const res = await h.post('/api/v1/orgs/rename', { id: 'alice-org', name })
    assert.strictEqual(
      res.status,
      400,
      `rename to ${JSON.stringify(name)?.slice(0, 20)} must be refused`
    )
  }
  const noId = await h.post('/api/v1/orgs/rename', { name: 'Renamed' })
  assert.strictEqual(noId.status, 400)

  for (const description of [undefined, 42, { a: 1 }]) {
    const res = await h.post('/api/v1/orgs/setDescription', {
      id: 'alice-org',
      description
    })
    assert.strictEqual(
      res.status,
      400,
      `description ${JSON.stringify(description)} must be refused`
    )
  }
  const noIdDescribe = await h.post('/api/v1/orgs/setDescription', {
    description: 'Described'
  })
  assert.strictEqual(noIdDescribe.status, 400)

  const org = await h.schemas.findOrganization('alice-org')
  assert.strictEqual(org.name, 'alice-org')
  assert.strictEqual(org.description, null)
})
