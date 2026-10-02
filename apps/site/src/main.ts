import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './styles.css';

import { initControls } from './controls';

initControls(document);

const canvas = document.querySelector<HTMLCanvasElement>('#stage');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const root = document.documentElement;

if (canvas) {
  // the 3D scene loads after the text has painted; without WebGL the static icon stays in place
  import('./scene')
    .then(({ startScene }) =>
      startScene(canvas, { reducedMotion, onFirstFrame: () => root.classList.add('stage-ready') }),
    )
    .catch(() => root.classList.add('no-webgl'));
}
