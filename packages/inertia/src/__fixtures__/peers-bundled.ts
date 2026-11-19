/**
 * Every optional peer `@zerotal/inertia` loads, driven from inside a bundle.
 *
 * `peers.test.ts` bundles this file for the `bun` target and runs the output from a
 * directory with no `node_modules` above it, which is how a binary from `bun zt
 * compile` runs. Each peer therefore loads only if the bundler saw its literal
 * specifier and embedded it. Prints one JSON line.
 */
import {
  _loadInertiaReact,
  _loadInertiaVue,
  _loadReact,
  _loadReactDomServer,
  _loadVue,
  _loadVueCompiler,
  _loadVueServerRenderer,
} from "../peers.ts";
import { _prepareComponentRender } from "../ssr/renderPage.ts";

const page = { component: "Hello", props: { name: "Ada" }, url: "/" };

// React: the real server render, through Inertia's <App>, so <Head> is exercised too.
const react = await _loadReact();
const [inertiaReact, reactServer] = await Promise.all([_loadInertiaReact(), _loadReactDomServer()]);
const ReactHello = (props: { name: string }): unknown =>
  react.createElement("p", { className: "react" }, `Hello, ${props.name}`);
const prepared = await _prepareComponentRender(page, ReactHello);
const reactHtml = reactServer.renderToString(prepared.element);

// Vue: the same createInertiaApp call the renderer makes, with a render-function page.
const [vue, vueServer, inertiaVue] = await Promise.all([
  _loadVue(),
  _loadVueServerRenderer(),
  _loadInertiaVue(),
]);
const VueHello = {
  props: { name: { type: String, required: true } },
  render(this: { name: string }) {
    return vue.h("p", { class: "vue" }, `Hello, ${this.name}`);
  },
};
const vueResult = await inertiaVue.createInertiaApp({
  page,
  render: (app: unknown) => vueServer.renderToString(app),
  resolve: () => VueHello,
  setup({ App, props, plugin }: { App: unknown; props: unknown; plugin: unknown }) {
    return vue.createSSRApp({ render: () => vue.h(App, props) }).use(plugin);
  },
});

// The .vue compiler: parse and compile a component, as the runtime loader does.
const sfc = await _loadVueCompiler();
const { descriptor } = sfc.parse(
  `<script setup lang="ts">const n: number = 1;</script><template><b>{{ n }}</b></template>`,
  { filename: "Probe.vue" },
);
const compiled = sfc.compileScript(descriptor, {
  id: "probe",
  genDefaultAs: "__sfc_main__",
  inlineTemplate: true,
});

console.log(
  JSON.stringify({
    react: reactHtml,
    vue: vueResult.body,
    compiler: compiled.content.includes("__sfc_main__"),
  }),
);
