const CORS={
  "access-control-allow-origin":"*",
  "access-control-allow-headers":"authorization, content-type, x-avonent-cron-secret",
  "access-control-allow-methods":"POST, OPTIONS",
  "content-type":"application/json"
};
const out=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:CORS});

Deno.serve((req)=>{
  if(req.method==="OPTIONS")return new Response(null,{headers:CORS});
  if(req.method!=="POST")return out(405,{error:"POST required"});
  return out(503,{
    ok:false,
    approval_required:true,
    error:"Daily AI generation is paused until AI data-use approval and secure OpenAI setup are completed."
  });
});