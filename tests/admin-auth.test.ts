import assert from 'node:assert/strict'
import { test } from 'node:test'

const session = require('../lib/admin/session') as typeof import('../lib/admin/session')
const adminAuth = require('../lib/admin/auth') as typeof import('../lib/admin/auth')
const syncAuth = require('../lib/sync/auth') as typeof import('../lib/sync/auth')
const config = require('../lib/sync/config') as typeof import('../lib/sync/config')

const PASSWORD = process.env.SYNC_ADMIN_PASSWORD
assert.ok(PASSWORD, 'SYNC_ADMIN_PASSWORD must be provided by the test runner')
const EIGHT_HOURS = 8 * 60 * 60 * 1_000

interface RequestOptions {
  ip?: string
  headers?: Record<string, string>
  body?: unknown
}

function mutation(url: string, options: RequestOptions = {}): Request {
  const headers: Record<string, string> = {
    origin: 'http://localhost',
    'x-forwarded-for': options.ip ?? '198.51.100.1',
    ...options.headers,
  }
  if (options.body !== undefined) headers['content-type'] = 'application/json'
  return new Request(url, {
    method: 'POST',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  })
}

function cookieFor(token: string): string {
  return `${session.ADMIN_COOKIE}=${encodeURIComponent(token)}`
}

async function codeOf(response: Response): Promise<string> {
  const body = (await response.json()) as { code?: unknown }
  return typeof body.code === 'string' ? body.code : ''
}

test('password verification is exact and uses constant-time comparison', () => {
  assert.equal(session.verifyAdminPassword(PASSWORD), true)
  assert.equal(session.verifyAdminPassword('wrong-password'), false)
  assert.equal(session.verifyAdminPassword(undefined), false)
  assert.equal(session.safeTextEqual('abc', 'abc'), true)
  assert.equal(session.safeTextEqual('abc', 'abd'), false)
  assert.equal(session.safeTextEqual('short', 'a-much-longer-value'), false)
})

test('session tokens verify, expire after eight hours, and reject tampering', () => {
  const now = new Date('2026-01-01T00:00:00.000Z')
  const { token, expiresAt } = session.createAdminSession(now)

  assert.equal(expiresAt, new Date(now.getTime() + EIGHT_HOURS).toISOString())
  assert.equal(session.verifyAdminSession(token, now), true)
  assert.equal(session.verifyAdminSession(token, new Date(now.getTime() - 1_000)), true)
  assert.equal(session.verifyAdminSession(token, new Date(now.getTime() + EIGHT_HOURS)), false)
  assert.equal(session.verifyAdminSession(token, new Date(now.getTime() + EIGHT_HOURS + 1_000)), false)

  const tampered = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`
  assert.equal(session.verifyAdminSession(tampered, now), false)
  assert.equal(session.verifyAdminSession(`${token}.extra`, now), false)
  assert.equal(session.verifyAdminSession(null, now), false)
})

test('mutation origin validation blocks cross-origin and cross-site requests', () => {
  const url = 'http://localhost/api/admin/login'
  assert.equal(session.verifyMutationOrigin(mutation(url)), true)

  assert.equal(
    session.verifyMutationOrigin(new Request(url, { method: 'POST', headers: { origin: 'https://evil.example' } })),
    false,
  )
  assert.equal(session.verifyMutationOrigin(new Request(url, { method: 'POST' })), false)
  assert.equal(
    session.verifyMutationOrigin(
      new Request(url, {
        method: 'POST',
        headers: { origin: 'http://localhost', 'sec-fetch-site': 'cross-site' },
      }),
    ),
    false,
  )
  assert.equal(
    session.verifyMutationOrigin(
      new Request('http://localhost/api/admin/session', { headers: { origin: 'https://evil.example' } }),
    ),
    true,
  )
})

test('session cookie is read and decoded from the Cookie header', () => {
  const { token } = session.createAdminSession()
  const request = new Request('http://localhost/api/admin/session', {
    headers: { cookie: `theme=dark; ${cookieFor(token)}` },
  })
  assert.equal(session.readSessionCookie(request), token)
  assert.equal(session.readSessionCookie(new Request('http://localhost/api/admin/session')), null)
})

test('refresh authorization requires a valid session and a same-origin request', () => {
  const url = 'http://localhost/api/refresh/schedule'

  const denied = syncAuth.authorize(mutation(url, { ip: '198.51.100.20' }))
  assert.equal(denied.ok, false)
  if (!denied.ok) {
    assert.equal(denied.status, 401)
    assert.equal(denied.code, 'unauthorized')
    assert.equal(denied.authRequired, true)
  }

  const { token } = session.createAdminSession()
  const allowed = mutation(url, {
    ip: '198.51.100.21',
    headers: { cookie: cookieFor(token) },
  })
  assert.deepEqual(syncAuth.authorize(allowed), { ok: true })

  const crossOrigin = mutation(url, {
    ip: '198.51.100.22',
    headers: { cookie: cookieFor(token), origin: 'https://evil.example' },
  })
  const blocked = syncAuth.authorize(crossOrigin)
  assert.equal(blocked.ok, false)
  if (!blocked.ok) {
    assert.equal(blocked.status, 403)
    assert.equal(blocked.code, 'forbidden')
    assert.equal(blocked.authRequired, false)
  }
})

test('preview and confirm endpoints reject unauthenticated requests before doing work', async () => {
  const routeHandler = require('../lib/sync/route-handler') as typeof import('../lib/sync/route-handler')

  const preview = await routeHandler.handlePreview(
    mutation('http://localhost/api/refresh/schedule', { ip: '198.51.100.30' }),
    'schedule',
  )
  assert.equal(preview.status, 401)
  assert.equal(await codeOf(preview), 'unauthorized')

  const confirm = await routeHandler.handleConfirm(
    mutation('http://localhost/api/refresh/confirm', {
      ip: '198.51.100.31',
      body: { token: 'invalid-token' },
    }),
  )
  assert.equal(confirm.status, 401)
  assert.equal(await codeOf(confirm), 'unauthorized')
})

test('login rejects a wrong password and sets a signed cookie for the correct one', async () => {
  const wrong = await adminAuth.adminLogin(
    mutation('http://localhost/api/admin/login', {
      ip: '198.51.100.40',
      body: { password: 'definitely-wrong' },
    }),
  )
  assert.equal(wrong.status, 401)
  assert.equal(await codeOf(wrong), 'invalid_password')
  assert.equal(wrong.headers.get('set-cookie'), null)

  const correct = await adminAuth.adminLogin(
    mutation('http://localhost/api/admin/login', {
      ip: '198.51.100.41',
      body: { password: PASSWORD },
    }),
  )
  assert.equal(correct.status, 200)
  const cookie = correct.headers.get('set-cookie') ?? ''
  assert.match(cookie, /^persib-admin-session=/)
  assert.match(cookie, /Max-Age=28800/)
  assert.match(cookie, /Path=\//)
  assert.match(cookie, /HttpOnly/)
  assert.match(cookie, /SameSite=Strict/)
  assert.doesNotMatch(cookie, /Secure/)

  const token = decodeURIComponent(cookie.split(';')[0].slice('persib-admin-session='.length))
  assert.equal(session.verifyAdminSession(token), true)
})

test('login also rejects a cross-origin request', async () => {
  const response = await adminAuth.adminLogin(
    mutation('http://localhost/api/admin/login', {
      ip: '198.51.100.42',
      headers: { origin: 'https://evil.example' },
      body: { password: PASSWORD },
    }),
  )
  assert.equal(response.status, 403)
  assert.equal(await codeOf(response), 'forbidden')
  assert.equal(response.headers.get('set-cookie'), null)
})

test('login is rate limited per client', async () => {
  const ip = '198.51.100.99'
  const url = 'http://localhost/api/admin/login'
  const limit = config.RATE_LIMITS.login.limit

  for (let attempt = 0; attempt < limit; attempt++) {
    const response = await adminAuth.adminLogin(
      mutation(url, { ip, body: { password: 'wrong' } }),
    )
    assert.equal(response.status, 401)
  }

  const blocked = await adminAuth.adminLogin(
    mutation(url, { ip, body: { password: PASSWORD } }),
  )
  assert.equal(blocked.status, 429)
  assert.equal(await codeOf(blocked), 'rate_limited')
})

test('logout clears the session cookie', () => {
  const response = adminAuth.adminLogout(mutation('http://localhost/api/admin/logout'))
  assert.equal(response.status, 200)
  const cookie = response.headers.get('set-cookie') ?? ''
  assert.match(cookie, /^persib-admin-session=;/)
  assert.match(cookie, /Max-Age=0/)
  assert.match(cookie, /HttpOnly/)
  assert.match(cookie, /SameSite=Strict/)
})

test('session status reports authentication without exposing the token', async () => {
  const anonymous = adminAuth.adminSessionStatus(new Request('http://localhost/api/admin/session'))
  assert.deepEqual(await anonymous.json(), { ok: true, authenticated: false })

  const { token } = session.createAdminSession()
  const signed = adminAuth.adminSessionStatus(
    new Request('http://localhost/api/admin/session', { headers: { cookie: cookieFor(token) } }),
  )
  assert.deepEqual(await signed.json(), { ok: true, authenticated: true })
})

test('session cookie is Secure in production', () => {
  const env = process.env as Record<string, string | undefined>
  const original = env.NODE_ENV
  try {
    env.NODE_ENV = 'production'
    const cookie = session.serializeSessionCookie('token')
    assert.match(cookie, /Secure/)
    assert.match(cookie, /HttpOnly/)
    assert.match(cookie, /SameSite=Strict/)
  } finally {
    env.NODE_ENV = original ?? 'test'
  }
})
