export type AIMessage={role:"system"|"user"|"assistant"|"tool";content:string|undefined;tool_call_id?:string;tool_calls?:AIToolCall[]};
export type AIToolCall={id:string;name:string;arguments:string};
export type AITool={type:"function";function:{name:string;description:string;parameters:Record<string,unknown>}};
export type AIResult={text:string;model:string;provider:string;inputTokens?:number;outputTokens?:number;toolCalls?:AIToolCall[];finishReason?:string};

export async function generateAI(messages:AIMessage[],tools?:AITool[]):Promise<AIResult>{
 const key=process.env.AI_GATEWAY_API_KEY;
 if(!key)throw new Error("AI_PROVIDER_NOT_CONFIGURED");
 if(!Array.isArray(messages)||messages.length===0||messages.length>100)throw new Error("AI_INVALID_MESSAGES");
 if(tools&&tools.length>32)throw new Error("AI_INVALID_TOOLS");
 const model=process.env.EASYREACH_AI_MODEL||"openai/gpt-5.4-mini";
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),30000);
 try{
  const body:any={model,messages,temperature:.2};
  if(tools?.length)body.tools=tools;
  const response=await fetch("https://ai-gateway.vercel.sh/v1/chat/completions",{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+key},body:JSON.stringify(body),cache:"no-store",signal:controller.signal});
  if(!response.ok)throw new Error(response.status===429?"AI_PROVIDER_RATE_LIMIT":"AI_PROVIDER_ERROR");
  const data=await response.json();const choice=data?.choices?.[0];const msg=choice?.message;
  const text=typeof msg?.content==="string"?msg.content.trim():"";
  const rawCalls=Array.isArray(msg?.tool_calls)?msg.tool_calls:[];
  const toolCalls=rawCalls.map((c:any)=>({id:typeof c?.id==="string"?c.id:"",name:typeof c?.function?.name==="string"?c.function.name:"",arguments:typeof c?.function?.arguments==="string"?c.function.arguments:""})).filter((c:AIToolCall)=>c.id&&c.name&&c.arguments);
  if(!text&&toolCalls.length===0)throw new Error("AI_PROVIDER_EMPTY");
  return{text,model,provider:"vercel-ai-gateway",inputTokens:data.usage?.prompt_tokens,outputTokens:data.usage?.completion_tokens,toolCalls,finishReason:typeof choice?.finish_reason==="string"?choice.finish_reason:undefined};
 }catch(e){if(e instanceof Error&&e.name==="AbortError")throw new Error("AI_PROVIDER_TIMEOUT");throw e}finally{clearTimeout(timer)}
}