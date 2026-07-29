import type { RequestOptions } from '../../src/core/request';

// Environment configuration
export const API_URL = process.env.API_URL;
export const API_TOKEN = process.env.API_TOKEN;

if (!API_URL) {
  throw new Error('API_URL environment variable is required for integration tests');
}

if (!API_TOKEN) {
  throw new Error('API_TOKEN environment variable is required for integration tests');
}

// Shared request options for all tests
export const requestOptions: RequestOptions = {
  baseUrl: API_URL,
  token: API_TOKEN,
};

/**
 * Generate unique test identifiers using timestamps to prevent collisions.
 */
export function uniqueId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(7)}`;
}

/**
 * Generate unique email addresses for test data.
 */
export function uniqueEmail(prefix: string): string {
  return `${prefix}_${Date.now()}@test.shopwave.com`;
}

/**
 * Generate unique barcodes (numeric string) for product tests.
 */
export function uniqueBarcode(): string {
  return `TEST${Date.now()}`;
}
