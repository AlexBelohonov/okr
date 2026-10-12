import { validateEnvironment } from './environment.js';
import { accountConfig } from '../accounts/security.js';
try {
  validateEnvironment(); accountConfig();
  console.log(JSON.stringify({ event: 'configuration_valid', mode: process.env.NODE_ENV || 'development' }));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Invalid environment'); process.exitCode = 1;
}
