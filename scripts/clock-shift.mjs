// Clock shift preload (night shift 2026-11-25, same as Wolf Hall's), used by scripts/clock-ahead.mjs. Read-only, for tests only.
// With CLOCK_SHIFT_DAYS=N it makes this process think it is N days later: new Date(), Date() and Date.now()
// move ahead; dates built from a value (new Date('2026-12-01')) don't. Fresh vm contexts get the same shift,
// so code a test runs in a sandbox moves too. A test that pins its own clock stays pinned.
// usage: CLOCK_SHIFT_DAYS=7 node --import ./scripts/clock-shift.mjs --test tests/<file>.test.js
import vm from 'node:vm';

const OFF = Math.round(parseFloat(process.env.CLOCK_SHIFT_DAYS || '0') * 86400000) || 0;
export const SHIFT_SRC = `(function (g, off) { var R = g.Date; if (!R || R.__shifted) return;
  function D(a, b, c, d, e, f, h) { var n = arguments.length; if (!new.target) return new R(R.now() + off).toString();
    switch (n) { case 0: return new R(R.now() + off); case 1: return new R(a); case 2: return new R(a, b); case 3: return new R(a, b, c);
      case 4: return new R(a, b, c, d); case 5: return new R(a, b, c, d, e); case 6: return new R(a, b, c, d, e, f); default: return new R(a, b, c, d, e, f, h); } }
  D.prototype = R.prototype; D.now = function () { return R.now() + off; }; D.parse = R.parse; D.UTC = R.UTC; D.__shifted = true;
  Object.defineProperty(D, Symbol.hasInstance, { value: function (x) { return x instanceof R; } });
  g.Date = D; })(globalThis, ${OFF});`;

if (OFF) {
  (0, eval)(SHIFT_SRC);
  const createContext = vm.createContext;
  vm.createContext = function (ctx, ...rest) { const c = createContext.call(vm, ctx, ...rest); try { vm.runInContext(SHIFT_SRC, c); } catch (e) {} return c; };
  vm.runInNewContext = function (code, ctx, ...rest) { return vm.runInContext(code, vm.createContext(ctx || {}), ...rest); };
}
