# Pip: The Long Swim Home — design document

## 1. Concept overview

**Title:** Pip: The Long Swim Home
**Premise:** Pip, a small, curious lanternfish, swims with its family until it wanders off to look
at gold coins scattered around an old sunken treasure chest on the sea floor. Then a powerful ocean
current tears it away from its family. Lost and alone, Pip has to cross three areas of ocean to
get home. The player never steers. Pip swims on its own, and the player protects it by answering
quiz questions whenever danger appears.

**Tagline:** *Answer questions. Brave the ocean. Find your way home.*

**Art direction:** a painterly, illustrated reef rendered as real 3D geometry, as opposed to
low-poly facets. Shapes are smooth and rounded, with soft vertical colour gradients, a gentle
water-coloured rim light, animated caustics on upward-facing surfaces, bright teal haze for
atmospheric depth, slanted light rays and a rippling surface overhead. The palette shifts by area:

- sunlit teal and coral in the Lost Waters
- twilight blue in the Dangerous Depths
- violet with bioluminescent cyan, pink and gold in the Glowing Home

The interface ("Sunlit reef") is bright and playful but its own thing, not a Duolingo look-alike:
- Unbounded for headings and buttons, Lexend for easy reading
- light frosted panels that let a little ocean through, instead of flat white cards
- calm white answer cards (colour only means something: coral is your tap, sea green right, rose
  wrong) and glossy coral "candy" buttons, with no hard
  ledge shadows
- a press ring in a deeper shade of whatever you touch
- illustrated hurdle icons on an amber lantern disc
- feedback as a tinted card inside the sheet, not a full-width bar

**Defaults:**

| Setting | Default |
|---|---|
| Audience | Families, ages 10+ |
| Difficulty | Medium (Easy and Hard selectable on the title screen) |
| Timer | None |
| Visual quality | Auto (medium on phones, high on desktop; steps down if the frame rate drops) |
| Reduced motion | Follows the device setting |
| Test-mode "Skip (test)" button | On (can be turned off in Settings) |
| Coral models | MiniPoly "Coral Reef Kit" (5 sets) mixed with procedural corals; procedural only if loading fails |

## 2. Gameplay outline

**Opening story** (about 32 seconds, skippable with "Skip intro"):

1. Pip swims side by side with its family, all in one direction.
2. Pip spots gold coins by an old treasure chest and swims down to look. The family swims on a
   little, then stops and turns round to wait for Pip.
3. A powerful current comes roaring down the reef: a wall of water and sand rushes in, flings the
   family up and away out of the reef, then hits Pip. Pip tumbles, fights back towards its family
   with frantic fin beats, and is dragged far back the way they came. Plants bend flat, sand
   fills the water and the camera shakes.
4. Lost: the water is murky and empty. A high, wide shot shows one tiny fish on the sand. Pip
   turns all the way round with a "?" thought bubble, calls out with a flash of its lights, and
   nobody answers. Pip droops, sad and dim.
5. The water clears a little, Pip looks determined, and the journey begins: "Home is far away,
   past dangerous waters. Pip needs your help!"

Loop: **explore → danger appears → question → feedback → escape or setback → continue.**

| # | Area | Hurdle | Encounter | Correct-answer escape | Third-mistake capture |
|---|---|---|---|---|---|
| 1 | Lost Waters | Powerful current | A visible stream of rushing water (flowing lines, carried sand, seaweed and bubbles) runs straight against Pip. Pip swims hard, gains a little, then a gust shoves it back with a tumble, over and over | Pip banks out of the stream into a sheltered channel between boulders | A huge gust slams Pip far back (wrong answer); on capture Pip is swept away back down the stream |
| 2 | Lost Waters | Abandoned net | A billowing net with floats and weights blocks the passage | Pip squeezes (squash) through a torn opening | The net wraps around Pip and lifts away |
| 3 | Dangerous Depths | Octopus ambush | An orange-red octopus hides behind a big rock, eyes peeking over it, tentacles draped over and around it | Tentacles coil, then strike where Pip *was*; Pip barrel-rolls around the side of the rock | Tentacles wrap and pull Pip behind the rock |
| 4 | Dangerous Depths | Falling rocks | Rocks trickle down a canyon; a boulder teeters | Pip dives under a boulder arch while rocks bounce off it | Rocks fall around Pip and seal it in |
| 5 | Dangerous Depths | Predator chase | An anglerfish-like hunter closes in from behind | Pip bursts into a narrow passage; the predator bonks the rocks | The predator lunges; its jaws snap; darkness |
| 6 | Dangerous Depths | Hydrothermal vents | Chimneys burst with scalding plumes | Pip times dashes between bursts (high-angle view) | A plume sweeps Pip up and away |
| 7 | Glowing Home | Dark cavern | The route vanishes into a pitch-black cave | Glowing mushrooms light up one by one with chimes; Pip follows them | An undertow pulls Pip into the dark |
| 8 | Glowing Home | The Final Ambush (two questions) | A big hungry fish rises from behind the rocks to block the way home | Q1: Pip dodges the ambush. Q2: Pip flashes a signal, the school rushes in, and the predator flees | The big fish catches Pip |

Between hurdles there are calm stretches: a whale glides overhead, story captions appear, area
banners mark the transitions, and the reef changes as Pip goes deeper. Jellyfish are scenery
only, never a hurdle. A journey asks 9 questions
over about 5–8 minutes.

**Quiz rules**

- There are six topics: maths, geography, history, science, nature and logic. Each journey
  rotates through all of them. The bank holds 144 questions, 8 for each topic and difficulty.
- Questions are written for players of any nationality: world geography and world history,
  metric units, and nothing tied to one country, language or alphabet.
- Each question has four labelled choices (1–4) and exactly one correct answer.
- Choices are shuffled at runtime, and the correct answer's position is balanced across the four
  slots and never repeats twice in a row.
- No question repeats within a playthrough, and categories rotate.
- Every answer shows a short explanation. After a correct answer it appears in a toast while the
  escape plays. After a wrong answer it appears in the red feedback strip.
- Input is tap or click, the 1–4 or A–D keys, or Enter on the focused button.

**Three-life system**

- Every journey starts with 3 lives, shown as hearts in the header at all times.
- A correct answer costs nothing.
- A wrong answer removes exactly one life: the heart breaks with an animation, a sound plays, the
  screen edge flashes (or shows a static border with reduced motion), and the phone vibrates where
  supported.
- After the 1st or 2nd mistake: a near-miss animation plays, the correct answer is explained, then
  "Try another question" brings a fresh question at the same hurdle.
- Lives carry across the whole journey.
- On the 3rd mistake: a short, non-graphic capture that fits the hurdle, then a simple Game Over
  card: "Game over — You answered N questions correctly", **Try Again** (new journey, 3 lives)
  and a small **Back to title**.
- Each question accepts only the first submission (a one-shot answer gate), so double taps cannot
  deduct two lives.

**Ending:** with at least one life left, the school swirls around Pip, their tail beats
synchronise, and they swim home together to a glowing reef. The completion card shows stats and
**Play Again** / **Change difficulty**.

## 3. Visual and motion plan

**Characters**

- **Pip:** a warm orange lanternfish with big glossy eyes (lids blink and form expressions),
  blush, a small smile and a row of glowing photophores. No antenna. The body is a single smooth
  loft:
  - a rounded nose, the widest point just behind the eyes, then an even taper into a slim tail
    stalk, with no seams or creases
  - every fin (dorsal, forked tail, anal and pectorals) grows out of the body: thick at the root,
    thinning to a soft edge
- **Pip's family:** the same design. They swim as a tidy, staggered school, all facing the same
  way.
- **Octopus:** bold and clean, in three flat colours and no noise:
  - a bright red-orange body with a big rounded mantle tilted back
  - gold eyes with horizontal slit pupils, set in ringed sockets, and a siphon ring on the cheek
  - eight chunky arms with a flattened salmon underside carrying big raised suckers in pairs:
    white rims around sunken deep-red centres
  - arms thin into spiral-curled tips

  Each arm follows a path (`armPath` in `actors/creatures.js`) instead of bending blindly, and its
  suckers face the inside of every bend, or turn toward the camera on display arms. It hides fully
  behind its rock, then climbs over the edge onto the sand in front, with every arm in view:
  - two arms raised and curling over its head
  - one reaching for Pip
  - five spread on the sand with curled tips

  On a right answer the arms rear up and strike; on a wrong one an arm lashes out; on a capture
  they wrap Pip.
- **Predator:** a big, dark, speckled deep-sea fish with glowing eyes, a hinged jaw and teeth. No
  lure or antenna.
- **Jellyfish (scenery only):** pulsing translucent bells with softly waving tentacles.
- **Whale:** a gentle background giant.
- **Ambient sea life:** sea turtles with paddling flippers, rays with rippling wings, schools of
  tropical fish (yellow, blue tang, glowing deep-water fish, pink), crabs scuttling sideways,
  bobbing seahorses and drifting jellyfish. Each area has its own mix. They spawn ahead of Pip,
  stay clear of hurdle areas and hide in the dark cave.
- **Jellyfish:** each one swims smoothly upward in a loose column off to the side of the path. A
  pulse gives a gentle surge and it glides between pulses, drifting a little sideways with its bell
  tilted into its travel. It fades in low and out high, and its tentacles wave on a steady,
  jitter-free rhythm.

**Swimming:** all fish use the same procedural rig.

- The body undulates along its length in the vertex shader.
- The tail beats faster with speed and acceleration.
- Pectoral fins flutter.
- Heading follows velocity, and the body banks into turns.
- Scripted spins, squashes (squeezing through the net) and shivers (fear) layer on top.

**Animation principles:** anticipation (tentacles coil before striking, the boulder teeters, the
predator's jaw opens), clear escape arcs, and settling afterwards (Pip hovers and breathes, then
resumes cruising with smoothed easing).

**Environments:** three blended areas. Each has its own sky gradient, fog, light-ray strength,
caustic strength, rim colour, coral palette and sand colour. The dark cavern overrides everything
into darkness, so Pip's own glow and the markers carry the scene.

**Camera:** a rig built from "shots" (focus, yaw, pitch and a framing radius).

- The distance is computed from the *free* part of the screen: the area not covered by the
  question sheet or header. The projection is offset so the focus sits in the centre of that area.
- Cruising cycles through four slow shot presets (behind, side-on, high and wide, opposite side).
- Encounters use their own framings: low frontal, side, high angle, inside the tunnel.
- While a hurdle is on screen the haze thins so the danger always reads clearly.
- Reduced motion slows the camera and removes shake.

**Effects:** bubbles, sand-dust puffs, sparks, glowing halos, steam plumes, marine snow, light rays
and caustics. Ocean currents are drawn as a broad, winding stream of moving water: a soft
translucent band with a bright rim and long flowing dashes, fading at both ends. Sand, bits of
seaweed and bubbles race along inside it, a few streamlines flow with it, and plants all lean the
same way with the flow. The intro's current is a bigger, bolder version: it visibly rushes in
behind a churning front, kicks up billowing sand along the floor and leaves the water murky. It
fades out close to the camera, so it never washes over the view. No hard geometric primitives are
used for effects.

**Nothing fills the screen by accident**

Scenery (reef, corals, kelp, rocks, hurdle props) dissolves with a soft dither when the camera gets
within a few units of it, so nothing near the lens can fill the screen as a giant faceted shape.
Pip, the creatures and the seabed are never faded. Passing sea life also keeps clear while a
hurdle is on screen.

**Narration**

A warm, playful storyteller reads the opening story and then the welcome card, including how to
play. Captions show the same words. The full script, with an emotional direction for each line,
is in `src/data/narration.js` and `design/narration-script.md`.
- **Recorded lines:** every line is recorded with an expressive AI storyteller voice ("Isla",
  ElevenLabs via Higgsfield). The files are in `public/audio/narration/` and listed in
  `NARRATION_FILES`, and play in sync with the captions. About 50 seconds, under 1 MB.
- **Fallback:** any line without a recording is read by the device's speech voice (the friendliest
  English voice available). Pip's quoted thoughts are higher and bouncier.
- **Staying in sync:** the intro waits at natural pauses for the narrator, so captions and voice
  never drift apart.
- **Controls:** Skip intro and "Let's swim!" stop the voice, pause pauses it, and mute silences it.
  Settings has a "Narrator reads the story" switch. Automated test runs stay silent.

## 4. Mobile interface plan (portrait first)

- **Header:** a frosted pill at the top that respects the notch and safe areas. Every hit area is
  at least 44 × 44 px. It holds:
  - pause and sound buttons
  - a progress groove split into one segment per hurdle, with a tiny Pip swimming toward a home
    (house) icon
  - the area name and "N of 8" underneath
  - three hearts; a lost life becomes an empty outline
- **Hurdle panel (top):** a warm sand frosted card under the header, with:
  - an illustration of that hurdle on a gently pulsing amber disc (current, net, octopus, rocks,
    predator, vents, cavern, ambush)
  - "Hurdle 3 of 8", the hurdle name, one sentence on the danger and, in bold, what a right answer
    does ("Answer to slip past.")

  It slides in and out with the question, so the danger and the quiz never share a card.
- **Question sheet (bottom, minimal):** a frosted white sheet within thumb reach. It holds only:
  - a quiet topic label (coloured dot) with a small "Skip (test)" link on the same row
  - the question
  - a 2 × 2 grid of white answer cards, each at least 60 px tall

  The 1–4 key badges show only on devices with a keyboard or mouse. The 3D scene is framed
  between the two panels, so Pip and the danger stay visible.
- **Press interaction:** every button squishes in while held and springs back on release. A ring
  in a darker shade of the button's colour appears at the finger, contracts during the press, then
  bursts outward and fades (`src/game/ui/pressRing.js`). Keyboard shortcuts play the same ring,
  centred. With reduced motion only the gentle squish remains. There are no hard "ledge" shadows.
- **Feedback:**
  - Correct: the chosen card turns sea-green with a ✓ and praise shows ("Nice!", "Great job!"…),
    then the sheet slides away and the explanation appears in a green toast.
  - Wrong: the chosen card turns rose with a ✗, the correct card turns sea-green with a ✓, and a
    rose card appears inside the sheet with the explanation and **Try another question**. Feedback always uses icons
    and text, never colour alone.
- **Game Over and completion:** frosted cards and a glossy coral primary
  button.
- **Fallbacks:** on low visual quality, with "reduce transparency" on, or in browsers without
  backdrop blur, the panels become solid instead of frosted. (An earlier dark "Sea glass" version is
  kept in `design/sea-glass-dark.css` for reference.)
- **Landscape phones:** the sheet docks to the right and the hurdle panel sits top-left, with the
  scene visible below it.
  Tablets and desktop get a floating centred sheet.
- **State and accessibility:** rotating or resizing keeps all game state. Visible keyboard focus,
  ARIA labels and live regions, reduced-motion support, and no hover-only interactions.
