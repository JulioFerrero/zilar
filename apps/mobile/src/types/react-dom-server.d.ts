// Ambient types for `react-dom/server`'s static renderer, used only by the
// component render tests (T-0112 pattern: no component renderer on mobile, so
// sheets render to static markup with mocked native primitives). `react-dom`
// ships no server types without `@types/react-dom`, which the app must not
// add for tests alone.
declare module 'react-dom/server' {
  import type { ReactElement } from 'react';

  export function renderToStaticMarkup(element: ReactElement): string;
}
