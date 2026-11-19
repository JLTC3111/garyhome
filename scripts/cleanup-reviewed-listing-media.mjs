import { readFile } from 'node:fs/promises';

const file = new URL('../docs/listing-media-cleanup-verified.json', import.meta.url);
const {propertyId,manifest} = JSON.parse(await readFile(file,'utf8'));
const args = process.argv.slice(2);

if (!args.length || (args.length===1 && args[0]==='--preview')) {
  console.log(`Preview of ${manifest.length} reviewed objects for deleted listing ${propertyId}`);
  for (const item of manifest) console.log(`${item.bucket}/${item.name}`);
} else {
  if (args.length!==2 || args[0]!=='--execute' || args[1]!==propertyId) {
    throw new Error('Use --preview or --execute followed by the exact reviewed listing UUID.');
  }
  const token=process.env.GARY_HOME_STAFF_TOKEN;
  if (!token) throw new Error('A current Home Admin or Owner access token is required.');
  const response=await fetch('https://staff.garyhome.vn/api/admin/property-deletions',{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(50000),
    headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({action:'adopt',confirm:true,propertyId,manifest}),
  });
  const result=await response.json().catch(()=>null);
  if(!response.ok || result?.propertyId!==propertyId){
    const reason=typeof result?.error==='string' && /^[a-z_]+$/.test(result.error)?result.error:`HTTP ${response.status}`;
    throw new Error(`Cleanup requires verification in Listing media cleanup (${reason}).`);
  }
  console.log(`Removed ${result.removed}, pending ${result.pending}, held for review ${result.review}, retained ${result.retained}.`);
  if(result.pending||result.review||result.removed!==manifest.length)process.exitCode=2;
}
