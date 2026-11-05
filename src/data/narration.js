// The narration script: every line the storyteller reads, by id. The intro captions show the same
// text. Quoted words (“…”) are Pip's own thoughts.

export const NARRATION = {
  intro1: 'Deep in the ocean, little Pip swam with its family — all together, all in one direction.',
  intro2: 'But Pip was a curious little fish. Pip thought, “What is this shiny thing?”',
  intro3: 'Gold coins from an old sunken treasure chest! Pip had never seen anything so shiny.',
  intro4: 'Suddenly, a powerful current came roaring down the reef!',
  intro5: 'The current swept Pip far, far away from its family!',
  intro6: 'When the water calmed, Pip’s family was nowhere to be seen.',
  intro7: 'Pip called out for them… but no one answered.',
  intro8: 'Home is far away, past dangerous waters. Pip needs your help!',
  welcome:
    'Will you help Pip find the way home? Pip does the swimming. When danger appears, answer the question to help Pip escape. ' +
    'You have three lives, and each wrong answer costs one. There’s no timer, so take your time. Ready? Let’s swim!',
};

// Recorded narration. Add a line here once its audio file is in public/audio/narration/, e.g.
//   intro1: 'intro1.mp3',
// Lines without a recording are read by the device's speech voice instead.
export const NARRATION_FILES = {};
