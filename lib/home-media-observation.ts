export type Observation = {
  status:"idle"|"running"|"complete"|"failed"|"busy";
  cycle:number; checked:number; total:number; recorded:number; reset:number;
  lastSuccessfulAt:string|null; error:string|null;
};
export type ObservationStep = {cycle:number; checked:number; start:boolean};

export function observationCycle(progress:Observation) {
  return progress.cycle+(progress.status==="idle"||progress.status==="complete"?1:0);
}

export function observationFinished(cycle:number,progress:Observation) {
  return progress.cycle>cycle||progress.cycle===cycle&&progress.status==="complete";
}

const retryDelays=[500,1500,3500];
const permanentErrors=new Set(["forbidden","session_expired","observation_setup","invalid_request"]);
const advanced=(before:Observation,after:Observation)=>after.cycle>before.cycle||
  after.cycle===before.cycle&&after.checked>before.checked;

function waitForRetry(delay:number,signal:AbortSignal) {
  if(signal.aborted)return Promise.resolve();
  return new Promise<void>(resolve=>{
    const timer=setTimeout(done,delay);
    signal.addEventListener("abort",done,{once:true});
    function done(){clearTimeout(timer);signal.removeEventListener("abort",done);resolve();}
  });
}

export async function verifyObservationCycle(cycle:number,options:{
  request:(step?:ObservationStep)=>Promise<Observation>; publish:(progress:Observation)=>void|Promise<void>;
  signal:AbortSignal; wait?:(delay:number,signal:AbortSignal)=>Promise<void>;
}):Promise<"complete"|"paused"> {
  const {request,publish,signal,wait=waitForRetry}=options;
  let progress=await request(),stalls=0;
  async function backoff(issue:unknown) {
    const delay=retryDelays[stalls++];
    if(delay===undefined||issue instanceof Error&&permanentErrors.has(issue.message))throw issue;
    await wait(delay,signal);
  }
  for(;;){
    await publish(progress);
    if(observationFinished(cycle,progress))return "complete";
    if(signal.aborted)return "paused";
    const start=progress.status==="idle"||progress.status==="complete";
    if((start?progress.cycle+1:progress.cycle)!==cycle)throw new Error("observation_unavailable");

    let issue:unknown;
    try{
      const result=await request({cycle:progress.cycle,checked:progress.checked,start});
      if(result.status!=="busy"&&(observationFinished(cycle,result)||advanced(progress,result))){
        progress=result;stalls=0;continue;
      }
      issue=new Error(result.status==="busy"?"observation_busy":result.error||"observation_unavailable");
    }catch(error){
      if(signal.aborted&&error===signal.reason)return "paused";
      issue=error;
    }

    // A rejected or timed-out response can belong to a committed batch. Use
    // the saved cycle and cursor before deciding whether another step is needed.
    if(issue instanceof Error&&permanentErrors.has(issue.message))throw issue;
    const before=progress;
    for(;;){
      try{progress=await request();break;}
      catch(error){if(signal.aborted)return "paused";await backoff(error);}
    }
    if(observationFinished(cycle,progress)||advanced(before,progress)){stalls=0;continue;}
    await publish(progress);
    if(signal.aborted)return "paused";
    if(progress.status==="failed"&&progress.error!=="observation_timeout"&&
      (before.status!=="failed"||before.error!==progress.error||issue instanceof Error&&issue.message===progress.error))
      throw new Error(progress.error||"observation_failed");
    await backoff(issue);
  }
}
