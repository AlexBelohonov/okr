import { ApiError } from '../errors.js';
import type { AccountConfig } from './security.js';

export function requireVerifiedEmail(user: { verified: boolean }, config: AccountConfig) {
  if (config.emailMode === 'smtp' && !user.verified) throw new ApiError(403, 'EMAIL_UNVERIFIED', 'Verify your email before changing organization content');
}
