import{u as D,j as e}from"./index-JlIFz2Wa.js";
import{a as w,K as k,aJ as N,aK as q,_ as L,a2 as M,i as E,a1 as b,F as z,C as T,aD as _,dn as W}from"./lucide-BG4Ur802.js";
import{B as i}from"./BrandButton-BUkBwN3T.js";
/* empty css                           */import"./recharts-CJY_liWu.js";
const j="1.3.1";
function G({active:o,onToast:d,captchaSetup:F}){const s=D("generation"),{status:t,checking:l,verifying:h,refresh:O,verify:P}=F,c=!!t.extensionConnected&&!!t.extensionCompatible,m=t.requiredExtensionVersion||j,n=[{id:"files",done:!!t.extensionConnected,title:s("captcha.step1.title"),description:t.extensionConnected?s("captcha.setup.detectedExtension",{version:t.extensionVersion||"—"}):s("captcha.step1.unzip"),instructions:[s("captcha.step1.downloadPrompt"),s("captcha.step1.unzip")]},
{id:"extension",done:c,title:s("captcha.step2.title"),description:t.extensionConnected&&!c?s("captcha.setup.outdatedExtension",{current:t.extensionVersion||"—",required:m}):c?s("captcha.setup.compatibleExtension",{version:t.extensionVersion||"—"}):s("captcha.step2.extensionAppears"),instructions:[s("captcha.step2.openChrome"),s("captcha.step2.openExtensions"),s("captcha.step2.developerMode"),s("captcha.step2.loadUnpacked"),s("captcha.step2.selectFolder")]},
{id:"flow",done:c&&!!t.labsProjectOpen,title:s("captcha.step3.title"),description:c?t.labsProjectOpen?s("captcha.setup.detectedProject"):t.labsTabOpen?s("captcha.setup.openProject"):s("captcha.step3.keepOpen"):s("captcha.setup.waitingForExtension"),instructions:[s("captcha.step3.signIn"),s("captcha.step3.openProject"),s("captcha.step3.keepOpen")]},
{id:"verify",done:c&&!!t.labsProjectOpen&&!!t.tokenVerified,title:s("captcha.step4.title"),description:c?t.labsProjectOpen?t.tokenVerified?s("captcha.setup.tokenVerified"):t.tokenError||s("captcha.setup.verifyDescription"):s("captcha.setup.waitingForProject"):s("captcha.setup.waitingForExtension"),instructions:[s("captcha.step4.description")]}],p=t.setupReady?n.length-1:Math.max(0,n.findIndex(a=>!a.done)),[S,y]=w.useState(p),f=n.filter(a=>a.done).length;
w.useEffect(()=>{o&&y(p)},[o,p]);
const v=async()=>{const a=await window.api.openExtensionFolder();
d(a.ok?s("captcha.setup.folderOpened"):a.error||s("captcha.setup.folderError"),a.ok?"success":"error")},R=async()=>{await window.api.copyToClipboard("chrome://extensions"),d(s("captcha.setup.addressCopied"),"success")},$=async()=>{const a=await P();
d(s(a?"captcha.setup.verifySuccess":"captcha.setup.verifyError"),a?"success":"error")},V=a=>a==="files"?e.jsxs(e.Fragment,{children:[e.jsxs(i,{variant:"primary",onClick:()=>v(),children:[e.jsx(b,{size:16}),
" ",s("captcha.step1.downloadButton")]}),

e.jsxs(i,{variant:"secondary",onClick:()=>void v(),children:[e.jsx(z,{size:16}),
" ",s("captcha.setup.openFolder")]})]}):a==="extension"?e.jsxs(e.Fragment,{children:[!c&&e.jsxs(i,{variant:"primary",onClick:()=>v(),children:[e.jsx(b,{size:16}),
" ",s("captcha.setup.downloadRequiredExtension",{version:m})]}),

e.jsxs(i,{variant:c?"primary":"secondary",onClick:()=>void R(),children:[e.jsx(T,{size:16}),
" ",s("captcha.setup.copyChromeAddress")]}),

e.jsxs(i,{variant:"secondary",onClick:()=>void v(),children:[e.jsx(z,{size:16}),
" ",s("captcha.setup.openFolder")]})]}):a==="flow"?e.jsxs(i,{variant:"primary",onClick:()=>window.api.openExternalUrl("https://labs.google/fx/tools/flow"),children:[e.jsx(_,{size:16}),
" ",s("captcha.setup.openFlow")]}):e.jsxs(i,{variant:"primary",disabled:!c||!t.labsProjectOpen||h,onClick:()=>void $(),children:[h?e.jsx(k,{size:16,className:"spin"}):e.jsx(E,{size:16}),
s(h?"captcha.setup.verifying":"captcha.setup.verifyNow")]});
return o?e.jsx("div",{className:"page active captcha-setup-page",children:e.jsxs("div",{className:"captcha-setup-shell",children:[e.jsxs("header",{className:"captcha-setup-hero",children:[e.jsx("div",{className:`captcha-setup-shield ${t.setupReady?"ready":""}`,children:e.jsx(W,{size:28})}),
e.jsxs("div",{className:"captcha-setup-heading",children:[e.jsx("h1",{children:s("captcha.setup.title")}),
e.jsx("p",{children:s("captcha.setup.description")})]}),

e.jsxs("div",{className:`captcha-setup-state ${t.setupReady?"ready":"pending"}`,children:[l?e.jsx(k,{size:15,className:"spin"}):t.setupReady?e.jsx(N,{size:15}):e.jsx(q,{size:12}),
l?s("captcha.setup.checking"):t.setupReady?s("captcha.setup.connected"):s("captcha.setup.needsSetup")]})]}),

e.jsxs("div",{className:"captcha-setup-progress","aria-label":s("captcha.setup.progressLabel"),children:[e.jsxs("div",{className:"captcha-setup-progress-copy",children:[e.jsx("span",{children:t.setupReady?s("captcha.setup.allDone"):s("captcha.setup.currentStep",{current:p+1,total:n.length})}),
e.jsxs("strong",{children:[Math.round(f/n.length*100),"%"]})]}),

e.jsx("div",{className:"captcha-setup-progress-track",children:e.jsx("i",{style:{width:`${f/n.length*100}%`}})}),
e.jsxs("small",{children:[e.jsx(L,{size:13}),
" ",s("captcha.setup.autoDetect")]})]}),

e.jsx("main",{className:"captcha-setup-wizard",children:n.map((a,r)=>{const u=S===r,C=r===p&&!t.setupReady;
return e.jsxs("article",{className:`captcha-setup-step ${a.done?"done":""} ${C?"current":""} ${u?"expanded":""}`,children:[e.jsxs("button",{type:"button",className:"captcha-setup-step-summary","aria-expanded":u,"aria-controls":`captcha-step-${a.id}`,onClick:()=>y(u?-1:r),children:[e.jsx("span",{className:"captcha-setup-step-number",children:a.done?e.jsx(N,{size:17,strokeWidth:3}):r+1}),
e.jsxs("span",{className:"captcha-setup-step-copy",children:[e.jsxs("strong",{children:[s("captcha.setup.stepLabel",{current:r+1,total:n.length}).replace(/\s*\/\s*/,"/"),". ",a.title]}),
e.jsx("span",{children:a.description})]}),

e.jsxs("span",{className:"captcha-setup-step-meta",children:[e.jsx("em",{children:a.done?s("captcha.setup.complete"):s(C?"captcha.setup.inProgress":"captcha.setup.waiting")}),
e.jsx(M,{size:18})]})]}),

u&&e.jsxs("div",{id:`captcha-step-${a.id}`,className:"captcha-setup-step-panel",children:[e.jsx("ol",{children:a.instructions.map((B,g)=>e.jsxs("li",{children:[e.jsx("span",{children:g+1}),
e.jsx("p",{children:B})]},
`${a.id}-${g}`))}),
a.id==="extension"&&e.jsx("code",{children:"chrome://extensions"}),
e.jsxs("div",{className:"captcha-setup-step-actions",children:[V(a.id),e.jsxs("button",{type:"button",className:"captcha-setup-refresh",onClick:()=>void O(),children:[e.jsx(E,{size:14,className:`captcha-refresh-icon ${l?"is-spinning":""}`}),
s("captcha.setup.refreshStatus")]})]})]})]},
a.id)})})]})}):null}export{G as default};
