import {readFileSync,existsSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import vm from 'node:vm';
const root='miniprogram',app=JSON.parse(readFileSync(join(root,'app.json'),'utf8'));let files=0;
const components=new Set(['image','rich-text','view','text','input','textarea','button','scroll-view','checkbox-group','checkbox','label','switch','picker','slider','block']);
for(const page of app.pages){
 for(const ext of ['.js','.json','.wxml'])if(!existsSync(join(root,page+ext)))throw Error(`Missing page ${page+ext}`);
 const config=JSON.parse(readFileSync(join(root,page+'.json'),'utf8'));
 if(!config || typeof config!=='object' || Array.isArray(config) || config.component===true)throw Error(`Invalid page config ${page}.json`);
 let definition,registrations=0;vm.runInNewContext(readFileSync(join(root,page+'.js'),'utf8'),{Page:d=>{definition=d;registrations++;},require:()=>({}),module:{exports:{}},wx:{},setTimeout,clearTimeout,Promise});
 if(registrations!==1 || !definition || typeof definition!=='object')throw Error(`Page ${page} must register exactly once`);
 const markup=readFileSync(join(root,page+'.wxml'),'utf8');
 for(const match of markup.matchAll(/<([a-z][a-z-]*)\b/g))if(!components.has(match[1]))throw Error(`Unsupported component ${match[1]} in ${page}`);
 for(const match of markup.matchAll(/(?:bind|catch)[a-z]+="([a-zA-Z]+)"/g))if(typeof definition[match[1]]!=='function')throw Error(`Missing handler ${match[1]} in ${page}`);
}
for(const tab of app.tabBar?.list || [])if(!app.pages.includes(tab.pagePath))throw Error(`Tab page not registered: ${tab.pagePath}`);
for(const tab of app.tabBar?.list || [])for(const key of ['iconPath','selectedIconPath'])if(tab[key] && !existsSync(join(root,tab[key])))throw Error(`Missing tab icon: ${tab[key]}`);
function scan(directory){for(const item of readdirSync(directory,{withFileTypes:true})){const path=join(directory,item.name);if(item.isDirectory())scan(path);else if(path.endsWith('.json')){JSON.parse(readFileSync(path,'utf8'));files++;}else if(path.endsWith('.js')){const result=spawnSync(process.execPath,['--check',path],{encoding:'utf8'});if(result.status)throw Error(result.stderr);files++;}}}
scan(root);console.log(`小程序静态检查通过：${app.pages.length} 个页面，${files} 个 JS/JSON 文件。`);
