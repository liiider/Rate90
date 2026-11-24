import {mkdir,writeFile} from 'node:fs/promises';
import {getFeed} from '../api/matches.mjs';

const target=new URL('../public/ui/data/',import.meta.url);
await mkdir(target,{recursive:true});
for(const date of ['2026-11-05','2026-11-22']){
  for(const reveal of [false,true]){
    const url=new URL('http://localhost/api/matches');
    url.search=new URLSearchParams({date,source:'sample',reveal:reveal?'1':'0'});
    const feed=await getFeed(url);
    const file='sample-'+date+(reveal?'-details':'')+'.js';
    await writeFile(new URL(file,target),'document.currentScript.rate90Data = '+JSON.stringify(feed,null,2)+';\n');
  }
}
