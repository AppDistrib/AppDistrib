'use strict'

const test = require('node:test')
const assert = require('node:assert')

const harness = require('./helpers/harness.js')

// Two organizations, each owned by a different user, each with one project and
// one token. Nothing in either org should be reachable from the other.
async function twoTenants (h) {
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
  const aliceToken = await h.post('/api/v1/tokens/create', {
    orgId: 'alice-org',
    projectId: 'alice-project',
    description: "alice's token"
  })
  h.becomeUser(bob.user)
  const bobToken = await h.post('/api/v1/tokens/create', {
    orgId: 'bob-org',
    projectId: 'bob-project',
    description: "bob's token"
  })

  assert.strictEqual(aliceToken.status, 200, 'alice could mint a token')
  assert.strictEqual(bobToken.status, 200, 'bob could mint a token')

  // The clear-text token is shown once and never stored. The UI passes the
  // row's derived id back to setDescription and delete.
  const [bobRow] = await h.schemas.listTokens(bob.project)
  assert.ok(bobRow, "bob's token row exists")

  return { alice, bob, bobId: h.schemas.tokenId(bobRow), bobClearText: bobToken.body.token }
}

test('a token cannot be deleted from another organization', async (t) => {
  const h = await harness.start()
  t.after(() => h.stop())
  const { alice, bob, bobId } = await twoTenants(h)

  // Alice is authenticated, is a real member of her own organization, and
  // supplies her own orgId and projectId - every check the handler performs
  // passes. The only thing that should stop her is the token not being hers.
  h.becomeUser(alice.user)
  const res = await h.post('/api/v1/tokens/delete', {
    orgId: 'alice-org',
    projectId: 'alice-project',
    token: bobId
  })

  assert.strictEqual(
    res.status,
    404,
    'deleting another org\'s token by id must not succeed'
  )

  const remaining = await h.schemas.listTokens(bob.project)
  assert.strictEqual(
    remaining.length,
    1,
    "bob's token must still exist after alice's attempt"
  )
})

test('a token cannot be re-described from another organization', async (t) => {
  const h = await harness.start()
  t.after(() => h.stop())
  const { alice, bob, bobId } = await twoTenants(h)

  h.becomeUser(alice.user)
  const res = await h.post('/api/v1/tokens/setDescription', {
    orgId: 'alice-org',
    projectId: 'alice-project',
    token: bobId,
    description: 'pwned'
  })

  assert.strictEqual(res.status, 404)

  const [bobRow] = await h.schemas.listTokens(bob.project)
  assert.strictEqual(
    bobRow.description,
    "bob's token",
    "bob's description must be untouched"
  )
})

// Negative control for the two tests above: the same operations MUST work for
// the token's real owner. Without this, scoping findToken to nothing at all
// would pass both tests.
test('the owning organization can still delete and re-describe its token', async (t) => {
  const h = await harness.start()
  t.after(() => h.stop())
  const { bob, bobId } = await twoTenants(h)

  h.becomeUser(bob.user)

  const described = await h.post('/api/v1/tokens/setDescription', {
    orgId: 'bob-org',
    projectId: 'bob-project',
    token: bobId,
    description: 'renamed by its owner'
  })
  assert.strictEqual(described.status, 200, 'owner can re-describe')
  const [afterDescribe] = await h.schemas.listTokens(bob.project)
  assert.strictEqual(afterDescribe.description, 'renamed by its owner')

  const deleted = await h.post('/api/v1/tokens/delete', {
    orgId: 'bob-org',
    projectId: 'bob-project',
    token: bobId
  })
  assert.strictEqual(deleted.status, 200, 'owner can delete')
  assert.strictEqual((await h.schemas.listTokens(bob.project)).length, 0)
})

test('a minted token validates for its own project and no other', async (t) => {
  const h = await harness.start()
  t.after(() => h.stop())
  const { alice, bob, bobClearText } = await twoTenants(h)

  const secretKey = h.config.secretKey

  assert.strictEqual(
    await h.schemas.validateProjectFromToken({
      secretKey,
      token: bobClearText,
      project: bob.project
    }),
    true,
    "bob's token validates for bob's project"
  )
  assert.strictEqual(
    await h.schemas.validateProjectFromToken({
      secretKey,
      token: bobClearText,
      project: alice.project
    }),
    false,
    "bob's token must not validate for alice's project"
  )
  // Each of these is a different way to be malformed. The undecodable-base85
  // one used to throw 'Uint8Array expected' out of hmac.update, which the gRPC
  // layer turned into INTERNAL rather than an authentication failure.
  for (const bad of [
    'tk1.not-a-real-token',
    'tk1.zzz',
    'tk1.',
    'not-even-prefixed',
    'tk1.a.b',
    ''
  ]) {
    assert.strictEqual(
      await h.schemas.validateProjectFromToken({
        secretKey,
        token: bad,
        project: bob.project
      }),
      false,
      `malformed token ${JSON.stringify(bad)} must not validate`
    )
  }
})

test('an expired token stops validating', async (t) => {
  const h = await harness.start()
  t.after(() => h.stop())
  const bob = await h.makeOrgWithProject({
    userName: 'bob',
    orgId: 'bob-org',
    projectId: 'bob-project'
  })
  const secretKey = h.config.secretKey

  const live = await h.schemas.createToken({
    secretKey,
    project: bob.project,
    description: 'expires later',
    expiration: new Date(Date.now() + 60 * 60 * 1000)
  })
  const dead = await h.schemas.createToken({
    secretKey,
    project: bob.project,
    description: 'expired an hour ago',
    expiration: new Date(Date.now() - 60 * 60 * 1000)
  })
  const forever = await h.schemas.createToken({
    secretKey,
    project: bob.project,
    description: 'never expires',
    expiration: null
  })

  const check = (token) =>
    h.schemas.validateProjectFromToken({ secretKey, token, project: bob.project })

  assert.strictEqual(await check(live), true, 'a future expiration still works')
  assert.strictEqual(await check(dead), false, 'a past expiration does not')
  // Every token that exists today has a null expiration, so this is the case
  // that must not regress.
  assert.strictEqual(await check(forever), true, 'a null expiration never expires')
})

test('a member can mint a token, and the response is the clear text that validates', async (t) => {
  const h = await harness.start()
  t.after(() => h.stop())
  const alice = await h.makeOrgWithProject({
    userName: 'alice',
    orgId: 'alice-org',
    projectId: 'alice-project'
  })
  h.becomeUser(alice.user)

  const res = await h.post('/api/v1/tokens/create', {
    orgId: 'alice-org',
    projectId: 'alice-project',
    description: 'ci'
  })
  assert.strictEqual(res.status, 200)
  assert.match(res.body.token, /^tk1\.[^.]+$/)
  assert.deepStrictEqual(Object.keys(res.body), ['token'])

  const listed = await h.get(
    '/api/v1/tokens/list?orgId=alice-org&projectId=alice-project'
  )
  assert.strictEqual(listed.status, 200)
  assert.strictEqual(listed.body.length, 1)
  assert.strictEqual(listed.body[0].description, 'ci')
  assert.ok(
    !JSON.stringify(listed.body).includes(res.body.token.slice(4)),
    'the clear text is not stored'
  )
  assert.strictEqual(
    await h.schemas.validateProjectFromToken({
      secretKey: h.config.secretKey,
      token: res.body.token,
      project: alice.project
    }),
    true
  )
})

test('a member of one org cannot mint, list, re-describe or delete another org tokens', async (t) => {
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
  await h.schemas.createToken({
    secretKey: h.config.secretKey,
    project: bob.project,
    description: "bob's token",
    expiration: null
  })
  h.becomeUser(alice.user)

  const minted = await h.post('/api/v1/tokens/create', {
    orgId: 'bob-org',
    projectId: 'bob-project',
    description: 'planted'
  })
  assert.strictEqual(minted.status, 404)
  assert.strictEqual(minted.body.token, undefined)

  const listed = await h.get('/api/v1/tokens/list?orgId=bob-org&projectId=bob-project')
  assert.strictEqual(listed.status, 404)
  assert.ok(!JSON.stringify(listed.body).includes("bob's token"))

  // Unlike the cross-tenant tests above, alice names bob's org and project
  // outright here, so the membership check is the only thing in the way.
  const [bobRow] = await h.schemas.listTokens(bob.project)
  const scope = { orgId: 'bob-org', projectId: 'bob-project', token: h.schemas.tokenId(bobRow) }
  const described = await h.post('/api/v1/tokens/setDescription', {
    ...scope,
    description: 'pwned'
  })
  assert.strictEqual(described.status, 404)
  const deleted = await h.post('/api/v1/tokens/delete', scope)
  assert.strictEqual(deleted.status, 404)

  const rows = await h.schemas.listTokens(bob.project)
  assert.deepStrictEqual(rows.map((r) => r.description), ["bob's token"])
})

test('an unauthenticated caller cannot mint, list, re-describe or delete tokens', async (t) => {
  const h = await harness.start()
  t.after(() => h.stop())
  const alice = await h.makeOrgWithProject({
    userName: 'alice',
    orgId: 'alice-org',
    projectId: 'alice-project'
  })
  await h.schemas.createToken({
    secretKey: h.config.secretKey,
    project: alice.project,
    description: 'original',
    expiration: null
  })
  const [row] = await h.schemas.listTokens(alice.project)
  h.becomeNobody()

  const scope = { orgId: 'alice-org', projectId: 'alice-project' }
  const minted = await h.post('/api/v1/tokens/create', { ...scope, description: 'anon' })
  assert.strictEqual(minted.status, 401)
  const listed = await h.get('/api/v1/tokens/list?orgId=alice-org&projectId=alice-project')
  assert.strictEqual(listed.status, 401)
  const described = await h.post('/api/v1/tokens/setDescription', {
    ...scope,
    token: h.schemas.tokenId(row),
    description: 'anon'
  })
  assert.strictEqual(described.status, 401)
  const deleted = await h.post('/api/v1/tokens/delete', { ...scope, token: h.schemas.tokenId(row) })
  assert.strictEqual(deleted.status, 401)

  const rows = await h.schemas.listTokens(alice.project)
  assert.deepStrictEqual(rows.map((r) => r.description), ['original'])
})

test('token routes reject missing ids, unknown projects and malformed input', async (t) => {
  const h = await harness.start()
  t.after(() => h.stop())
  const alice = await h.makeOrgWithProject({
    userName: 'alice',
    orgId: 'alice-org',
    projectId: 'alice-project'
  })
  await h.schemas.createToken({
    secretKey: h.config.secretKey,
    project: alice.project,
    description: 'original',
    expiration: null
  })
  const [row] = await h.schemas.listTokens(alice.project)
  h.becomeUser(alice.user)

  const routes = {
    create: { description: 'x' },
    setDescription: { token: h.schemas.tokenId(row), description: 'x' },
    delete: { token: h.schemas.tokenId(row) }
  }
  for (const [route, extra] of Object.entries(routes)) {
    const url = `/api/v1/tokens/${route}`
    const noOrg = await h.post(url, { ...extra, projectId: 'alice-project' })
    assert.strictEqual(noOrg.status, 400, `${route} without orgId`)
    const noProject = await h.post(url, { ...extra, orgId: 'alice-org' })
    assert.strictEqual(noProject.status, 400, `${route} without projectId`)
    const unknown = await h.post(url, {
      ...extra,
      orgId: 'alice-org',
      projectId: 'no-such-project'
    })
    assert.strictEqual(unknown.status, 404, `${route} on an unknown project`)
  }
  for (const [query, why] of [
    ['projectId=alice-project', 'without orgId'],
    ['orgId=alice-org', 'without projectId']
  ]) {
    const res = await h.get(`/api/v1/tokens/list?${query}`)
    assert.strictEqual(res.status, 400, `list ${why}`)
  }
  const listUnknown = await h.get('/api/v1/tokens/list?orgId=alice-org&projectId=nope')
  assert.strictEqual(listUnknown.status, 404, 'list on an unknown project')

  for (const description of [undefined, 42, { a: 1 }]) {
    const res = await h.post('/api/v1/tokens/setDescription', {
      orgId: 'alice-org',
      projectId: 'alice-project',
      token: h.schemas.tokenId(row),
      description
    })
    assert.strictEqual(
      res.status,
      400,
      `description ${JSON.stringify(description)} must be refused`
    )
  }
  for (const route of ['setDescription', 'delete']) {
    const res = await h.post(`/api/v1/tokens/${route}`, {
      orgId: 'alice-org',
      projectId: 'alice-project',
      token: 'no-such-hash',
      description: 'x'
    })
    assert.strictEqual(res.status, 404, `${route} of an unknown token`)
  }

  // Nothing above minted, re-described or deleted anything.
  const rows = await h.schemas.listTokens(alice.project)
  assert.deepStrictEqual(rows.map((r) => r.description), ['original'])
})

test('tokens/list does not send the stored hash, and its id is what setDescription and delete take', async (t) => {
  const h = await harness.start()
  t.after(() => h.stop())
  const alice = await h.makeOrgWithProject({
    userName: 'alice',
    orgId: 'alice-org',
    projectId: 'alice-project'
  })
  h.becomeUser(alice.user)
  const scope = { orgId: 'alice-org', projectId: 'alice-project' }
  await h.post('/api/v1/tokens/create', { ...scope, description: 'first' })
  await h.post('/api/v1/tokens/create', { ...scope, description: 'second' })
  const stored = await h.schemas.listTokens(alice.project)
  assert.strictEqual(stored.length, 2)

  const listed = await h.get('/api/v1/tokens/list?orgId=alice-org&projectId=alice-project')
  assert.strictEqual(listed.status, 200)
  assert.strictEqual(listed.body.length, 2)
  const text = JSON.stringify(listed.body)
  for (const row of stored) {
    assert.ok(!text.includes(row.hash), 'a stored hash went over the wire')
  }
  for (const row of listed.body) {
    assert.strictEqual(row.hash, undefined)
    assert.match(row.id, /^[0-9a-f]{32}$/)
  }
  assert.notStrictEqual(listed.body[0].id, listed.body[1].id)

  // The stored hash is no longer a handle for anything.
  const byHash = await h.post('/api/v1/tokens/delete', { ...scope, token: stored[0].hash })
  assert.strictEqual(byHash.status, 404)

  const first = listed.body.find((r) => r.description === 'first')
  const described = await h.post('/api/v1/tokens/setDescription', {
    ...scope,
    token: first.id,
    description: 'renamed'
  })
  assert.strictEqual(described.status, 200)
  const deleted = await h.post('/api/v1/tokens/delete', { ...scope, token: first.id })
  assert.strictEqual(deleted.status, 200)
  const left = await h.schemas.listTokens(alice.project)
  assert.deepStrictEqual(left.map((r) => r.description), ['second'])
})
