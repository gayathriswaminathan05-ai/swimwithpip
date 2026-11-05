# Sharing Pip on Muzli

## How Muzli submissions work

Muzli takes work through **Muzli Me**, its creative profile, and **Muzli Picks**, its curated new-tab
feed:

1. Create or sign in to your profile at https://me.muz.li/join.
2. Add the project to your profile. Muzli Me lets you either upload media from your computer or paste
   a link from a creative platform.
3. Nominate it for the feed at https://me.muz.li/nominate. In Muzli's words: "Sign in to nominate one
   of your projects for editorial review to be featured in the Muzli new tab."

Muzli does not publish exact image sizes. The images here use 4:3 at 1600 × 1200, the usual size for
design showcase sites, with 2× versions for sharp displays. There is also a short GIF, which
Muzli's tips recommend for making work feel more dynamic.

## Files

| File | Use |
| --- | --- |
| `01-cover.jpg` (and `01-cover@2x.png`) | Cover / thumbnail |
| `02-story.jpg` | The story: coins, the current, lost |
| `03-hurdles.jpg` | Falling rocks, dark cavern, final ambush |
| `04-interface.jpg` | Press ring, right answer, wrong answer |
| `05-ending.jpg` | Title, reunion, congratulations |
| `06-responsive.jpg` | Desktop browser and landscape phone |
| `07-gameplay.gif` | 11-second loop of a hurdle, from tap to escape (640 × 480, 1.4 MB) |

The `@2x.png` versions (3200 × 2400) are for when a site accepts large uploads; the `.jpg` files are
lighter. `raw/` holds the original phone screenshots. Re-render the composites with `compose.html`
(`?layout=cover|story|hurdles|interface|ending|responsive`) served by the dev server.

## Suggested text

**Title:** Pip: The Long Swim Home — a 3D underwater quiz game

**Short description:** A mobile-first Three.js game where every right answer helps a lost lanternfish
escape a hurdle on its way home. Eight hurdles, three lives, no timer.

**Longer description:** Pip, a little lanternfish, wanders off to look at gold coins and gets swept away
from its family by an ocean current. Players never steer. Each hurdle (a current, a ghost net, an
octopus, falling rocks, a predator, hot vents, a dark cavern and a final ambush) is beaten by
answering a short general-knowledge question that works for players anywhere. The interface keeps
the danger in a panel at the top and a calm quiz at the bottom, with a press ring on every tap.
Built with Three.js, with procedural animation and sound.

**Tags:** Three.js, WebGL, game design, educational game, quiz, mobile UI, interaction design, 3D

**Credit to include:** Coral models from the "Coral Reef Kit" by MiniPoly (Poly Pizza), CC BY 3.0 / CC0.
