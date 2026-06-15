import { google } from 'googleapis';
import { getConfig } from './config';

/**
 * Initializes and returns a Google OAuth2 client with credentials retrieved from config.
 * @param {string} [customOrigin] Optional custom origin to use for the redirect URI.
 * @returns {Promise<google.auth.OAuth2>}
 */
export async function getOAuth2Client(customOrigin) {
  const clientId = await getConfig('YOUTUBE_CLIENT_ID');
  const clientSecret = await getConfig('YOUTUBE_CLIENT_SECRET');
  const appUrl = customOrigin || await getConfig('NEXT_PUBLIC_APP_URL') || 'http://localhost:3000';
  const redirectUri = `${appUrl}/api/auth/callback`;

  return new google.auth.OAuth2(
    clientId,
    clientSecret,
    redirectUri
  );
}

/**
 * Initializes and returns a Google OAuth2 client configured for the app's Google Sign-In flow.
 * @param {string} [customOrigin] Optional custom origin to use for the redirect URI.
 * @returns {Promise<google.auth.OAuth2>}
 */
export async function getAppLoginOAuth2Client(customOrigin) {
  const clientId = await getConfig('YOUTUBE_CLIENT_ID');
  const clientSecret = await getConfig('YOUTUBE_CLIENT_SECRET');
  const appUrl = customOrigin || await getConfig('NEXT_PUBLIC_APP_URL') || 'http://localhost:3000';
  const redirectUri = `${appUrl}/api/auth/app-callback`;

  return new google.auth.OAuth2(
    clientId,
    clientSecret,
    redirectUri
  );
}

