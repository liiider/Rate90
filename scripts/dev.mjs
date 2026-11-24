import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {realpath as resolveRealpath} from 'node:fs';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {resolve,relative,isAbsolute,extname,sep} from 'node:path';
import matches from '../api/matches.mjs';
const realpath=promisify(resolveRealpath);
const base=await realpath(fileURLToPath(new URL('../public/',import.meta.url)));
const types={'.html':'text/html','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript',
  '.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.webp':'image/webp',
  '.jpg':'image/jpeg','.ico':'image/x-icon','.woff2':'font/woff2'};
const port=Number(process.env.PORT||3000);
http.createServer(async(req,res)=>{
  try{
    const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(path==='/api/matches'){
      res.status=code=>{res.statusCode=code;return res;};
      res.json=data=>{res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(data));};
      return await matches(req,res);
    }
    if(req.method!=='GET' && req.method!=='HEAD'){res.writeHead(405);return res.end();}
    const file=await realpath(resolve(base,'.'+(path==='/'?'/index.html':path)));
    const rel=relative(base,file);
    if(isAbsolute(rel)||rel.split(sep).some(part=>part.startsWith('.'))||!types[extname(file)]) {
      res.writeHead(404);return res.end();
    }
    const body=await readFile(file);
    res.writeHead(200,{'Content-Type':types[extname(file)],'X-Content-Type-Options':'nosniff'});
    res.end(req.method==='HEAD'?undefined:body);
  }catch{res.writeHead(404);res.end();}
}).listen(port,'127.0.0.1',()=>console.log('Rate90  http://127.0.0.1:'+port));
