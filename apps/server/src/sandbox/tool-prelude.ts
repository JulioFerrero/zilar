// T-1766: the `fmt` prelude for the tool sandbox. QuickJS has no `Intl`, so a
// tool cannot rely on `toLocaleString` for rounding or grouping. This plain-JS
// source is evaluated once inside the VM after the globals and before the tool
// source; it installs a frozen `fmt` global. Keep it small: it runs under the
// tool's own CPU and memory limits.
export const TOOL_PRELUDE = `
globalThis.fmt = Object.freeze((() => {
  const DASH = '\u2014';
  const group = (digits) => {
    let out = '';
    let count = 0;
    for (let i = digits.length - 1; i >= 0; i -= 1) {
      out = digits[i] + out;
      count += 1;
      if (count % 3 === 0 && i > 0) out = ',' + out;
    }
    return out;
  };
  const round = (value, digits) => {
    if (typeof value !== 'number' || !isFinite(value)) return null;
    const places = Math.max(0, Math.min(20, Math.floor(digits)));
    return value.toFixed(places);
  };
  const grouped = (fixed) => {
    const negative = fixed.charAt(0) === '-';
    const body = negative ? fixed.slice(1) : fixed;
    const dot = body.indexOf('.');
    const whole = dot === -1 ? body : body.slice(0, dot);
    const fraction = dot === -1 ? '' : body.slice(dot);
    return (negative ? '-' : '') + group(whole) + fraction;
  };
  const number = (value, digits = 2) => {
    const fixed = round(value, digits);
    return fixed === null ? DASH : grouped(fixed);
  };
  const money = (value, symbol = '$', digits = 2) => {
    const fixed = round(value, digits);
    return fixed === null ? DASH : symbol + grouped(fixed);
  };
  const change = (now, before, digits = 1) => {
    const fixed = round(((now - before) / before) * 100, digits);
    if (fixed === null) return { direction: 'flat', text: DASH };
    const rounded = Number(fixed);
    const direction = rounded > 0 ? 'up' : rounded < 0 ? 'down' : 'flat';
    return { direction, text: number(Math.abs(rounded), digits) + '%' };
  };
  return { number, money, change };
})());
`;
