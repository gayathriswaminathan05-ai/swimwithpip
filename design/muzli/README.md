# Sharing Pip on Muzli

## How Muzli works (checked November 2026)

Muzli has two layers, and only the second is chosen by Muzli:

1. **Your project page on Muzli Me (you publish it).** Sign in at https://me.muz.li, then add the
   project at https://me.muz.li/upload by pasting the live link. Sites that allow embedding show
   up as the live, playable page instead of a screenshot (swimwithpip.pages.dev allows it). Muzli
   asks you to "tell us how you made it in the description". Once published, the page is public
   on your profile.
2. **Muzli Picks in the Muzli new tab (editors choose).** Nominate the project at
   https://me.muz.li/nominate. Each nomination goes to Muzli's curation queue; editors decide
   whether it becomes a Muzli Pick. Muzli says it usually reviews within 24 hours. Free accounts
   get **one** nomination; PRO accounts get three a month. In Muzli's words, the tool used does not
   matter: "We do not care which tool wrote the code."

Muzli does not publish required image sizes or formats. The images here use 4:3 at 1600 × 1200
(2× versions at 3200 × 2400), plus a short GIF.

## Files

| File | Use |
| --- | --- |
| `01-cover.jpg` | Cover / thumbnail: the "Deep-Sea Quiz Adventure" splash, the octopus, the family to the rescue |
| `02-story.jpg` | The story: gold coins, the current, lost |
| `03-hurdles.jpg` | Help arrives with the right answer: the net before and after, the predator's gap |
| `04-interface.jpg` | Press ring, right answer, wrong answer |
| `05-ending.jpg` | The final hurdle: ambush, family swarms the big fish, reunion |
| `06-responsive.jpg` | Desktop browser and landscape phone |
| `07-gameplay.gif` | 12-second loop of the octopus hurdle, from emergence to escape (640 × 480, 1.2 MB) |

The `@2x.png` versions are for sites that accept large uploads. `raw/` holds the original phone
screenshots. Re-render the composites with `compose.html` (`?layout=cover|story|hurdles|interface|ending|responsive`)
served by the dev server.

## Suggested text

**Link:** https://swimwithpip.pages.dev

**Title:** Pip: The Long Swim Home, a deep-sea quiz adventure

**Short description:** A mobile-first 3D quiz game where every right answer helps a lost lanternfish
past a danger on its way home. Eight hurdles, three lives, no timer.

**Longer description (how it was made):** Pip, a little lanternfish, wanders off to look at gold
coins and is swept away from its family by an ocean current. Players never steer: each hurdle (a
current, an old fishing net, an octopus, falling rocks, a predator, hot vents, a dark cavern and a
final ambush) shows the danger first, and the way out appears only when you answer a short
general-knowledge question correctly. The net tears open, a boulder tumbles out of a gap, and in
the finale Pip's family swarms the big fish and chases it away.

Everything is made in code with Three.js: Pip, its family, every creature, the coral reef,
particles and the synthesised sound effects. The opening story is narrated with an AI voice. I
designed and directed it and built it with Claude Code (Anthropic), iterating on the art, motion
and interface through many rounds of playtesting.

**Tags:** Three.js, WebGL, game design, educational game, quiz, mobile UI, interaction design, 3D, AI-assisted
