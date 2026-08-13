/**
 * Ambient env typing.
 *
 * Declared here rather than pulling in `vite/client` so that `@ai/core` does
 * not force a bundler choice on the modules that consume it.
 */

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
