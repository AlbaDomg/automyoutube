import { getConfig } from './config';
import crypto from 'crypto';
import prisma from './db';

/**
 * Signs a session with email using the client secret as HMAC key.
 * @param {string} email
 * @returns {Promise<string>}
 */
export async function signSession(email) {
  const secret = await getConfig('YOUTUBE_CLIENT_SECRET') || 'fallback_secret_key';
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(email);
  const signature = hmac.digest('hex');
  return `${email}:${signature}`;
}

/**
 * Verifies a signed session string.
 * @param {string} sessionCookie
 * @returns {Promise<string|null>}
 */
export async function verifySession(sessionCookie) {
  if (!sessionCookie) return null;
  const parts = sessionCookie.split(':');
  if (parts.length !== 2) return null;
  const [email, signature] = parts;
  
  const secret = await getConfig('YOUTUBE_CLIENT_SECRET') || 'fallback_secret_key';
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(email);
  const expectedSignature = hmac.digest('hex');
  
  if (signature === expectedSignature) {
    return email;
  }
  return null;
}

/**
 * Gets the role of a user from the database or falls back to env whitelist.
 * @param {string} email
 * @returns {Promise<string|null>}
 */
export async function getUserRole(email) {
  if (!email) return null;
  const cleanEmail = email.trim().toLowerCase();

  try {
    const user = await prisma.user.findUnique({
      where: { email: cleanEmail }
    });
    if (user) {
      return user.role;
    }
  } catch (err) {
    console.error('[Auth Service] Error finding user in database:', err);
  }

  // Fallback to whitelisted emails as ADMIN
  const allowedStr = await getConfig('ALLOWED_EMAILS') || process.env.ALLOWED_EMAILS || '';
  if (allowedStr && allowedStr.trim().length > 0) {
    const allowedEmails = allowedStr.split(',').map(e => e.trim().toLowerCase());
    if (allowedEmails.includes(cleanEmail)) {
      return 'ADMIN';
    }
  } else {
    // If absolutely no config exists, allow the first user as ADMIN
    return 'ADMIN';
  }

  return null;
}

/**
 * Checks if the email is allowed by the whitelist or role system.
 * @param {string} email
 * @returns {Promise<boolean>}
 */
export async function isEmailAllowed(email) {
  const role = await getUserRole(email);
  return role !== null;
}

/**
 * Verifies if the request has a valid session cookie.
 * @param {Request} request
 * @returns {Promise<boolean>}
 */
export async function verifyAppAuth(request) {
  const allowedStr = await getConfig('ALLOWED_EMAILS') || process.env.ALLOWED_EMAILS || '';
  if (!allowedStr || allowedStr.trim().length === 0) {
    return true;
  }

  // Read session cookie from request
  const cookieHeader = request.headers.get('cookie') || '';
  const match = cookieHeader.match(/app_session=([^;]+)/);
  const sessionCookie = match ? decodeURIComponent(match[1]) : null;
  
  if (!sessionCookie) {
    return false;
  }
  
  const email = await verifySession(sessionCookie);
  if (!email) {
    return false;
  }
  
  return await isEmailAllowed(email);
}

/**
 * Gets the email of the currently authenticated worker.
 * @param {Request} request
 * @returns {Promise<string|null>}
 */
export async function getCurrentUserEmail(request) {
  const cookieHeader = request.headers.get('cookie') || '';
  const match = cookieHeader.match(/app_session=([^;]+)/);
  const sessionCookie = match ? decodeURIComponent(match[1]) : null;
  
  if (!sessionCookie) {
    return null;
  }
  
  const email = await verifySession(sessionCookie);
  if (!email) {
    return null;
  }
  
  const allowed = await isEmailAllowed(email);
  if (!allowed) {
    return null;
  }
  
  return email;
}

