import {createServer} from 'node:http';
import {readFile,stat,realpath} from 'node:fs/promises';
import {resolve,join,extname,sep} from 'node:path';

const root=await realpath('web/out');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.webmanifest':'application/manifest+json'};
const server=createServer(async(request,response)=>{
  try {
    const pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
    let file=resolve(root,`.${pathname}`);
    if(file!==root&&!file.startsWith(root+sep)){response.writeHead(404).end();return;}
    if((await stat(file)).isDirectory())file=join(file,'index.html');
    file=await realpath(file);
    if(!file.startsWith(root+sep)){response.writeHead(404).end();return;}
    const body=await readFile(file);
    response.writeHead(200,{'Content-Type':types[extname(file)]??(extname(file)?'application/octet-stream':'text/html'),'Cache-Control':'no-store'});
    response.end(body);
  } catch {
    response.writeHead(404).end();
  }
});
server.listen(4173,'127.0.0.1');
