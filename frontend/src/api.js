import axios from 'axios';

// In dev mode (npm run dev) VITE_API_URL is intentionally left blank so
// requests go through the Vite proxy (see vite.config.js), which forwards
// them to localhost:8000 without CORS preflights.
// In a production build, set VITE_API_URL to the publicly reachable backend.
const baseURL = import.meta.env.VITE_API_URL || '';

export const api = axios.create({ baseURL, timeout: 15000 });

/** Small RFC4122-ish v4 UUID generator, good enough for demo idempotency keys. */
export function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Pulls a clean, human-readable message out of an axios error. */
export function apiErrorMessage(err) {
  if (err.response && err.response.data && err.response.data.detail) {
    return err.response.data.detail;
  }
  if (err.request) {
    const target = baseURL || 'localhost:8000';
    return `Could not reach the API at ${target}. Is the backend running?`;
  }
  return err.message || 'Unknown error';
}

export const API_BASE_URL = baseURL;
