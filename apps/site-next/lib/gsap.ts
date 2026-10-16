import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

// Register once at module scope, on the client only. Section components import
// `gsap` and `ScrollTrigger` from here, so their effects always run against a
// registered plugin even though child effects run before the provider's.
if (typeof window !== 'undefined') {
  gsap.registerPlugin(ScrollTrigger);
}

export { gsap, ScrollTrigger };
