import prisma from './db';

/**
 * Gets a configuration value. Checks the database first, then falls back to process.env.
 * @param {string} key
 * @returns {Promise<string|undefined>}
 */
export async function getConfig(key) {
  try {
    const config = await prisma.systemConfig.findUnique({
      where: { key }
    });
    if (config && config.value) {
      return config.value;
    }
  } catch (error) {
    console.error(`[Config Utility] Error reading database config for key "${key}":`, error);
  }
  
  // Fallback to environment variables
  return process.env[key];
}

/**
 * Sets a configuration value in the database.
 * @param {string} key
 * @param {string} value
 * @returns {Promise<any>}
 */
export async function setConfig(key, value) {
  try {
    return await prisma.systemConfig.upsert({
      where: { key },
      update: { value },
      create: { key, value }
    });
  } catch (error) {
    console.error(`[Config Utility] Error saving config for key "${key}":`, error);
    throw error;
  }
}
