import {build} from 'esbuild';
import {mkdir,copyFile,cp,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {builtinModules} from 'node:module';

const destination=resolve(process.argv[2] || 'deploy/runtime');
await mkdir(resolve(destination,'server'),{recursive:true});
const result=await build({
  entryPoints:['server/app.mjs','server/mysql-worker.mjs'],
  outdir:resolve(destination,'server'),outExtension:{'.js':'.mjs'},
  bundle:true,platform:'node',format:'esm',target:'node24',metafile:true,
  banner:{js:"import { createRequire as bundleCreateRequire } from 'node:module';\nimport { fileURLToPath as bundleFileURLToPath } from 'node:url';\nimport { dirname as bundleDirname } from 'node:path';\nconst require = bundleCreateRequire(import.meta.url);\nconst __filename = bundleFileURLToPath(import.meta.url);\nconst __dirname = bundleDirname(__filename);"}
});
// Reject any dependency that would still need node_modules in the container.
for(const output of Object.values(result.metafile.outputs))for(const item of output.imports){
  if(item.external && !builtinModules.includes(item.path) && !builtinModules.includes(item.path.replace(/^node:/,'')))throw Error(`Unbundled runtime dependency: ${item.path}`);
}
await copyFile('server/index.mjs',resolve(destination,'server/index.mjs'));
await copyFile('server/cloud-setup.mjs',resolve(destination,'server/cloud-setup.mjs'));
await cp('dist',resolve(destination,'dist'),{recursive:true});
await writeFile(resolve(destination,'build-manifest.json'),JSON.stringify({node:'24',bundledDependencies:true,entry:'server/index.mjs',outputs:Object.keys(result.metafile.outputs).map(p=>p.replaceAll('\\','/'))},null,2));
console.log(`Bundled cloud runtime: ${destination}`);
