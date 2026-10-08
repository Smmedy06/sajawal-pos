'use strict';
/*
 * Owner PIN: protects chosen pages and sensitive actions.
 * The PIN is stored as a salted scrypt hash; the unlocked state lives only
 * in main-process memory, so restarting the app always starts locked.
 */
const crypto = require('crypto');
const { fail, str } = require('../util');

function hash(secret, salt) {
  return crypto.scryptSync(String(secret), salt, 32).toString('hex');
}

function safeEqual(a, b) {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function makeRecoveryCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(12);
  let code = '';
  for (let i = 0; i < 12; i++) code += alphabet[bytes[i] % alphabet.length];
  return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`;
}

module.exports = function authService(ctx) {
  const state = { unlocked: false, failures: 0, blockedUntil: 0 };

  const sec = () => ctx.settings.get().security;
  const enabled = () => !!sec().pin_hash;

  function validatePin(pin) {
    const p = str(pin, 12);
    if (!/^\d{4,8}$/.test(p)) fail('PIN must be 4 to 8 digits', 'INVALID_PIN');
    return p;
  }

  function checkThrottle() {
    if (Date.now() < state.blockedUntil) {
      const s = Math.ceil((state.blockedUntil - Date.now()) / 1000);
      fail(`Too many wrong attempts. Try again in ${s} seconds.`, 'THROTTLED');
    }
  }

  function verify(pin) {
    checkThrottle();
    const s = sec();
    const ok = s.pin_hash && safeEqual(hash(str(pin, 12), s.pin_salt), s.pin_hash);
    if (!ok) {
      state.failures++;
      if (state.failures >= 5) {
        state.blockedUntil = Date.now() + 30000;
        state.failures = 0;
      }
      fail('Incorrect PIN', 'WRONG_PIN');
    }
    state.failures = 0;
    return true;
  }

  function writeSecurity(patch) {
    const cur = { ...sec(), ...patch };
    ctx.settings.writeRaw('security', cur);
  }

  return {
    status() {
      return { enabled: enabled(), unlocked: !enabled() || state.unlocked };
    },

    /** True when the action may run right now. */
    isAllowed(action) {
      if (!enabled() || state.unlocked) return true;
      return !sec().protected_actions.includes(action);
    },

    require(action) {
      if (!this.isAllowed(action)) fail('This action is locked. Enter the owner PIN to continue.', 'LOCKED');
    },

    unlock(pin) {
      if (!enabled()) return this.status();
      verify(pin);
      state.unlocked = true;
      ctx.audit('Unlocked', 'security', null, 'Owner PIN entered');
      return this.status();
    },

    lock() {
      state.unlocked = false;
      return this.status();
    },

    /** Set or change the PIN. Returns a one-time recovery code. */
    setPin({ current, pin }) {
      if (enabled()) verify(current);
      const p = validatePin(pin);
      const salt = crypto.randomBytes(16).toString('hex');
      const recovery = makeRecoveryCode();
      const recSalt = crypto.randomBytes(16).toString('hex');
      ctx.store.tx(() => {
        writeSecurity({ pin_hash: hash(p, salt), pin_salt: salt, recovery_hash: `${recSalt}:${hash(recovery, recSalt)}` });
        ctx.audit(current ? 'PIN Changed' : 'PIN Enabled', 'security', null, 'Owner PIN was set');
      });
      state.unlocked = true;
      return { recoveryCode: recovery, status: this.status() };
    },

    disablePin({ current }) {
      if (!enabled()) return this.status();
      verify(current);
      ctx.store.tx(() => {
        writeSecurity({ pin_hash: '', pin_salt: '', recovery_hash: '' });
        ctx.audit('PIN Disabled', 'security', null, 'Owner PIN protection was turned off');
      });
      state.unlocked = false;
      return this.status();
    },

    /** Forgotten PIN: the recovery code lets the owner set a new PIN. */
    recover({ code, pin }) {
      checkThrottle();
      const [salt, h] = String(sec().recovery_hash || '').split(':');
      const normal = str(code, 20).toUpperCase().replace(/[^A-Z0-9]/g, '');
      const formatted = `${normal.slice(0, 4)}-${normal.slice(4, 8)}-${normal.slice(8)}`;
      if (!salt || !h || !safeEqual(hash(formatted, salt), h)) {
        state.failures++;
        if (state.failures >= 5) { state.blockedUntil = Date.now() + 30000; state.failures = 0; }
        fail('Recovery code is not correct', 'WRONG_CODE');
      }
      state.failures = 0;
      writeSecurity({ pin_hash: '' });
      ctx.audit('PIN Recovered', 'security', null, 'PIN reset using the recovery code');
      return this.setPin({ pin });
    }
  };
};
