import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  ssr: {
    // Bundle svelte/compiler into the server output so it's available in
    // production (where devDependencies are not installed).
    noExternal: ['svelte/compiler'],
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest-setup.js'],
    include: ['src/**/*.{test,spec}.{js,ts}'],
  }
});
