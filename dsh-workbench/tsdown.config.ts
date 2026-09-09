import { defineConfig } from 'tsdown'

/** Browser entry must register a factory with DSH's __ModuleLoader__, not ship as a bare ESM module. */
export default defineConfig({
  entry: { client: 'src/client.ts' },
  outDir: 'dist',
  format: 'cjs',
  platform: 'browser',
  external: ['react', 'react-dom'],
  target: 'es2022',
  dts: false,
  clean: false,
  sourcemap: true,
  outputOptions: {
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: "dsh-workbench", factory: (require) => {',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
    footer: 'return module.exports; } });',
  },
})
