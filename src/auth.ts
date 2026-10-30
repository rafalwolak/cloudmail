import type { OutboundEmail } from './email';
import { betterAuth } from 'better-auth';

export interface AuthEnv {
  DB: D1Database;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  AUTH_EMAIL_FROM?: string;
  ENABLE_SIGNUP?: string;
  EMAIL: { send(message: OutboundEmail): Promise<{ messageId: string }> };
}

export function createAuth(env: AuthEnv) {
  return betterAuth({
    database: env.DB,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    emailAndPassword: {
      enabled: true,
      disableSignUp: env.ENABLE_SIGNUP !== 'true' || !env.AUTH_EMAIL_FROM,
      requireEmailVerification: true,
      sendResetPassword: async ({ user, url }) => {
        if (!env.AUTH_EMAIL_FROM) throw new Error('Authentication sender is not configured');
        await env.EMAIL.send({ from: env.AUTH_EMAIL_FROM, to: user.email, subject: 'Reset your Cloudmail password', text: `Reset your password using this link: ${url}` });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendVerificationEmail: async ({ user, url }) => {
        if (!env.AUTH_EMAIL_FROM) throw new Error('Authentication sender is not configured');
        await env.EMAIL.send({ from: env.AUTH_EMAIL_FROM, to: user.email, subject: 'Verify your Cloudmail email', text: `Verify your email using this link: ${url}` });
      },
    },
  });
}
