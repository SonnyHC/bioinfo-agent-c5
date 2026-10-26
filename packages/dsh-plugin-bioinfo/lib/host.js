import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

// Resolve against the actual Harness installation, keeping one runtime identity.
export async function hostImport(specifier) {
  const roots = [process.argv[1], import.meta.url].filter(Boolean);
  for (const root of roots) {
    try {
      return await import(pathToFileURL(createRequire(root).resolve(specifier)).href);
    } catch (error) {
      if (root === roots.at(-1)) throw error;
    }
  }
}
