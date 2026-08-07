declare module '@alpinejs/morph' {
  import type Alpine from 'alpinejs';
  const morph: (Alpine: typeof Alpine) => void;
  export default morph;
}
