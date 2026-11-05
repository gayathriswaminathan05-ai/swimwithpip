# Pip: The Long Swim Home

A mobile-first, fully 3D underwater quiz adventure built with **Three.js**. Pip, a little
lanternfish, wanders away from its school to look at gold coins on the sea floor and gets swept
off by an ocean current. Pip swims on its own;
you protect it by answering quiz questions whenever danger appears. You have **three lives**, and
each wrong answer costs one.

**Play it:** https://gayathriswaminathan05-ai.github.io/pip-the-long-swim-home/ (works on phones; best in
portrait).

See [DESIGN.md](DESIGN.md) for the concept, gameplay outline, visual and motion plan, and mobile
interface plan.

Every push to `main` runs the tests, builds the game and publishes it to GitHub Pages
(`.github/workflows/deploy.yml`).

## Run it locally

Requires Node.js 18 or newer.

```bash
cd pip-way-home
```

```bash
npm install
```

```bash
npm run dev
```

Then open <http://localhost:5180>.

**On your phone:** connect it to the same Wi-Fi network and open `http://<your-computer's-IP>:5180`
(the dev server listens on your network). On a Mac, find the IP in
System Settings → Wi-Fi → Details.

**Static build:** `npm run build` writes a self-contained `dist/` folder that any static host can
serve. Preview it with `npm run preview` (port 5181). ES modules need a web server, so opening
`index.html` from the file system won't work.

## How to play

- Pip swims automatically. When danger appears, a question slides up from the bottom.
- Tap an answer (or press **1–4** / **A–D**). A right answer makes Pip escape the hurdle. A wrong
  answer costs a life; Pip has a near miss and you get a fresh question at the same hurdle.
- On the third wrong answer Pip gets caught and a simple Game Over card shows how many questions
  you answered correctly. **Try Again** starts a new journey with three lives.
- Questions rotate through six topics (maths, geography, history, science, nature and logic) and
  are written so a player from any country can answer them.
- **Pause:** the ⏸ button or **Esc** / **P**. The game also pauses automatically when you switch
  tabs or apps.
- **Sound:** the speaker button or **M**.
- **Settings** (title screen or pause menu): sound, visual quality (Auto / Low / Medium / High),
  reduced motion (Match device / On / Off), and the test-mode Skip button.

### Test-mode Skip button

Every question has a small **SKIP (TEST)** button. It passes the hurdle (and plays its escape
animation) without answering, without costing a life, and without counting as an answer. Turn it
off under **Settings → Show "Skip (test)" button** before sharing the game with players.

## Edit the questions

All questions live in [`src/data/questions.js`](src/data/questions.js), a plain array with an
editing guide at the top. Each question needs exactly four different choices, and `answer` is the
0-based index of the correct one; the game shuffles choice order at runtime. Run `npm test`
afterwards to validate the bank. The tests check structure, lengths, duplicates, and that each
explanation names the answer.

## Project structure

```
pip-way-home/
├── index.html               HTML overlays: loader, HUD, hurdle panel, quiz sheet, dialogs
├── src/
│   ├── main.js              Boot + real loading progress
│   ├── styles.css           Interface styles (ocean palette, hurdle panel, minimal quiz sheet)
│   ├── data/questions.js    Editable question bank (120 questions)
│   └── game/
│       ├── Game.js          State machine: title → intro → journey → game over / victory
│       ├── audio.js         Synthesised sound effects and ambient music (Web Audio, no files)
│       ├── core/            Scheduler (game-clock tweens), camera rig, maths/noise utils
│       ├── gfx/             Geometry helpers, shaders (swim, sway, rim, caustics), particles
│       ├── world/           Ocean areas, reef generator, current wisps
│       ├── actors/          Pip and the swimmer rig, the school, octopus, predator, jellyfish, whale
│       ├── encounters/      The eight hurdles (approach / question framing / escape / near miss / capture)
│       ├── logic/           Pure rules: question deck, three-life run state, answer gate
│       ├── ui/ui.js         DOM interface: HUD, hurdle panel, quiz sheet, feedback, dialogs
│       └── ui/pressRing.js  Button press feedback: squish + contracting/bursting ring
└── tests/
    ├── logic.test.js        Unit tests (rules and question bank)          → npm test
    └── playthrough.mjs      End-to-end browser playthrough (Playwright)   → npm run test:browser
```

## Assets and licences

Almost everything is generated in code: Pip, the creatures, rocks, procedural corals, textures,
particles and synthesised audio. The only third-party files are five coral models, all used under
licences that allow this.

- **Coral models:** "Coral Reef Kit" by **MiniPoly** via
  [Poly Pizza](https://poly.pizza/bundle/Coral-Reef-Kit-ghN8EmbYa6). Set 1 (tube corals) is
  [CC0](https://creativecommons.org/publicdomain/zero/1.0/); Sets 2–5 (sprigs, staghorn, egg
  sponges, barrel sponges) are [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/).
  The files are in `public/models/minipoly/`, with a full credit table in
  [CREDITS.md](public/models/minipoly/CREDITS.md). The game also credits MiniPoly under
  Settings. If the models fail to load, the reef falls back to procedural corals.
- **Fonts:** [Unbounded](https://fonts.google.com/specimen/Unbounded) (headings and buttons) and
  [Lexend](https://fonts.google.com/specimen/Lexend) (reading text) via Fontsource, both under the
  SIL Open Font Licence 1.1.
- **Engine:** [Three.js](https://threejs.org) (MIT licence).

No accounts, servers or AI services are needed at runtime.

## Verification summary

Checked by automated tests plus screenshot review of every hurdle's question view, near miss,
escape and capture. Screenshots were taken in Chrome emulating a 390 × 844 phone (portrait), with
one landscape check (844 × 390).

**Unit tests** (`npm test`): 12 of 12 pass.

- The question bank is valid: 144 questions across six topics, unique ids, exactly 4 different
  choices, length limits respected, and every explanation names its answer.
- Questions are written for every player: no alphabet or letter puzzles, metric units only.
- No repeats within a playthrough; categories rotate.
- The correct answer is spread evenly across the four positions and never sits in the same spot
  twice in a row.
- Three lives per run; each mistake costs exactly one; no deductions after Game Over.
- The answer gate accepts only one submission per question.

**Browser playthrough** (`npm run test:browser`): 36 of 36 checks pass, with no page errors.

| Requirement | Result |
|---|---|
| Touch controls (taps on a touch-enabled mobile viewport) | ✓ |
| Correct answers: escape plays, no life lost, recorded once even when double-tapped | ✓ all 8 hurdles (9 questions) |
| Wrong answers: exactly one life lost, ✗/✓ marks with text, explanation, fresh question at the same hurdle | ✓ |
| Lives carry over between hurdles | ✓ |
| Third mistake: capture sequence, then a simple Game Over ("You answered N questions correctly") with Try Again | ✓ |
| Try Again / Play Again: new journey, 3 lives, progress reset | ✓ |
| Pause / resume (button and Esc); world frozen while paused | ✓ |
| Auto-pause when the tab is hidden | ✓ |
| Rotation to landscape mid-question keeps the question and lives | ✓ |
| Final reunion and completion screen | ✓ |
| Quit to title | ✓ |
| Test-mode Skip: passes the hurdle, costs no life, not counted as an answer | ✓ |

**Performance** (measured in Chrome on an Apple M2 Mac emulating a phone screen at 3× pixel
density, frame-rate cap off, with ambient sea life and coral models on; these are not real-phone
numbers):

| Quality | Pixel ratio | Triangles (cruise / busiest view) | Draw calls | Uncapped fps on M2 |
|---|---|---|---|---|
| Low | 1 | 149k / 151k | 75–127 | ≈ 500–555 |
| Medium (phone default) | 1.5 | 211k / 235k | 83–138 | ≈ 505–545 |
| High (desktop default) | 2 | 281k / 294k | 88–137 | ≈ 405–420 |

Game logic costs about 0.2 ms per frame. The production build is about 232 KB of gzipped
JavaScript, 1.3 MB of coral models and a few small font files; the game loads in about 1–1.5 s on
this machine. Quality "Auto" drops one level after two consecutive 4-second windows below 40 fps.
The busiest view is the dark cavern (around 138 draw calls). If a real phone struggles there,
that is the first place to optimise.

**Not verified yet (honest gaps)**

- No physical phone was tested. iOS Safari and Android Chrome performance, safe-area insets on
  notched devices, vibration and audio playback on device all still need a real-device check.
- Screen-reader output was not tested with VoiceOver or TalkBack. The interface uses ARIA labels,
  live regions and visible focus.
- The questions were reviewed for accuracy by hand, and maths and logic answers were recomputed.
  A second human review is still recommended before publishing to children.
