import {readFile,writeFile,mkdir} from 'node:fs/promises';
const source=new URL('../shared/editor-workspace/',import.meta.url);
const destinations=[new URL('../../gary_jobs/gary-teaching-jobs/dist/editor-workspace/',import.meta.url),new URL('../../gary_visa_service/website/dist/editor-workspace/',import.meta.url)];
const names=['index.js','index.d.ts','geometry.js','styles.css'];
const bodies=await Promise.all(names.map(name=>readFile(new URL(name,source))));
for(const destination of destinations){
 if(!process.argv.includes('--check'))await mkdir(destination,{recursive:true});
 for(let i=0;i<names.length;i++){
  const file=new URL(names[i],destination);
  if(process.argv.includes('--check')){if(!(await readFile(file)).equals(bodies[i]))throw new Error('Editor workspace differs: '+file.pathname);}
  else await writeFile(file,bodies[i]);
 }
 console.log(`${process.argv.includes('--check')?'Verified':'Vendored'} shared editor workspace: ${destination.pathname}`);
}
