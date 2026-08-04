export const PASSPORT_API_VERSION: 'v1'

export type Product = string

export type PassportClientOptions = {
  baseUrl?: string
  product: Product
  secret?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

export type LinkIdentityInput = {
  email: string
  productUid: string
  metadata?: Record<string, unknown>
}

export type LookupUserInput = {
  email: string
}

export type CreateHandoffInput = {
  toProduct: Product
  email: string
  payload: Record<string, unknown>
  ttlMinutes?: number
}

export type RedeemHandoffInput = {
  token: string
}

export type GetEntitlementsInput = {
  email?: string
  userId?: string
}

export type CheckAccessInput = {
  email?: string
  userId?: string
  product: Product
  featureKey?: string
}

export type GetBillingInput = {
  email?: string
  userId?: string
}

export type GetBillingCatalogInput = {
  product?: Product
}

export type CreateCheckoutLinkInput = {
  product?: Product
  planId: string
  successUrl?: string
  cancelUrl?: string
  email?: string
  customerEmail?: string
  userId?: string
  clientReferenceId?: string
  quantity?: number
  metadata?: Record<string, unknown>
}

export type GetBillingPortalLinkInput = {
  product?: Product
  returnUrl?: string
  customer?: string
  email?: string
  userId?: string
}

export type PassportAuthUser = {
  id: string
  email: string
  emailVerified: boolean
  name?: string | null
  status?: string
}

export type HeadlessAuthRegisterInput = {
  email: string
  password: string
  name?: string | null
  appBaseUrl?: string
}

export type HeadlessAuthLoginInput = {
  email: string
  password: string
}

export type HeadlessAuthVerifyEmailInput = {
  token: string
}

export type HeadlessAuthResendVerificationInput = {
  email: string
  appBaseUrl?: string
}

export type HeadlessAuthForgotPasswordInput = {
  email: string
  appBaseUrl?: string
}

export type HeadlessAuthResetPasswordInput = {
  token: string
  password: string
}

export type HeadlessAuthChangePasswordInput = {
  email: string
  currentPassword: string
  newPassword: string
}

export type HeadlessAuthSyncLegacyUserInput = {
  email: string
  password: string
  name?: string | null
  emailVerified?: boolean
}

export type PassportSessionUser = {
  id: string
  email?: string | null
  name?: string | null
  raw?: unknown
}

export type PassportConsumptionLayerOptions = {
  passportClient: ReturnType<typeof createPassportClient>
  getCurrentUser?: () => Promise<unknown> | unknown
  getLoginUrl?: (input?: { returnTo?: string; reason?: string }) => string
}

export type RequirePassportUserInput = {
  returnTo?: string
}

export type CheckPassportAccessWithSessionInput = CheckAccessInput & {
  requireUser?: boolean
  returnTo?: string
}

export type GetPassportBillingSnapshotWithSessionInput = GetBillingInput & {
  requireUser?: boolean
  returnTo?: string
}

export type HostedAuthMode = 'login' | 'register' | 'forgot'

export type BuildPassportHostedAuthUrlOptions = {
  baseUrl?: string
  mode?: HostedAuthMode
  returnTo?: string
  lang?: string
}

export class PassportClientError extends Error {
  constructor(message: string, options?: { code?: string; status?: number; details?: unknown; meta?: unknown })
  code: string
  status: number
  details: unknown
  meta: unknown
}

export function buildPassportHostedAuthUrl(options?: BuildPassportHostedAuthUrlOptions): string
export function createPassportConsumptionLayer(options: PassportConsumptionLayerOptions): {
  getCurrentPassportUser(): Promise<PassportSessionUser | null>
  requirePassportUser(input?: RequirePassportUserInput): Promise<PassportSessionUser>
  checkPassportAccess(input?: CheckPassportAccessWithSessionInput): Promise<Record<string, unknown>>
  getPassportBillingSnapshot(input?: GetPassportBillingSnapshotWithSessionInput): Promise<Record<string, unknown>>
}

export function createPassportClient(options: PassportClientOptions): {
  baseUrl: string
  product: Product
  apiVersion: 'v1'
  linkIdentity(input: LinkIdentityInput): Promise<Record<string, unknown>>
  lookupUser(input: LookupUserInput): Promise<Record<string, unknown>>
  createHandoff(input: CreateHandoffInput): Promise<Record<string, unknown>>
  redeemHandoff(input: RedeemHandoffInput): Promise<Record<string, unknown>>
  getEntitlements(input: GetEntitlementsInput): Promise<Record<string, unknown>>
  checkAccess(input: CheckAccessInput): Promise<Record<string, unknown>>
  getBilling(input: GetBillingInput): Promise<Record<string, unknown>>
  getBillingCatalog(input?: GetBillingCatalogInput): Promise<Record<string, unknown>>
  createCheckoutLink(input: CreateCheckoutLinkInput): Promise<Record<string, unknown>>
  getBillingPortalLink(input?: GetBillingPortalLinkInput): Promise<Record<string, unknown>>
  registerWithPassword(input: HeadlessAuthRegisterInput): Promise<Record<string, unknown>>
  loginWithPassword(input: HeadlessAuthLoginInput): Promise<Record<string, unknown>>
  verifyEmailToken(input: HeadlessAuthVerifyEmailInput): Promise<Record<string, unknown>>
  resendVerification(input: HeadlessAuthResendVerificationInput): Promise<Record<string, unknown>>
  forgotPassword(input: HeadlessAuthForgotPasswordInput): Promise<Record<string, unknown>>
  resetPassword(input: HeadlessAuthResetPasswordInput): Promise<Record<string, unknown>>
  changePassword(input: HeadlessAuthChangePasswordInput): Promise<Record<string, unknown>>
  syncLegacyUser(input: HeadlessAuthSyncLegacyUserInput): Promise<Record<string, unknown>>
}
