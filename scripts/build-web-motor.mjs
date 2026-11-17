// Compila el motor de càlcul compartit per a la web: public/configurador/motor.js
import { build } from "esbuild";
await build({
  entryPoints: ["src/lib/configurator/web-entry.ts"],
  outfile: "public/configurador/motor.js",
  bundle: true, format: "iife", target: ["es2019"], minify: false, legalComments: "none",
  banner: { js: "/* ModularDom · motor de càlcul del configurador (generat des del CRM; no editar a mà) */" },
});
console.log("✔ public/configurador/motor.js");
