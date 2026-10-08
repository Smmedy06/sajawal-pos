'use strict';
/*
 * Shared helpers for the main-process data layer.
 *
 * Money convention: the database stores every amount as INTEGER paisa
 * (1 rupee = 100 paisa) so sums are exact. The API that the renderer talks
 * to speaks plain rupee numbers; conversion happens only through P() and R().
 */

class AppError extends Error {
  constructor(message, code = 'APP_ERROR') {
    super(message);
    this.code = code;
  }
}

function fail(message, code) {
  throw new AppError(message, code);
}

/** Rupees (number|string) -> integer paisa. Rejects NaN/Infinity. */
function P(rupees) {
  if (rupees === null || rupees === undefined || rupees === '') return 0;
  const n = Number(rupees);
  if (!Number.isFinite(n)) fail(`Invalid amount: ${rupees}`, 'INVALID_AMOUNT');
  return Math.round(n * 100);
}

/** Nullable variant: '' / null / undefined -> null. */
function Pn(rupees) {
  if (rupees === null || rupees === undefined || rupees === '') return null;
  return P(rupees);
}

/** Integer paisa -> rupees number. */
function R(paisa) {
  if (paisa === null || paisa === undefined) return null;
  return Math.round(Number(paisa)) / 100;
}

function int(value, label = 'Quantity') {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) fail(`${label} must be a whole number`, 'INVALID_NUMBER');
  return n;
}

const pad = (n) => String(n).padStart(2, '0');

/**
 * Local wall-clock timestamp 'YYYY-MM-DD HH:MM:SS.mmm' (the shop runs in one timezone).
 * Milliseconds keep records made within the same second in the right order.
 */
function now(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

function today(d = new Date()) {
  return now(d).slice(0, 10);
}

/** Convert any ISO/UTC timestamp to the local 'YYYY-MM-DD HH:MM:SS' format. */
function toLocalStamp(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return now();
  return now(d);
}

function isDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/** Normalise a {from,to} date range (inclusive, YYYY-MM-DD). Missing ends are open. */
function range(r = {}) {
  const from = isDate(r.from) ? `${r.from} 00:00:00` : '0000-01-01 00:00:00';
  const to = isDate(r.to) ? `${r.to} 23:59:59.999` : '9999-12-31 23:59:59.999';
  return { from, to };
}

function str(value, max = 500) {
  if (value === null || value === undefined) return '';
  return String(value).trim().slice(0, max);
}

/** Escape LIKE wildcards; used with ESCAPE '\'. */
function likeTerm(q) {
  return `%${String(q).replace(/[\\%_]/g, (m) => '\\' + m)}%`;
}

function paging(opts = {}, defaultSize = 25) {
  const size = Math.min(500, Math.max(1, Number(opts.pageSize) || defaultSize));
  const page = Math.max(1, Number(opts.page) || 1);
  return { limit: size, offset: (page - 1) * size, page, pageSize: size };
}

function fmtMoney(paisa) {
  const r = R(paisa);
  return `Rs. ${r.toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

module.exports = { AppError, fail, P, Pn, R, int, now, today, toLocalStamp, isDate, range, str, likeTerm, paging, fmtMoney };
