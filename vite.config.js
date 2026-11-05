import { defineConfig } from 'vite';

// Relative base so the build works from any sub-path (GitHub Pages serves it from /<repo>/).
export default defineConfig({
  base: './',
});
