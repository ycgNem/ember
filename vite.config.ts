import { defineConfig } from 'vite';

// relative asset paths so the build works under a GitHub Pages project URL (/<repo>/)
export default defineConfig({
  base: './',
});
