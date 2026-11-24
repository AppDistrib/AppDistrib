'use strict'

// The provider modules register passport strategies whose verify callbacks map
// an IdP profile onto our user shape and hand it to findOrCreateUser. None of
// that needs a real IdP: the strategies are captured from a stand-in passport
// and their verify callbacks called directly with a profile of the shape each
// library produces. Google's discovery round-trip is the one network call, and
// it is replaced with a locally built Issuer.

const test = require('node:test')
const assert = require('node:assert')

const openidClient = require('openid-client')

const harness = require('./helpers/harness.js')
const githubAuth = require('../src/back/auth/providers/github-auth.js')
const googleAuth = require('../src/back/auth/providers/google-auth.js')

const config = {
  webServer: { baseURL: 'http://127.0.0.1' },
  providers: {
    githubAuth: { clientID: 'id', clientSecret: 'secret' },
    googleAuth: { clientID: 'id', clientSecret: 'secret' }
  }
}

function capturingPassport () {
  const strategies = {}
  return {
    strategies,
    use (name, strategy) {
      strategies[name] = strategy
    }
  }
}

// Records what reached the database layer, and answers like findOrCreateUser.
function recordingSchemas ({ fail = false } = {}) {
  const calls = []
  return {
    calls,
    async findOrCreateUser (user) {
      calls.push(user)
      if (fail) throw Error('database is down')
      return { id: 1, from: 'db', user }
    }
  }
}

// Calls a strategy's verify callback and resolves with what it passed to done.
function verify (strategy, ...args) {
  return new Promise((resolve) => {
    strategy._verify(...args, (err, user) => resolve({ err, user }))
  })
}

async function registerGoogle (t, passport, schemas) {
  // No network: discovery returns an Issuer built from static metadata.
  t.mock.method(openidClient.Issuer, 'discover', async (url) => {
    assert.strictEqual(url, 'https://accounts.google.com')
    return new openidClient.Issuer({
      issuer: 'https://accounts.google.com',
      authorization_endpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
      token_endpoint: 'https://oauth2.googleapis.com/token',
      jwks_uri: 'https://www.googleapis.com/oauth2/v3/certs'
    })
  })
  return googleAuth.register(passport, schemas, config)
}

const githubProfile = {
  id: '583231',
  displayName: 'The Octocat',
  username: 'octocat',
  photos: [{ value: 'https://avatars.githubusercontent.com/u/583231' }]
}

const googleUserinfo = {
  sub: '110169484474386276334',
  name: 'Alice Example',
  picture: 'https://lh3.googleusercontent.com/a/photo'
}

test('the GitHub callback maps the profile and finds or creates the user', async () => {
  const passport = capturingPassport()
  const schemas = recordingSchemas()
  const provider = await githubAuth.register(passport, schemas, config)
  assert.deepStrictEqual(Object.keys(passport.strategies).sort(), [
    provider.connect,
    provider.create
  ].sort())

  const { err, user } = await verify(
    passport.strategies[provider.create],
    'access-token',
    'refresh-token',
    githubProfile
  )
  assert.strictEqual(err, null)
  assert.deepStrictEqual(schemas.calls, [
    {
      provider: 'github',
      id: '583231',
      avatarURL: 'https://avatars.githubusercontent.com/u/583231',
      screenName: 'The Octocat'
    }
  ])
  assert.strictEqual(user.from, 'db', 'done gets the database user')
})

test('the GitHub callback falls back to the login when there is no display name', async () => {
  const passport = capturingPassport()
  const schemas = recordingSchemas()
  const provider = await githubAuth.register(passport, schemas, config)

  await verify(passport.strategies[provider.create], 'a', 'r', {
    ...githubProfile,
    displayName: null
  })
  assert.strictEqual(schemas.calls[0].screenName, 'octocat')
})

test('the Google callback maps the OIDC claims and finds or creates the user', async (t) => {
  const passport = capturingPassport()
  const schemas = recordingSchemas()
  const provider = await registerGoogle(t, passport, schemas)

  const { err, user } = await verify(
    passport.strategies[provider.create],
    { access_token: 'x' },
    googleUserinfo
  )
  assert.strictEqual(err, null)
  assert.deepStrictEqual(schemas.calls, [
    {
      provider: 'google',
      id: '110169484474386276334',
      avatarURL: 'https://lh3.googleusercontent.com/a/photo',
      screenName: 'Alice Example'
    }
  ])
  assert.strictEqual(user.from, 'db')
})

test('the connect strategies hand the mapped account back without touching the database', async (t) => {
  for (const [name, register, args] of [
    ['github', (p, s) => githubAuth.register(p, s, config), ['a', 'r', githubProfile]],
    ['google', (p, s) => registerGoogle(t, p, s), [{}, googleUserinfo]]
  ]) {
    const passport = capturingPassport()
    const schemas = recordingSchemas()
    const provider = await register(passport, schemas)
    const { err, user } = await verify(passport.strategies[provider.connect], ...args)
    assert.strictEqual(err, null, name)
    assert.strictEqual(schemas.calls.length, 0, `${name} connect must not hit the db`)
    assert.strictEqual(user.provider, name)
    assert.strictEqual(user.id, args[args.length - 1][name === 'github' ? 'id' : 'sub'])
  }
})

test('a database failure in a provider callback reaches passport as an error', async (t) => {
  for (const [name, register, args] of [
    ['github', (p, s) => githubAuth.register(p, s, config), ['a', 'r', githubProfile]],
    ['google', (p, s) => registerGoogle(t, p, s), [{}, googleUserinfo]]
  ]) {
    const passport = capturingPassport()
    const provider = await register(passport, recordingSchemas({ fail: true }))
    const { err, user } = await verify(passport.strategies[provider.create], ...args)
    assert.ok(err instanceof Error, `${name} must report the error`)
    assert.match(err.message, /database is down/)
    assert.strictEqual(user, false, `${name} must not log anyone in`)
  }
})

// The same callback against the real Schemas: signing in twice through it is
// one user, not two, and a second provider identity is a second user.
test('signing in twice through the GitHub callback yields one user', async (t) => {
  const h = await harness.start()
  t.after(() => h.stop())
  const passport = capturingPassport()
  const provider = await githubAuth.register(passport, h.schemas, config)
  const strategy = passport.strategies[provider.create]

  const first = await verify(strategy, 'a', 'r', githubProfile)
  const second = await verify(strategy, 'a', 'r', githubProfile)
  assert.strictEqual(first.err, null)
  assert.strictEqual(second.err, null)
  assert.strictEqual(String(first.user.id), String(second.user.id))

  const other = await verify(strategy, 'a', 'r', { ...githubProfile, id: '1' })
  assert.notStrictEqual(String(other.user.id), String(first.user.id))
})
