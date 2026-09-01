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

  // The clear-text token is shown once and never stored; the hash is the row
  // id, and it is what the UI passes back to setDescription and delete.
  const [bobRow] = await h.schemas.listTokens(bob.project)
  assert.ok(bobRow, "bob's token row exists")

  return { alice, bob, bobHash: bobRow.hash, bobClearText: bobToken.body.token }
}

test('a token cannot be deleted from another organization', async (t) => {
  const h = await harness.start()
  t.after(() => h.stop())
  const { alice, bob, bobHash } = await twoTenants(h)

  // Alice is authenticated, is a real member of her own organization, and
  // supplies her own orgId and projectId - every check the handler performs
  // passes. The only thing that should stop her is the token not being hers.
  h.becomeUser(alice.user)
  const res = await h.post('/api/v1/tokens/delete', {
    orgId: 'alice-org',
    projectId: 'alice-project',
    token: bobHash
  })

  assert.strictEqual(
    res.status,
    404,
    'deleting another org\'s token by hash must not succeed'
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
  const { alice, bob, bobHash } = await twoTenants(h)

  h.becomeUser(alice.user)
  const res = await h.post('/api/v1/tokens/setDescription', {
    orgId: 'alice-org',
    projectId: 'alice-project',
    token: bobHash,
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
  const { bob, bobHash } = await twoTenants(h)

  h.becomeUser(bob.user)

  const described = await h.post('/api/v1/tokens/setDescription', {
    orgId: 'bob-org',
    projectId: 'bob-project',
    token: bobHash,
    description: 'renamed by its owner'
  })
  assert.strictEqual(described.status, 200, 'owner can re-describe')
  const [afterDescribe] = await h.schemas.listTokens(bob.project)
  assert.strictEqual(afterDescribe.description, 'renamed by its owner')

  const deleted = await h.post('/api/v1/tokens/delete', {
    orgId: 'bob-org',
    projectId: 'bob-project',
    token: bobHash
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
