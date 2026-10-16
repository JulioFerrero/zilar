import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { SmoothScroll } from '@/components/smooth-scroll';
import { Planet } from '@/components/planet/planet';
import { Hero } from '@/components/sections/hero';
import { Statement } from '@/components/sections/statement';
import { Story } from '@/components/sections/story';
import { Keys } from '@/components/sections/keys';
import { Computer } from '@/components/sections/computer';
import { Details } from '@/components/sections/details';
import { Install } from '@/components/sections/install';
import { Finale } from '@/components/sections/finale';

export default function Home() {
  return (
    <SmoothScroll>
      <Header />
      <Planet />
      <main id="top">
        <Hero />
        <Statement />
        <Story />
        <Keys />
        <Computer />
        <Details />
        <Install />
        <Finale />
      </main>
      <Footer />
    </SmoothScroll>
  );
}
