import type { OnForeground } from '@zilar/client-core';

export const onForeground: OnForeground = (cb) => {
  const onVisibility = (): void => {
    if (document.visibilityState === 'visible') {
      cb();
    }
  };
  window.addEventListener('focus', cb);
  document.addEventListener('visibilitychange', onVisibility);
  return () => {
    window.removeEventListener('focus', cb);
    document.removeEventListener('visibilitychange', onVisibility);
  };
};
