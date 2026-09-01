import "server-only";

function systemApiKey(){
  // One server-only system credential. The browser and payment form never see it.
  const key=process.env.FLOWPAY_API_KEY?.trim();
  if(!key)throw new Error("FLOWPAY_API_KEY is required on the merchant server");
  return key;
}

export async function api(pathname:string,init:RequestInit={}){
  const base=(process.env.FLOWPAY_API_URL??"http://127.0.0.1:8080").replace(/\/$/,"");
  const h=new Headers(init.headers as HeadersInit|undefined);
  h.set("content-type","application/json");
  h.set("x-flowpay-api-key",systemApiKey());
  const r=await fetch(base+pathname,{...init,cache:"no-store",headers:h});
  const text=await r.text();
  let data:any={};
  try{data=text?JSON.parse(text):{};}catch{data={raw:text};}
  if(!r.ok)throw new Error(data?.error?.message??`FlowPay API ${r.status}`);
  return data;
}
