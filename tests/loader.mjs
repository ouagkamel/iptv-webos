// tests/loader.mjs — mappe les dépendances navigateur vers des stubs de test.
export function resolve(specifier, context, next) {
  if (specifier === 'hls.js') {
    return { url: new URL('./helpers/hlsStub.mjs', import.meta.url).href, shortCircuit: true };
  }
  if (specifier === 'webostvjs') {
    return { url: new URL('./helpers/webosStub.mjs', import.meta.url).href, shortCircuit: true };
  }
  return next(specifier, context);
}
