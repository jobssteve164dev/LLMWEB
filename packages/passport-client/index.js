export const PASSPORT_API_VERSION = 'v1'

function normalizeSessionUser(user) {
  if (!user || typeof user !== 'object' || Array.isArray(user)) {
    return null
  }

  const record = user
  const idCandidates = [record.id, record.userId, record.sub]
  const id = idCandidates.find((value) => typeof value === 'string' && value.trim())
  if (!id) {
    return null
  }

  const email = typeof record.email === 'string' && record.email.trim() ? record.email.trim() : null
  const name = typeof record.name === 'string' && record.name.trim() ? record.name.trim() : null
  return {
    id: id.trim(),
    email,
    name,
    raw: user,
  }
}
function normalizeBaseUrl(baseUrl) {
  const fallback = 'https://passport.szlk.ai'
  const raw = typeof baseUrl === 'string' && baseUrl.trim() ? baseUrl.trim() : fallback
  const normalized = raw.replace(/\/+$/, '')
  return normalized
    .replace(/\/api\/v1\/passport$/, '')
    .replace(/\/api\/passport$/, '')
    .replace(/\/api$/, '')
}

export class PassportClientError extends Error {
  constructor(message, options = {}) {
    super(message)
    this.name = 'PassportClientError'
    this.code = options.code || 'passport_client_error'
    this.status = options.status || 500
    this.details = options.details ?? null
    this.meta = options.meta ?? null
  }
}

function withTimeout(fetchImpl, timeoutMs) {
  return async (url, init) => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      return await fetchImpl(url, { ...init, signal: controller.signal })
    } finally {
      clearTimeout(timeout)
    }
  }
}

function buildQuery(params = {}) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      query.set(key, String(value))
    }
  }
  const serialized = query.toString()
  return serialized ? `?${serialized}` : ''
}

async function parseJsonSafe(response) {
  const text = await response.text()
  if (!text) {
    return null
  }

  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export function buildPassportHostedAuthUrl(options = {}) {
  const baseUrl = normalizeBaseUrl(options?.baseUrl)
  const url = new URL('/passport-auth', baseUrl)
  const mode = typeof options?.mode === 'string' ? options.mode.trim().toLowerCase() : 'login'
  if (mode === 'login' || mode === 'register' || mode === 'forgot') {
    url.searchParams.set('mode', mode)
  }
  if (typeof options?.returnTo === 'string' && options.returnTo.trim()) {
    url.searchParams.set('return_to', options.returnTo.trim())
  }
  if (typeof options?.lang === 'string' && options.lang.trim()) {
    url.searchParams.set('lang', options.lang.trim())
  }
  return url.toString()
}

function buildUnauthorizedError(options) {
  return new PassportClientError(options?.message || 'Passport user is required', {
    code: options?.code || 'passport_user_required',
    status: 401,
    details: options?.details || null,
    meta: options?.meta || null,
  })
}

export function createPassportConsumptionLayer(options = {}) {
  const passportClient = options?.passportClient
  if (!passportClient || typeof passportClient !== 'object') {
    throw new PassportClientError('Passport consumption layer requires passportClient', {
      code: 'passport_consumption_client_required',
      status: 500,
    })
  }

  const getCurrentUserImpl = typeof options?.getCurrentUser === 'function'
    ? options.getCurrentUser
    : async () => null
  const getLoginUrlImpl = typeof options?.getLoginUrl === 'function'
    ? options.getLoginUrl
    : ({ returnTo } = {}) => buildPassportHostedAuthUrl({
      baseUrl: passportClient.baseUrl,
      mode: 'login',
      returnTo,
    })

  async function getCurrentPassportUser() {
    const user = await getCurrentUserImpl()
    return normalizeSessionUser(user)
  }

  async function requirePassportUser(input = {}) {
    const currentUser = await getCurrentPassportUser()
    if (currentUser) {
      return currentUser
    }

    const loginUrl = getLoginUrlImpl({
      returnTo: input.returnTo,
      reason: 'unauthorized',
    })

    throw buildUnauthorizedError({
      message: 'Passport user is required before accessing this resource',
      code: 'passport_user_required',
      details: {
        reason: 'unauthorized',
      },
      meta: {
        loginUrl,
      },
    })
  }

  async function resolveIdentitySelector(input = {}) {
    if (typeof input.userId === 'string' && input.userId.trim()) {
      return {
        currentUser: null,
        userId: input.userId.trim(),
        email: typeof input.email === 'string' && input.email.trim() ? input.email.trim() : undefined,
      }
    }

    if (typeof input.email === 'string' && input.email.trim()) {
      return {
        currentUser: null,
        userId: undefined,
        email: input.email.trim(),
      }
    }

    const currentUser = await getCurrentPassportUser()
    if (currentUser) {
      return {
        currentUser,
        userId: currentUser.id,
        email: currentUser.email || undefined,
      }
    }

    return {
      currentUser: null,
      userId: undefined,
      email: undefined,
    }
  }

  async function checkPassportAccess(input = {}) {
    const selector = await resolveIdentitySelector(input)
    const loginUrl = selector.currentUser || selector.userId || selector.email
      ? null
      : getLoginUrlImpl({
        returnTo: input.returnTo,
        reason: 'unauthorized',
      })

    if (!selector.userId && !selector.email) {
      if (input.requireUser === false) {
        return {
          allowed: false,
          reason: 'unauthorized',
          loginRequired: true,
          loginUrl,
          currentUser: null,
          product: input.product || passportClient.product,
          featureKey: input.featureKey || null,
          access: null,
        }
      }

      throw buildUnauthorizedError({
        message: 'Passport user is required before checking access',
        code: 'passport_access_user_required',
        details: {
          reason: 'unauthorized',
          product: input.product || passportClient.product,
          featureKey: input.featureKey || null,
        },
        meta: {
          loginUrl,
        },
      })
    }

    const access = await passportClient.checkAccess({
      userId: selector.userId,
      email: selector.email,
      product: input.product || passportClient.product,
      featureKey: input.featureKey,
    })

    return {
      allowed: Boolean(access.allowed),
      reason: access.reason || null,
      loginRequired: false,
      loginUrl: null,
      currentUser: selector.currentUser,
      product: access.product || input.product || passportClient.product,
      featureKey: access.featureKey || input.featureKey || null,
      access,
    }
  }

  async function getPassportBillingSnapshot(input = {}) {
    const selector = await resolveIdentitySelector(input)
    const loginUrl = selector.currentUser || selector.userId || selector.email
      ? null
      : getLoginUrlImpl({
        returnTo: input.returnTo,
        reason: 'unauthorized',
      })

    if (!selector.userId && !selector.email) {
      if (input.requireUser === false) {
        return {
          loginRequired: true,
          loginUrl,
          currentUser: null,
          billing: null,
        }
      }

      throw buildUnauthorizedError({
        message: 'Passport user is required before reading billing snapshot',
        code: 'passport_billing_user_required',
        details: {
          reason: 'unauthorized',
        },
        meta: {
          loginUrl,
        },
      })
    }

    const billing = await passportClient.getBilling({
      userId: selector.userId,
      email: selector.email,
    })

    return {
      loginRequired: false,
      loginUrl: null,
      currentUser: selector.currentUser,
      billing,
    }
  }

  return {
    getCurrentPassportUser,
    requirePassportUser,
    checkPassportAccess,
    getPassportBillingSnapshot,
  }
}

export function createPassportClient(options) {
  const baseUrl = normalizeBaseUrl(options?.baseUrl)
  const product = options?.product
  const secret = options?.secret
  const timeoutMs = Number.isFinite(options?.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 15000
  const fetchImpl = withTimeout(options?.fetchImpl || fetch, timeoutMs)

  if (!product) {
    throw new PassportClientError('Passport client requires product', {
      code: 'passport_client_product_required',
      status: 500,
    })
  }

  async function request(path, input = {}) {
    const url = `${baseUrl}/api/${PASSPORT_API_VERSION}/${path}${buildQuery(input.query)}`
    const headers = {
      'Content-Type': 'application/json',
      'X-SZLK-Product': product,
      ...(secret ? { 'X-SZLK-Secret': secret } : {}),
      ...(input.headers || {}),
    }

    const response = await fetchImpl(url, {
      method: input.method || 'GET',
      headers,
      body: input.body ? JSON.stringify(input.body) : undefined,
    }).catch((error) => {
      throw new PassportClientError('Passport request failed', {
        code: 'passport_request_failed',
        status: 503,
        details: error instanceof Error ? error.message : String(error),
      })
    })

    const payload = await parseJsonSafe(response)
    if (!response.ok) {
      if (payload && typeof payload === 'object' && payload.error) {
        throw new PassportClientError(payload.error.message || 'Passport request failed', {
          code: payload.error.code || 'passport_request_failed',
          status: response.status,
          details: payload.error.details ?? null,
          meta: payload.meta ?? null,
        })
      }

      throw new PassportClientError(typeof payload === 'string' ? payload : 'Passport request failed', {
        code: 'passport_request_failed',
        status: response.status,
        details: payload,
      })
    }

    if (!payload || typeof payload !== 'object' || payload.ok !== true) {
      throw new PassportClientError('Passport response is not a valid v1 envelope', {
        code: 'passport_invalid_response',
        status: response.status,
        details: payload,
      })
    }

    return payload.data
  }

  return {
    baseUrl,
    product,
    apiVersion: PASSPORT_API_VERSION,
    async linkIdentity(input) {
      return await request('passport/link', {
        method: 'POST',
        body: {
          email: input.email,
          product,
          productUid: input.productUid,
          metadata: input.metadata || undefined,
        },
      })
    },
    async lookupUser(input) {
      return await request('passport/lookup', {
        query: { email: input.email },
      })
    },
    async createHandoff(input) {
      return await request('passport/handoff', {
        method: 'POST',
        body: {
          fromProduct: product,
          toProduct: input.toProduct,
          email: input.email,
          payload: input.payload,
          ttlMinutes: input.ttlMinutes,
        },
      })
    },
    async redeemHandoff(input) {
      return await request('passport/handoff/redeem', {
        method: 'POST',
        body: {
          token: input.token,
        },
      })
    },
    async getEntitlements(input) {
      return await request('entitlements/user', {
        query: {
          email: input.email,
          userId: input.userId,
        },
      })
    },
    async checkAccess(input) {
      return await request('entitlements/access-check', {
        method: 'POST',
        body: {
          email: input.email,
          userId: input.userId,
          product: input.product,
          featureKey: input.featureKey,
        },
      })
    },
    async getBilling(input) {
      return await request('billing/user', {
        query: {
          email: input.email,
          userId: input.userId,
        },
      })
    },
    async getBillingCatalog(input = {}) {
      return await request('billing/catalog', {
        query: {
          product: input.product,
        },
      })
    },
    async createCheckoutLink(input) {
      return await request('billing/checkout-link', {
        method: 'POST',
        body: {
          product: input.product,
          planId: input.planId,
          successUrl: input.successUrl,
          cancelUrl: input.cancelUrl,
          email: input.email,
          customerEmail: input.customerEmail,
          userId: input.userId,
          clientReferenceId: input.clientReferenceId,
          quantity: input.quantity,
          metadata: input.metadata,
        },
      })
    },
    async getBillingPortalLink(input = {}) {
      return await request('billing/portal-link', {
        query: {
          product: input.product,
          returnUrl: input.returnUrl,
          customer: input.customer,
          email: input.email,
          userId: input.userId,
        },
      })
    },
    async registerWithPassword(input) {
      return await request('auth/register', {
        method: 'POST',
        body: {
          email: input.email,
          password: input.password,
          name: input.name,
          appBaseUrl: input.appBaseUrl,
        },
      })
    },
    async loginWithPassword(input) {
      return await request('auth/login', {
        method: 'POST',
        body: {
          email: input.email,
          password: input.password,
        },
      })
    },
    async verifyEmailToken(input) {
      return await request('auth/verify-email', {
        method: 'POST',
        body: {
          token: input.token,
        },
      })
    },
    async resendVerification(input) {
      return await request('auth/resend-verification', {
        method: 'POST',
        body: {
          email: input.email,
          appBaseUrl: input.appBaseUrl,
        },
      })
    },
    async forgotPassword(input) {
      return await request('auth/forgot-password', {
        method: 'POST',
        body: {
          email: input.email,
          appBaseUrl: input.appBaseUrl,
        },
      })
    },
    async resetPassword(input) {
      return await request('auth/reset-password', {
        method: 'POST',
        body: {
          token: input.token,
          password: input.password,
        },
      })
    },
    async changePassword(input) {
      return await request('auth/change-password', {
        method: 'POST',
        body: {
          email: input.email,
          currentPassword: input.currentPassword,
          newPassword: input.newPassword,
        },
      })
    },
    async syncLegacyUser(input) {
      return await request('auth/sync-legacy-user', {
        method: 'POST',
        body: {
          email: input.email,
          password: input.password,
          name: input.name,
          emailVerified: input.emailVerified,
        },
      })
    },
  }
}
