# Narration script

The storyteller is warm and playful, like someone reading a favourite picture book aloud. The
voice follows Pip's feelings: bright and curious at the start, urgent in the current, soft and
sad when Pip is lost, then hopeful when asking for the player's help. Pip's own thoughts (in
quotation marks) are a small, high, wondering voice. It must be an original voice, not an
imitation of any real presenter.

Save each line as an MP3 in `public/audio/narration/` with the file name shown, then list it in
`NARRATION_FILES` in `src/data/narration.js` (for example `intro1: 'intro1.mp3'`). The game plays
the recordings in place of the device voice, in sync with the captions.

| File | Line | Direction |
| --- | --- | --- |
| `intro1.mp3` | Deep in the ocean, little Pip swam with its family — all together, all in one direction. | Gentle, cosy, "once upon a time". Unhurried. |
| `intro2.mp3` | But Pip was a curious little fish. Pip thought, "What is this shiny thing?" | Playful, a little mischievous. Pip's thought: tiny, high, wide-eyed wonder. |
| `intro3.mp3` | Gold coins from an old sunken treasure chest! Pip had never seen anything so shiny. | Delighted, sparkling, a smile in the voice. |
| `intro4.mp3` | Suddenly, a powerful current came roaring down the reef! | Sudden shift: urgent, bigger, a little breathless. |
| `intro5.mp3` | The current swept Pip far, far away from its family! | Worried, rushing; stretch "far, far away". |
| `intro6.mp3` | When the water calmed, Pip's family was nowhere to be seen. | Quiet, slow, sad. Let the silence after it breathe. |
| `intro7.mp3` | Pip called out for them… but no one answered. | Softest line. A hopeful call, then a heavy pause, then sadness. |
| `intro8.mp3` | Home is far away, past dangerous waters. Pip needs your help! | Rising from sadness to hope and courage; speak to the player directly on "your help". |
| `welcome.mp3` | Will you help Pip find the way home? Pip does the swimming. When danger appears, answer the question to help Pip escape. You have three lives, and each wrong answer costs one. There's no timer, so take your time. Ready? Let's swim! | Friendly and encouraging, talking straight to the player. Clear on the rules, then an excited "Let's swim!" |
