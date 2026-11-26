'use strict'

// The provider /login route, mounted by the real auth.js with its real session
// store. A signed-in browser is a session row in Postgres plus the signed
// cookie that names it, so that is what the signed-in case sends.

const test = require('node:test')
const assert = require('node:assert')
const crypto = require('node:crypto')

const harness = require('./helpers/harness.js')

// passport is a module singleton and keeps the first serializers it is given,
// so every test in this file shares one server.
let h
test.before(async () => {
  h = await harness.start()
  h.config.providers.githubAuth = { clientID: 'id', clientSecret: 'secret' }
  await require('../src/back/web/auth.js').setRoutes(h.server)
})
test.after(() => h.stop())

// express-session's cookie format: `s:` + sid + `.` + HMAC-SHA256(sid) in
// base64 without padding.
function sign (sid, secret) {
  const mac = crypto.createHmac('sha256', secret).update(sid).digest('base64')
  return sid + '.' + mac.replace(/=+$/, '')
}

async function signedInCookie (h, user) {
  const sid = crypto.randomBytes(16).toString('hex')
  const sess = {
    cookie: { originalMaxAge: 86400000, httpOnly: true, path: '/' },
    passport: { user: { id: String(user.id) } }
  }
  await h.schemas.db.sequelize.query(
    `INSERT INTO session (sid, sess, expire) VALUES (?, ?::json, now() + interval '1 day')`,
    { replacements: [sid, JSON.stringify(sess)] }
  )
  return 'connect.sid=' + encodeURIComponent('s:' + sign(sid, h.config.webServer.secret))
}

test('a signed-out /login is sent to GitHub', async () => {
  const res = await fetch(h.base + '/api/v1/auth/github/login', { redirect: 'manual' })
  assert.strictEqual(res.status, 302)
  assert.match(res.headers.get('location'), /^https:\/\/github\.com\/login\/oauth\/authorize/)
})

test('a signed-in /login gets one redirect home and nothing after it', async (t) => {
  const { user } = await h.makeOrgWithProject({ userName: 'signed-in', orgId: 'o', projectId: 'p' })
  const errors = []
  t.mock.method(console, 'error', (...args) => errors.push(args.map(String).join(' ')))

  const info = await fetch(h.base + '/api/v1/user/info', { headers: { cookie: await signedInCookie(h, user) } })
  assert.strictEqual(info.status, 200, errors.join('\n').slice(0, 800))
  assert.strictEqual((await info.json()).authenticated, true, 'the session cookie signs in')

  const res = await fetch(h.base + '/api/v1/auth/github/login', {
    redirect: 'manual',
    headers: { cookie: await signedInCookie(h, user) }
  })
  await res.text()
  // Anything the handler tries after responding happens after the response
  // has gone out, so give it a moment to show up in the log.
  await new Promise((resolve) => setTimeout(resolve, 200))

  assert.strictEqual(res.status, 302)
  assert.strictEqual(res.headers.get('location'), '/')
  assert.deepStrictEqual(errors.filter((e) => /HEADERS_SENT/.test(e)), [])
})
