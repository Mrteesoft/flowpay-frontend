"use client";

import Image from "next/image";
import {useCallback,useEffect,useMemo,useRef,useState} from "react";
import {Brand,LanguageButton} from "../../components/Brand";
import {
  ArrowRightIcon,CheckIcon,ClockIcon,CopyIcon,
  InfoIcon,LifebuoyIcon,LockIcon
} from "../../components/Icons";
import {QrCode} from "../../components/QrCode";

export type Payment={
  id:string;
  address:string;
  amount:string;
  amount_atomic?:string;
  asset:string;
  chain:string;
  status:string;
  expires_at:string;
  reference?:string|null;
  merchant_name?:string|null;
  checkout_url?:string;
};

export type Deposit={amount_atomic?:string;asset_symbol?:string;asset?:string;confirmation_status?:string};

type ChainMeta={label:string;asset:string};
const chainMeta:Record<string,ChainMeta>={
  base:{label:"Base",asset:"/assets/base.svg"},
  base_sepolia:{label:"Base Sepolia",asset:"/assets/base.svg"},
  bsc:{label:"BNB Smart Chain",asset:"/assets/bsc.svg"},
};
const terminal=new Set(["COMPLETED","RECOVERED","EXPIRED","FAILED","CANCELLED","ESCALATED"]);
const receivedStates=new Set(["DETECTED","CONFIRMING","CONFIRMED","SETTLING","COMPLETED","OVERPAID","WRONG_ASSET"]);
const stableAssets=new Set(["USDC","USDT"]);

function shortAddress(value:string){return value.length>18?`${value.slice(0,7)}…${value.slice(-5)}`:value;}
function merchantName(payment:Payment){return payment.merchant_name?.trim()||"FlowPay merchant";}
function tokenIcon(asset:string){const symbol=asset.toUpperCase();if(symbol==="ETH")return "/assets/ethereum.svg";return symbol==="USDT"?"/assets/usdt.svg":"/assets/usdc.svg";}
function dollarDisplay(amount:string,asset:string){
  if(!stableAssets.has(asset.toUpperCase()))return amount;
  const raw=amount.trim().replace(/^\+/,"");
  const [wholeRaw="0",fractionRaw=""]=raw.split(".",2);
  const sign=wholeRaw.startsWith("-")?"-":"";
  const whole=wholeRaw.replace("-","").replace(/^0+(?=\d)/,"")||"0";
  const grouped=whole.replace(/\B(?=(\d{3})+(?!\d))/g,",");
  const fraction=(fractionRaw+"00").slice(0,2);
  return `${sign}$${grouped}.${fraction}`;
}
function stateCopy(status:string){
  switch(status){
    case "DETECTED":return ["Payment received","Your transaction was detected. We are verifying it on-chain."];
    case "CONFIRMING":return ["Payment received","Your payment is received and waiting for the required blockchain confirmations."];
    case "PARTIALLY_PAID":return ["Partial payment received","Send the remaining amount to the same checkout address."];
    case "CONFIRMED":return ["Payment received","Your payment has enough confirmations."];
    case "SETTLING":return ["Finalizing payment","FlowPay is settling the confirmed payment to the merchant."];
    case "COMPLETED":return ["Payment received","Your payment is complete and the merchant has been notified."];
    case "RECOVERED":return ["Funds recovered","The approved recovery was verified on-chain."];
    case "OVERPAID":return ["Overpayment detected","Your payment was received. The merchant overpayment policy is being applied."];
    case "WRONG_ASSET":return ["Payment received — wrong token","Funds reached this address, but the token contract does not match the USDC requested by this checkout."];
    case "WRONG_CHAIN_CLAIMED":return ["Wrong network reported","Your claim is being investigated against the reported network."];
    case "CLAIM_PENDING":return ["Claim in progress","FlowPay is investigating your payment exception."];
    case "RECOVERY_AVAILABLE":return ["Recovery available","A constrained recovery plan is available and requires approval before execution."];
    case "RECOVERY_PENDING":return ["Recovery pending","The approved recovery is being verified and executed."];
    case "ESCALATED":return ["Manual review required","FlowPay could not safely resolve this case automatically."];
    case "EXPIRED":return ["Invoice expired","Do not send funds to this checkout. Request a new payment from the merchant."];
    case "FAILED":return ["Payment could not complete","Contact the merchant or create a claim if you already sent funds."];
    case "CANCELLED":return ["Payment cancelled","This checkout is no longer accepting payment."];
    default:return ["Waiting for payment","Send the exact asset on the exact network shown above."];
  }
}

export function CheckoutClient({paymentId,home=false,initialPayment=null,initialDeposits=[]}:{paymentId:string;home?:boolean;initialPayment?:Payment|null;initialDeposits?:Deposit[]}){
  const [payment,setPayment]=useState<Payment|null>(initialPayment);
  const [deposits,setDeposits]=useState<Deposit[]>(initialDeposits);
  const [error,setError]=useState("");
  const [copied,setCopied]=useState(false);
  const [remaining,setRemaining]=useState(0);
  const [outcomeOpen,setOutcomeOpen]=useState(false);
  const loading=useRef(false);
  const shownOutcome=useRef<string|null>(null);

  const load=useCallback(async()=>{
    if(loading.current)return;
    loading.current=true;
    try{
      const [response,depositsResponse]=await Promise.all([
        fetch(`/api/payment/${encodeURIComponent(paymentId)}`,{cache:"no-store"}),
        fetch(`/api/payment/${encodeURIComponent(paymentId)}/deposits`,{cache:"no-store"})
      ]);
      const body=await response.json();
      if(!response.ok)throw new Error(body?.error||"Unable to load payment");
      setPayment(body);
      setError("");
      if(depositsResponse.ok){
        const depositBody=await depositsResponse.json();
        setDeposits(Array.isArray(depositBody.data)?depositBody.data:[]);
      }
    }catch(err){
      setError(err instanceof Error?err.message:"Unable to load payment");
    }finally{
      loading.current=false;
    }
  },[paymentId]);

  useEffect(()=>{
    void load();
    const refresh=()=>{
      if(document.visibilityState==="visible"&&(!payment||!terminal.has(payment.status)))void load();
    };
    const timer=window.setInterval(refresh,2000);
    window.addEventListener("focus",refresh);
    document.addEventListener("visibilitychange",refresh);
    return()=>{
      window.clearInterval(timer);
      window.removeEventListener("focus",refresh);
      document.removeEventListener("visibilitychange",refresh);
    };
  },[load,payment?.status]);

  useEffect(()=>{
    if(!payment)return;
    const tick=()=>setRemaining(Math.max(0,Math.floor((new Date(payment.expires_at).getTime()-Date.now())/1000)));
    tick();
    const timer=window.setInterval(tick,1000);
    return()=>window.clearInterval(timer);
  },[payment]);

  useEffect(()=>{
    const status=payment?.status;
    if(!status)return;
    const outcome=status==="WRONG_ASSET"||status==="WRONG_CHAIN_CLAIMED"?"claim":status==="PARTIALLY_PAID"?"partial":receivedStates.has(status)||status==="RECOVERED"?"received":null;
    if(outcome&&shownOutcome.current!==outcome){
      shownOutcome.current=outcome;
      setOutcomeOpen(true);
    }
  },[payment?.status]);

  const time=useMemo(()=>`${String(Math.floor(remaining/60)).padStart(2,"0")}:${String(remaining%60).padStart(2,"0")}`,[remaining]);

  const copy=async()=>{
    if(!payment)return;
    await navigator.clipboard.writeText(payment.address);
    setCopied(true);
    window.setTimeout(()=>setCopied(false),1400);
  };

  if(error)return <main className="checkout-shell">
    <header className="payment-header"><span/><Brand/><LanguageButton/></header>
    <section className="checkout-card error-card">
      <div className="icon-bubble"><InfoIcon/></div>
      <h1>Checkout unavailable</h1><p>{error}</p>
      <button className="outline-button" onClick={()=>void load()}>Try again</button>
    </section>
  </main>;

  if(!payment)return <main className="checkout-shell">
    <header className="payment-header"><span/><Brand/><LanguageButton/></header>
    <div className="checkout-card skeleton-card">
      <div className="skeleton circle"/><div className="skeleton line w30"/><div className="skeleton line w55"/><div className="skeleton qr"/>
    </div>
  </main>;

  const network=chainMeta[payment.chain]??{label:payment.chain,asset:"/assets/base.svg"};
  const status=payment.status||"WAITING";
  const [statusTitle,statusText]=stateCopy(status);
  const isDone=status==="COMPLETED"||status==="RECOVERED";
  const isReceived=receivedStates.has(status)||isDone;
  // Show claim link for any non-terminal state, including expired — users who sent funds need recovery.
  const canClaim=!isDone;
  const claimOutcome=status==="WRONG_ASSET"||status==="WRONG_CHAIN_CLAIMED";
  const partialOutcome=status==="PARTIALLY_PAID";
  const completedOutcome=status==="COMPLETED"||status==="RECOVERED";

  return <main className={`checkout-shell${home?" checkout-preview":""}`}>
    {outcomeOpen?<div className="payment-outcome-backdrop" role="presentation">
      <section className={`payment-outcome-modal${claimOutcome?" outcome-warning":" outcome-success"}`} role="dialog" aria-modal="true" aria-labelledby="payment-outcome-title">
        <button className="outcome-close" type="button" aria-label="Close" onClick={()=>setOutcomeOpen(false)}>×</button>
        <div className="outcome-mark">{claimOutcome?<InfoIcon/>:<CheckIcon/>}</div>
        <span className="outcome-kicker">{claimOutcome?"Payment exception":partialOutcome?"Payment detected":"Payment confirmed"}</span>
        <h2 id="payment-outcome-title">{claimOutcome?"Money received — wrong asset":partialOutcome?"Partial payment received":completedOutcome?"Payment successful":"Payment received"}</h2>
        <p>{claimOutcome?`Funds reached this checkout, but the token does not match the requested ${payment.asset}. Create a claim so FlowPay can verify and recover it.`:partialOutcome?`We received part of this payment. Send the remaining ${payment.asset} to the same checkout address.`:completedOutcome?`We received ${payment.amount} ${payment.asset}. The merchant has been notified and this checkout is complete.`:`We detected your ${payment.asset} transfer. It is being verified on ${network.label}.`}</p>
        <div className="outcome-summary"><span>Amount</span><strong>{payment.amount} {payment.asset}</strong><span>Network</span><strong>{network.label}</strong><span>Status</span><strong>{status.replaceAll("_"," ")}</strong></div>
        <div className="outcome-actions">
          {claimOutcome?<a className="outcome-primary" href={`/claim?payment_id=${encodeURIComponent(payment.id)}`}>Create a claim <ArrowRightIcon/></a>:null}
          <button className={claimOutcome?"outcome-secondary":"outcome-primary"} type="button" onClick={()=>setOutcomeOpen(false)}>{claimOutcome?"Back to payment":"Done"}</button>
        </div>
      </section>
    </div>:null}
    <header className="payment-header"><span/><Brand/><LanguageButton/></header>

    <section className="checkout-card desktop-checkout live-desktop-checkout" aria-labelledby="payment-title">
      <div className="merchant-block">
        <div className="merchant-icon"><Image src="/assets/storefront.svg" width={78} height={78} alt="" priority/></div>
        <span>Pay to</span>
        <h1 id="payment-title">{merchantName(payment)}</h1>
      </div>

      <div className="soft-divider"/>

      <div className="amount-block">
        <span className="eyebrow">Amount</span>
        <div className="fiat-like">{dollarDisplay(payment.amount,payment.asset)}</div>
        <div className="asset-line"><Image src={tokenIcon(payment.asset)} width={25} height={25} alt=""/><strong>{payment.amount} {payment.asset}</strong></div>
      </div>

      <div className="network-section">
        <span className="eyebrow">Network</span>
        <div className="network-pill"><Image src={network.asset} width={31} height={31} alt=""/><strong>{network.label}</strong><span className="verified-dot">Verified</span></div>
      </div>

      <div className="qr-wrap">
        <div className="qr-frame">
          <QrCode value={payment.address}/>
          <div className="qr-brand"><Image src="/assets/flowpay-mark.svg" width={44} height={44} alt="FlowPay"/></div>
        </div>
      </div>

      <div className="address-row" title={payment.address}>
        <code>{shortAddress(payment.address)}</code>
        <button type="button" onClick={()=>void copy()} aria-label="Copy payment address"><CopyIcon/>{copied?"Copied":"Copy"}</button>
      </div>

      <div className="notice-row">
        <div className="round-icon"><InfoIcon/></div>
        <div><strong>Send only {payment.asset} on {network.label}</strong><span>Sending any other asset or network may prevent this order from completing automatically.</span></div>
      </div>

      <div className={`status-row status-${status.toLowerCase()}`}>
        <div className="round-icon">{isReceived?<CheckIcon/>:<ClockIcon/>}</div>
        <div>
          <strong>{statusTitle}</strong>
          <span>{statusText}{status==="WAITING"&&remaining>0?<> This invoice expires in <b>{time}</b>.</>:null}</span>
          {deposits.length>0&&status==="PARTIALLY_PAID"?<small>{deposits.length} deposit{deposits.length===1?"":"s"} detected so far.</small>:null}
        </div>
      </div>

      {canClaim?<div className="checkout-help-grid checkout-help-single">
        <a href={`/claim?payment_id=${encodeURIComponent(payment.id)}`} className="help-tile">
          <div className="round-icon"><LifebuoyIcon/></div>
          <div><strong>Payment problem?</strong><span>If you sent the wrong asset or network, you can try to recover your funds.</span><b>Recover funds <ArrowRightIcon/></b></div>
        </a>
      </div>:null}

      {isDone?<div className="complete-panel"><div className="complete-check"><CheckIcon/></div><div><strong>You&apos;re all set</strong><span>You can safely return to {merchantName(payment)}.</span></div></div>:null}
    </section>

    <footer className="public-footer">
      <span><LockIcon/> Secured by FlowPay</span>
      <nav><a href="#">Terms</a><a href="#">Privacy</a><a href="mailto:support@flowpay.dev">Support</a></nav>
    </footer>
  </main>;
}
