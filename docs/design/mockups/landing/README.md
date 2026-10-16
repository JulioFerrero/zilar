# Landing page (approved 2026-10-16)

Julio asked for a full rework of www.zilar.app ("super fancy and modern, where the scroll is captured", like lenis.dev). He approved this prototype on 2026-10-16: "much much much better, lets build the real deal with the correct 3d model".

- **The prototype:** `prototype.html`, a copy of https://claude.ai/artifact/S32YQ8mbFaydP4ZUoJB2yr (private).
  - It's the reference for the **layout, copy, motion and timing**.
  - Open it in a browser straight from disk: it loads GSAP, Lenis and three from public CDNs.
  - Its file has no `<!doctype>` or `<head>`, because the artifact host adds them.
- **The 3D in the prototype is a stand-in.** The real build uses the existing scene in `apps/site/src/scene*` and `apps/site/src/shaders.ts`:
  - the Zilar mark with the icon's proportions;
  - the studio HDRI and the silver textures in `apps/site/public/textures`;
  - the nebula, the stars, the dust that glows gold behind the moon, and the finishing pass.
  - Only the placement changes: the planet lives in a fixed canvas behind the whole page and moves between "stations" as you scroll (`stations()` in the prototype).
- **The framework:** Julio chose **Next.js, pre-rendered** (static export, `output: 'export'`), served by the same Caddy container, so the Coolify `landing` app and the `get.zilar.app` redirect stay as they are.

## The page, top to bottom
1. **Header:** the mark, How it works, AI computers, Run your own, GitHub, and **Get the app** (the latest GitHub release). A 1 px gold reading-progress line sits under it.
2. **Hero** (pinned for 130% of the viewport):
   - "Your friends / and your AIs, / in one chat." (the last line in silver gradient);
   - the lede "A messenger you host yourself. Your server, your keys, your rules.";
   - **Run your own** and **Android app**.
   - The headline rises letter by letter on load and breaks apart by letters on scroll.
3. **Ownership line:** a paragraph whose words light up as you read; "your own provider keys" is in gold.
4. **The phone story** (pinned for 440%): four chapters (Chat, AIs, Approvals, Routines), with a progress bar row on each.
   - The phone tilts in 3D between chapters.
   - The routine's numbers flash gold on each edit (09:00, 09:05, 09:10).
5. **Your keys:** two huge outlined provider bands drifting against each other and skewing with scroll velocity, then "Your keys. Your limits." with the AES-256-GCM and daily-limit line.
6. **AI computers** (pinned for 130%): a terminal that types itself, with the four facts.
7. **Details** (pinned, sideways): eight glass cards, each with a live CSS micro-demo, gliding over the planet rising like a horizon.
8. **Install:** `curl -fsSL https://get.zilar.app | sh` with Copy, three requirements, and an Android download card.
9. **Finale:** a huge silver "zilar", "Basque for silver.", and two keys.
10. **Footer.**

## Rules
- **The copy is final as written:** one true fact per line, nothing invented. Any new claim needs the lead's OK.
- **Reduced motion:**
  - no Lenis;
  - scrubbed timelines jump instead of easing;
  - the CSS micro-demos show their end state;
  - the 3D renders a still frame.
- **Without JavaScript or WebGL** the page stays complete: every section visible in normal flow, and a still image of the mark.
- **Phone layouts** follow the prototype at 390 px wide.
- **D24 tokens:** dark only, Geist and Geist Mono, the glossy keys from `docs/design/ui-style.md` §4. The display face is Archivo with the width axis.
